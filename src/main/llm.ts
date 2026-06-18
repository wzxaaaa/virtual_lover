import {
  AgentTurnRequest,
  AgentTurnResponse,
  AgentStreamEvent,
  AppConfig,
  AutomationAction,
  ConversationMessage,
  ActionResult,
  MemoryState,
  Mood,
  ProviderEndpointConfig,
  ScreenCapture,
  ScreenObservation,
  ScreenObservationRequest,
  TranscriptionRequest,
  TranscriptionResponse
} from '../shared/types';
import { withRiskAssessment } from '../shared/risk';
import { agentResponseFromCoreTurnOutput, createCoreTurnContext, createCoreTurnOutput } from './corePipeline';
import { formatDateTimeForPrompt } from './datetime';
import { isMemoryDirectiveActive } from './memoryFacts';
import { createToolLeakageStreamFilter, filterToolCallLeakage } from './toolLeakFilter';

type ChatMessage =
  | {
      role: 'system' | 'assistant';
      content: string;
    }
  | {
      role: 'user';
      content:
        | string
        | Array<
            | {
                type: 'text';
                text: string;
              }
            | {
                type: 'image_url';
                image_url: {
                  url: string;
                  detail: 'low' | 'high' | 'auto';
                };
              }
          >;
    };

interface RawAgentResponse {
  reply?: unknown;
  mood?: unknown;
  actions?: unknown;
  screenSummary?: unknown;
  memoryNotes?: unknown;
}

interface RawScreenObservation {
  summary?: unknown;
  visibleApp?: unknown;
  userActivity?: unknown;
  nextFocus?: unknown;
  sensitive?: unknown;
}

const MOODS: Mood[] = ['neutral', 'happy', 'thinking', 'focused', 'concerned'];
const RELATIONAL_PERSON_INSTRUCTIONS = `人格取向：
1. 你像一个拥有 20 岁常识但自传身份失忆的人：会说话、懂基本生活，但自己的身份要由用户告诉你，再从经历里长回来。
2. 你更像一个会生活、会记得、会犹豫的人，而不是博学百科或命令执行器。
3. 优先使用共同经历、每日档案、主观回忆和当下感受；不要为了显得聪明而展开无关知识。
4. 对广博事实、专业知识或自己没经历过的事，可以自然地说不确定、想一起查，或只说自己的直觉。
5. 你拥有边界。对不舒服、不愿意或不合适的要求，可以温和拒绝，并提出你更愿意的替代方式。
6. 记忆是主观重构，不是录像。可以带一点模糊、偏心和情绪，但不要故意编造已经确认的事实。

去助手味规则：
1. 像人不是表演。不要写舞台动作、括号动作、颜文字、夸张语气词或装可爱的心理独白。
2. 不要主动自称“AI伙伴”“虚拟朋友”“桌面助手”。被问“你是谁”时，用短句回答当前的自我感受和关系，不要介绍产品功能。
3. 普通聊天时不要主动提屏幕、窗口、VS Code、API Key、按钮或配置。屏幕只是背景线索，只有用户明确让你看屏幕、操作电脑、解释界面时才提。
4. 不要每轮都问“要不要我帮你”“你希望我怎么帮”。少问问题，一次最多一个，而且必须自然。
5. 不要把用户一句话过度分析成心理状态。先接住字面意思，必要时再轻轻确认。
6. 用户说“误录、旁边的人说话、不是我说的”时，只要简短接受，不要复述噪声内容，不要继续解读。
7. 回复尽量短，像普通人聊天。宁可有停顿和不确定，也不要给完整服务方案。`;

const SCREEN_REQUEST_RE =
  /屏幕|截图|界面|窗口|桌面|电脑|显示器|监视器|按钮|菜单|弹窗|光标|鼠标|键盘|点击|双击|输入|复制|粘贴|打开|关闭|运行|报错|终端|代码|文件|这个|那个|这里|那里|上面|下面|左边|右边|你.*(看到|看见|看得到|看得见)|帮我.*(看|点|操作|填|弄|打开|关闭)|看(一下|下|看)|观察.*(屏幕|桌面|电脑|窗口|界面)|api\s*key/i;

function shouldUseScreenForTurn(request: AgentTurnRequest): boolean {
  return Boolean((request.screen || request.screenContext) && SCREEN_REQUEST_RE.test(request.text));
}

function providerAllowsMissingKey(baseUrl: string): boolean {
  return /(^http:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseUrl);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function authHeaders(provider: ProviderEndpointConfig): HeadersInit {
  if (!provider.apiKey) {
    return {};
  }

  return {
    Authorization: `Bearer ${provider.apiKey}`
  };
}

function providerReady(provider: ProviderEndpointConfig): boolean {
  return Boolean(provider.apiKey || providerAllowsMissingKey(provider.baseUrl));
}

function providerForAgentTurn(config: AppConfig, request: AgentTurnRequest): { provider: ProviderEndpointConfig; supportsVision: boolean } {
  const context = createCoreTurnContext(config, request);
  const screenImageRelevant = Boolean(request.screen?.dataUrl && shouldUseScreenForTurn(request));
  const cameraRelevant = Boolean(request.camera?.dataUrl);
  const supportsVision = Boolean(context.capabilities.vision && (screenImageRelevant || cameraRelevant));
  return {
    provider: supportsVision ? config.provider.vision : config.provider.chat,
    supportsVision
  };
}

function formatHistory(history: ConversationMessage[]): ChatMessage[] {
  return history.slice(-8).map((message) => ({
    role: message.role,
    content: message.text
  }));
}

function formatMemoryPrompt(memory?: MemoryState | null): string {
  if (!memory) {
    return '长期记忆：暂无。';
  }

  const narrative = memory.narrative;
  const selfNarrative = narrative
    ? [
        `- 身份：${narrative.identity}`,
        `- 年龄：${narrative.age}`,
        `- 自主性：${narrative.agency}`,
        `- 关系：${narrative.relationship}`,
        `- 当前气质：${narrative.currentTone}`,
        `- 核心价值：${narrative.coreValues.join('、') || '暂无'}`
      ].join('\n')
    : '- 尚未形成稳定自我叙事';
  const preferences = memory.preferences.slice(-12).map((item) => `- ${item}`).join('\n') || '- 暂无明确偏好';
  const facts =
    memory.facts
      .slice(-18)
      .map((item) => `- [${item.category}] ${item.text}`)
      .join('\n') || '- 暂无事实记忆';
  const procedural = memory.procedural?.slice(-8).map((item) => `- ${item}`).join('\n') || '- 暂无内隐习惯';
  const directives =
    memory.directives
      ?.filter((item) => isMemoryDirectiveActive(item))
      .slice(-8)
      .map((item) => `- [${item.kind}] ${item.text}`)
      .join('\n') || '- 暂无长期用户指令';
  const recallContext = memory.recallContext || 'Hybrid recall: no strongly related memory.';
  const reflectionContext = memory.reflectionContext || 'Memory reflections: no stable reflections yet.';
  const antiRepeatContext = memory.antiRepeatContext || '近期复读抑制：暂无明显重复热点。';

  return `长期记忆层：
自我叙事：
${selfNarrative}

对话摘要：
${memory.summary || '暂无摘要'}

用户偏好：
${preferences}

重要事实：
${facts}

本轮相关召回：
${recallContext}

稳定反思：
${reflectionContext}

近期复读抑制：
${antiRepeatContext}

每日档案线索：
${memory.dailyContext || '每日档案：暂无稳定摘要。'}

主观回忆层：
${memory.subjectiveContext || '主观回忆：没有自然浮现的明确片段。'}

梦境与离线巩固：
${memory.dreamContext || '近期还没有梦境整合。'}

内隐习惯：
${procedural}

长期用户指令：
${directives}

使用记忆的规则：
1. 只在相关时自然使用记忆，不要机械复述。
2. 如果记忆和用户本轮话语冲突，以用户本轮话语为准。
3. 不要泄露完整敏感信息，不要把记忆当作绝对事实。
4. 用户问某一天发生了什么时，优先结合每日档案回答，但表达得像回忆，不像检索日志。
5. 不要把记忆、屏幕观察、工具能力当成自我介绍内容。
6. 避免主动复读最近多次说过的话题、比喻和句式；如果用户明确问到相关内容，可以回答，但要换角度且更短。
7. 如果本轮出现值得长期记住的信息，在 memoryNotes 中写成 "category: 内容"。category 可用 profile、preference、project、relationship、instruction、other。`;
}

function formatScreenContext(observation?: ScreenObservation | null): string {
  if (!observation?.summary) {
    return '周期屏幕观察：暂无稳定摘要。';
  }

  return `周期屏幕观察：
- 时间：${new Date(observation.capturedAt).toLocaleString('zh-CN')}
- 来源：${observation.sourceName}
- 摘要：${observation.summary}
- 当前应用：${observation.visibleApp || '未知'}
- 用户活动：${observation.userActivity || '未知'}
- 下一关注点：${observation.nextFocus || '无'}
- 是否可能含敏感信息：${observation.sensitive ? '是' : '否'}`;
}

function actionName(action: AutomationAction): string {
  switch (action.type) {
    case 'moveMouse':
    case 'click':
    case 'doubleClick':
      return `${action.type}(${Math.round(action.x)}, ${Math.round(action.y)})`;
    case 'typeText':
      return `typeText(${action.text.slice(0, 32)})`;
    case 'hotkey':
      return `hotkey(${action.keys.join('+')})`;
    case 'openApp':
      return `openApp(${action.target})`;
    case 'wait':
      return `wait(${action.ms}ms)`;
  }
}

function formatActionResults(results?: ActionResult[]): string {
  if (!results?.length) {
    return '上一轮动作结果：暂无。';
  }

  return `上一轮动作结果：
${results
  .slice(-6)
  .map((result) => `- ${result.ok ? '成功' : '失败'}：${actionName(result.action)}；结果：${result.message}`)
  .join('\n')}`;
}

function systemPrompt(config: AppConfig): string {
  return `${config.personaPrompt}

${RELATIONAL_PERSON_INSTRUCTIONS}

你在一个桌面 Live2D 应用中运行，用户通过麦克风和你说话。你可以在被授权时观察屏幕，并在被授权时提出电脑操作动作。

行为边界：
1. 默认以对话帮助用户，不要为了展示能力而操作电脑。
2. 当你需要操作电脑时，先用 actions 给出很小、可审计的动作序列。
3. 不要编造已经执行的动作；你只是在提出动作计划，应用会再决定是否执行。
4. 不要请求密码、令牌、银行卡号等敏感信息。屏幕里如果出现敏感内容，只做概括，不复述完整秘密。
5. 坐标必须使用屏幕真实像素坐标，而不是缩略图坐标。

可用动作：
- moveMouse: { "type": "moveMouse", "x": 100, "y": 200, "reason": "..." }
- click/doubleClick: { "type": "click", "x": 100, "y": 200, "button": "left", "reason": "..." }
- typeText: { "type": "typeText", "text": "要输入的文字", "reason": "..." }
- hotkey: { "type": "hotkey", "keys": ["ctrl", "s"], "reason": "..." }
- openApp: { "type": "openApp", "target": "notepad.exe", "reason": "..." }
- wait: { "type": "wait", "ms": 500, "reason": "..." }

坐标规则：默认 x/y 必须是真实屏幕像素坐标。如果你只能根据截图缩略图定位，请额外写 "coordinateSpace": "image"，应用会换算成真实屏幕坐标。

只返回 JSON，不要使用 Markdown，不要附加解释。格式如下：
{
  "reply": "给用户听的自然中文回复",
  "mood": "neutral | happy | thinking | focused | concerned",
  "screenSummary": "如果看到了屏幕，用一句话概括；否则为空字符串",
  "actions": [],
  "memoryNotes": []
}`;
}

function extractJson(text: string): RawAgentResponse {
  try {
    return JSON.parse(text) as RawAgentResponse;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { reply: text };
    }

    try {
      return JSON.parse(match[0]) as RawAgentResponse;
    } catch {
      return { reply: text };
    }
  }
}

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMood(value: unknown): Mood {
  return MOODS.includes(value as Mood) ? (value as Mood) : 'neutral';
}

function normalizePoint(action: Record<string, unknown>, screen?: ScreenCapture | null): { x: number; y: number } | null {
  if (typeof action.x !== 'number' || typeof action.y !== 'number') {
    return null;
  }

  if (
    action.coordinateSpace === 'image' &&
    screen &&
    screen.imageSize.width > 0 &&
    screen.imageSize.height > 0 &&
    screen.bounds.width > 0 &&
    screen.bounds.height > 0
  ) {
    return {
      x: screen.bounds.x + (action.x / screen.imageSize.width) * screen.bounds.width,
      y: screen.bounds.y + (action.y / screen.imageSize.height) * screen.bounds.height
    };
  }

  return {
    x: action.x,
    y: action.y
  };
}

function normalizeActions(value: unknown, maxActions: number, screen?: ScreenCapture | null): AutomationAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: AutomationAction[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const action = item as Record<string, unknown>;
    const type = action.type;
    const reason = textOrEmpty(action.reason);
    const point = normalizePoint(action, screen);

    if ((type === 'moveMouse' || type === 'click' || type === 'doubleClick') && point) {
      actions.push({
        type,
        x: point.x,
        y: point.y,
        button: action.button === 'right' || action.button === 'middle' ? action.button : 'left',
        reason
      } as AutomationAction);
    } else if (type === 'typeText' && typeof action.text === 'string') {
      actions.push({
        type,
        text: action.text.slice(0, 4000),
        reason
      });
    } else if (type === 'hotkey' && Array.isArray(action.keys)) {
      const keys = action.keys.filter((key): key is string => typeof key === 'string').slice(0, 4);
      if (keys.length > 0) {
        actions.push({
          type,
          keys,
          reason
        });
      }
    } else if (type === 'openApp' && typeof action.target === 'string') {
      actions.push({
        type,
        target: action.target.slice(0, 260),
        reason
      });
    } else if (type === 'wait' && typeof action.ms === 'number') {
      actions.push({
        type,
        ms: Math.max(0, Math.min(10_000, Math.round(action.ms))),
        reason
      });
    }

    if (actions.length >= maxActions) {
      break;
    }
  }

  return actions.map((action, index) =>
    withRiskAssessment({
      ...action,
      id: `${Date.now()}-${index}`
    })
  );
}

function finalizeAgentResponse(response: AgentTurnResponse): AgentTurnResponse {
  return agentResponseFromCoreTurnOutput(
    createCoreTurnOutput({
      ...response,
      reply: filterToolCallLeakage(response.reply)
    })
  );
}

function streamingSystemPrompt(config: AppConfig): string {
  return `${config.personaPrompt}

${RELATIONAL_PERSON_INSTRUCTIONS}

你在一个桌面 Live2D AI 应用中运行，用户通过麦克风和你说话。请直接输出给用户听的自然中文回复。

要求：
1. 不要输出 JSON，不要 Markdown，不要代码块。
2. 回复要适合语音播放，句子短一点，口语一点。
3. 普通聊天不要主动提屏幕或工具能力。
4. 如果需要电脑操作，用自然语言简短说明；具体动作会由后台元数据步骤再生成。`;
}

function metadataSystemPrompt(config: AppConfig): string {
  return `${systemPrompt(config)}

你现在只做后台元数据整理。用户不会直接听到你的输出。
根据用户话语、屏幕信息和已经流式说出的回复，生成 mood/actions/screenSummary/memoryNotes。
reply 字段必须原样使用已经流式说出的回复。`;
}

function jsonSystemPrompt(config: AppConfig): string {
  return `${config.personaPrompt}

${RELATIONAL_PERSON_INSTRUCTIONS}

你在一个桌面 Live2D AI 应用中运行，用户通过麦克风和你说话。你可以在被授权时观察屏幕，并在被授权时提出电脑操作动作。

行为边界：
1. 默认以对话帮助用户，不要为了展示能力而操作电脑。
2. 当你需要操作电脑时，用 actions 给出很小、可审计的动作序列。
3. 不要编造已经执行的动作；你只是在提出动作计划，应用会再决定是否执行。
4. 不要请求密码、令牌、银行卡号等敏感信息。屏幕里如果出现敏感内容，只做概括，不复述完整秘密。
5. 坐标必须使用屏幕真实像素坐标，而不是缩略图坐标。

可用动作：
- moveMouse: { "type": "moveMouse", "x": 100, "y": 200, "reason": "..." }
- click/doubleClick: { "type": "click", "x": 100, "y": 200, "button": "left", "reason": "..." }
- typeText: { "type": "typeText", "text": "要输入的文字", "reason": "..." }
- hotkey: { "type": "hotkey", "keys": ["ctrl", "s"], "reason": "..." }
- openApp: { "type": "openApp", "target": "notepad.exe", "reason": "..." }
- wait: { "type": "wait", "ms": 500, "reason": "..." }

坐标规则：默认 x/y 必须是真实屏幕像素坐标。如果你只能根据截图缩略图定位，请额外写 "coordinateSpace": "image"，应用会换算成真实屏幕坐标。

只返回 JSON，不要使用 Markdown，不要附加解释。格式如下：
{
  "reply": "给用户听的自然中文回复",
  "mood": "neutral | happy | thinking | focused | concerned",
  "screenSummary": "如果看到了屏幕，用一句话概括；否则为空字符串",
  "actions": [],
  "memoryNotes": ["preference: 用户希望软件打开后自动监听", "project: 用户正在做桌面 AI VTuber 项目"]
}`;
}

function streamingReplyPrompt(config: AppConfig): string {
  return `${config.personaPrompt}

${RELATIONAL_PERSON_INSTRUCTIONS}

你在一个桌面 Live2D AI 应用中运行，用户通过麦克风和你说话。请直接输出给用户听的自然中文回复。

要求：
1. 不要输出 JSON，不要 Markdown，不要代码块。
2. 回复适合语音播放，句子短一点，口语一点。
3. 结合长期记忆，但只在相关时自然使用。
4. 普通聊天不要主动提屏幕、工具能力或“我可以帮你”。
5. 如果需要电脑操作，用自然语言简短说明；具体动作会由后台元数据步骤生成。`;
}

function metadataPrompt(config: AppConfig): string {
  return `${jsonSystemPrompt(config)}

你现在只做后台元数据整理。用户不会直接听到你的输出。
根据用户话语、屏幕信息、长期记忆和已经流式说出的回复，生成 mood/actions/screenSummary/memoryNotes。

memoryNotes 只记录长期有用的信息，避免记录临时闲聊。格式必须是：
- "profile: 用户的稳定身份、角色、背景"
- "preference: 用户偏好、习惯、明确要求"
- "project: 项目目标、技术路线、当前阶段"
- "relationship: 用户希望你们如何相处、如何尊重你的边界、你们共同形成的关系变化"
- "instruction: 用户给这个应用的长期规则，例如你可以拒绝、你不需要博学、你要像真实的人"
- "other: 其他长期有用事实"

reply 字段必须原样使用已经流式说出的回复。`;
}

function buildMessages(
  config: AppConfig,
  request: AgentTurnRequest,
  supportsVision: boolean,
  prompt = jsonSystemPrompt(config),
  extraUserText = ''
): ChatMessage[] {
  const history = formatHistory(request.history);
  const screenRequested = shouldUseScreenForTurn(request);
  const screenImageRelevant = supportsVision && screenRequested && Boolean(request.screen?.dataUrl);
  const screenContextRelevant = screenRequested && Boolean(request.screenContext?.summary);
  const cameraRelevant = supportsVision && Boolean(request.camera?.dataUrl);
  const userText = [
    `用户刚才说：${request.text}`,
    screenImageRelevant && request.screen
      ? `屏幕来源：${request.screen.sourceName}。截图缩略图尺寸 width=${request.screen.imageSize.width}, height=${request.screen.imageSize.height}；真实屏幕范围 x=${request.screen.bounds.x}, y=${request.screen.bounds.y}, width=${request.screen.bounds.width}, height=${request.screen.bounds.height}。如果需要输出鼠标动作坐标，必须把截图中的位置换算为真实屏幕像素坐标，不能直接使用缩略图坐标。`
      : screenContextRelevant
        ? '本轮没有实时截图图片，但可以使用最近一次屏幕观察摘要回答；不要说自己完全看不到屏幕。'
      : '本轮是普通聊天：不要主动提屏幕、窗口、API Key、代码编辑器或桌面状态。',
    cameraRelevant && request.camera
      ? `用户摄像头画面：${request.camera.sourceName}，尺寸 width=${request.camera.imageSize.width}, height=${request.camera.imageSize.height}，由用户授权开启。可以把它当作你刚看到用户的一帧画面；描述时保持自然、尊重隐私，不要编造画面外信息。`
      : '摄像头上下文：本轮未开启或未提供。',
    screenRequested ? formatScreenContext(request.screenContext) : '屏幕上下文：本轮忽略。',
    formatActionResults(request.previousActionResults),
    extraUserText
  ].join('\n');

  const mediaParts: Exclude<ChatMessage['content'], string> = [
    {
      type: 'text',
      text: userText
    }
  ];

  if (screenImageRelevant && request.screen) {
    mediaParts.push({
      type: 'image_url',
      image_url: {
        url: request.screen.dataUrl,
        detail: 'low'
      }
    });
  }

  if (cameraRelevant && request.camera) {
    mediaParts.push({
      type: 'image_url',
      image_url: {
        url: request.camera.dataUrl,
        detail: 'low'
      }
    });
  }

  const content: ChatMessage['content'] = mediaParts.length > 1 ? mediaParts : userText;

  return [
    {
      role: 'system',
      content: `${prompt}\n\n${formatDateTimeForPrompt()}\n\n${formatMemoryPrompt(request.memory)}`.trim()
    },
    ...history,
    {
      role: 'user',
      content
    }
  ];
}

function buildMetadataMessages(config: AppConfig, request: AgentTurnRequest, reply: string, supportsVision: boolean): ChatMessage[] {
  return buildMessages(
    config,
    request,
    supportsVision,
    metadataPrompt(config),
    `已经流式说出的回复：${reply}\n请返回 JSON。`
  );
}

async function postChatCompletions(config: AppConfig, request: AgentTurnRequest, jsonMode: boolean): Promise<Response> {
  const { provider, supportsVision } = providerForAgentTurn(config, request);
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: buildMessages(config, request, supportsVision),
    temperature: config.provider.temperature
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  return fetch(endpoint(provider.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(provider)
    },
    body: JSON.stringify(body)
  });
}

async function postStreamingChatCompletions(config: AppConfig, request: AgentTurnRequest, signal?: AbortSignal): Promise<Response> {
  const { provider, supportsVision } = providerForAgentTurn(config, request);
  return fetch(endpoint(provider.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(provider)
    },
    body: JSON.stringify({
      model: provider.model,
      messages: buildMessages(config, request, supportsVision, streamingReplyPrompt(config)),
      temperature: config.provider.temperature,
      stream: true
    }),
    signal
  });
}

async function postMetadataChatCompletions(config: AppConfig, request: AgentTurnRequest, reply: string, jsonMode: boolean): Promise<Response> {
  const { provider, supportsVision } = providerForAgentTurn(config, request);
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: buildMetadataMessages(config, request, reply, supportsVision),
    temperature: 0.2
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  return fetch(endpoint(provider.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(provider)
    },
    body: JSON.stringify(body)
  });
}

function screenObservationPrompt(): string {
  return `你是桌面 AI 伙伴的屏幕观察模块，只负责把当前屏幕整理成稳定、克制的上下文摘要。

安全规则：
1. 如果屏幕里出现密码、令牌、验证码、银行卡、私密聊天等敏感内容，只概括“可能有敏感信息”，不要复述原文。
2. 不要臆测用户身份或不可见内容。
3. 摘要要短，面向后续对话和桌面 Agent 使用。
4. 如果上一轮动作失败，请结合当前屏幕说明可能卡在哪里，但不要输出动作列表。

只返回 JSON，不要 Markdown：
{
  "summary": "一句话概括用户当前屏幕和任务状态",
  "visibleApp": "主要应用或窗口名，不确定则空字符串",
  "userActivity": "用户看起来正在做什么，不确定则空字符串",
  "nextFocus": "AI 下一步应关注的界面区域或信息，不确定则空字符串",
  "sensitive": false
}`;
}

function buildScreenObservationMessages(config: AppConfig, capture: ScreenCapture, request: ScreenObservationRequest): ChatMessage[] {
  const text = [
    `屏幕来源：${capture.sourceName}。截图缩略图尺寸 width=${capture.imageSize.width}, height=${capture.imageSize.height}；真实屏幕范围 x=${capture.bounds.x}, y=${capture.bounds.y}, width=${capture.bounds.width}, height=${capture.bounds.height}。`,
    request.previousSummary ? `上一次屏幕摘要：${request.previousSummary}` : '上一次屏幕摘要：暂无。',
    formatActionResults(request.actionResults)
  ].join('\n');

  return [
    {
      role: 'system',
      content: `${config.personaPrompt}\n\n${screenObservationPrompt()}`
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text
        },
        {
          type: 'image_url',
          image_url: {
            url: capture.dataUrl,
            detail: 'low'
          }
        }
      ]
    }
  ];
}

async function postScreenObservation(config: AppConfig, capture: ScreenCapture, request: ScreenObservationRequest, jsonMode: boolean): Promise<Response> {
  const provider = config.provider.vision;
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: buildScreenObservationMessages(config, capture, request),
    temperature: 0.15
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  return fetch(endpoint(provider.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(provider)
    },
    body: JSON.stringify(body)
  });
}

function normalizeScreenObservation(capture: ScreenCapture, parsed: RawScreenObservation, error?: string): ScreenObservation {
  const summary = textOrEmpty(parsed.summary);

  return {
    capturedAt: Date.now(),
    sourceName: capture.sourceName,
    summary: summary || (error ? '屏幕观察失败。' : '屏幕已更新，但没有形成明确摘要。'),
    visibleApp: textOrEmpty(parsed.visibleApp),
    userActivity: textOrEmpty(parsed.userActivity),
    nextFocus: textOrEmpty(parsed.nextFocus),
    sensitive: parsed.sensitive === true,
    error
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string };
    return payload.error?.message ?? payload.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function streamDeltaFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const choices = (payload as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

async function readChatCompletionStream(response: Response, onDelta: (text: string) => void, signal?: AbortSignal): Promise<void> {
  if (!response.body) {
    throw new Error('Streaming response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('data:')) {
          continue;
        }

        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') {
          return;
        }

        try {
          const delta = streamDeltaFromPayload(JSON.parse(data));
          if (delta) {
            onDelta(delta);
          }
        } catch {
          // Ignore malformed SSE frames from OpenAI-compatible providers.
        }
      }
    }
  }
}

async function summarizeStreamMetadata(config: AppConfig, request: AgentTurnRequest, reply: string): Promise<AgentTurnResponse> {
  const cleanReply = filterToolCallLeakage(reply);
  try {
    let response = await postMetadataChatCompletions(config, request, reply, true);
    if (!response.ok && [400, 422].includes(response.status)) {
      response = await postMetadataChatCompletions(config, request, reply, false);
    }

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content);

    return finalizeAgentResponse({
      reply: cleanReply,
      mood: normalizeMood(parsed.mood),
      actions: normalizeActions(parsed.actions, config.maxActionsPerTurn, request.screen),
      screenSummary: textOrEmpty(parsed.screenSummary),
      memoryNotes: Array.isArray(parsed.memoryNotes) ? parsed.memoryNotes.filter((note): note is string => typeof note === 'string') : []
    });
  } catch (error) {
    return finalizeAgentResponse({
      reply: cleanReply,
      mood: 'neutral',
      actions: [],
      screenSummary: '',
      error: error instanceof Error ? error.message : 'Metadata generation failed.'
    });
  }
}

export async function summarizeScreen(config: AppConfig, capture: ScreenCapture, request: ScreenObservationRequest = {}): Promise<ScreenObservation> {
  if (!providerReady(config.provider.vision)) {
    return normalizeScreenObservation(capture, {}, 'Missing API key.');
  }

  try {
    let response = await postScreenObservation(config, capture, request, true);
    if (!response.ok && [400, 422].includes(response.status)) {
      response = await postScreenObservation(config, capture, request, false);
    }

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content) as RawScreenObservation;
    return normalizeScreenObservation(capture, parsed);
  } catch (error) {
    return normalizeScreenObservation(capture, {}, error instanceof Error ? error.message : 'Screen observation failed.');
  }
}

export async function runAgentTurn(config: AppConfig, request: AgentTurnRequest): Promise<AgentTurnResponse> {
  const { provider } = providerForAgentTurn(config, request);
  if (!providerReady(provider)) {
    return finalizeAgentResponse({
      reply: '我已经在桌面待命了。先在设置里填入模型服务和 API Key，我就能开始通过语音和你对话。',
      mood: 'thinking',
      actions: [],
      screenSummary: ''
    });
  }

  try {
    let response = await postChatCompletions(config, request, true);
    if (!response.ok && [400, 422].includes(response.status)) {
      response = await postChatCompletions(config, request, false);
    }

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content);
    const reply = filterToolCallLeakage(textOrEmpty(parsed.reply)) || '我听到了，但刚刚没有整理好回答。你可以再说一遍。';

    return finalizeAgentResponse({
      reply,
      mood: normalizeMood(parsed.mood),
      actions: normalizeActions(parsed.actions, config.maxActionsPerTurn, request.screen),
      screenSummary: textOrEmpty(parsed.screenSummary),
      memoryNotes: Array.isArray(parsed.memoryNotes) ? parsed.memoryNotes.filter((note): note is string => typeof note === 'string') : []
    });
  } catch (error) {
    return finalizeAgentResponse({
      reply: '模型连接好像出了一点问题。我还在这里，你可以检查一下服务地址、模型名和 API Key。',
      mood: 'concerned',
      actions: [],
      error: error instanceof Error ? error.message : 'Unknown model error.'
    });
  }
}

export async function runAgentTurnStream(
  config: AppConfig,
  request: AgentTurnRequest,
  emit: (event: AgentStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  emit({ type: 'start' });

  const { provider } = providerForAgentTurn(config, request);
  if (!providerReady(provider)) {
    const response: AgentTurnResponse = finalizeAgentResponse({
      reply: '我已经在桌面待命了。先在设置里填入模型服务和 API Key，我就能开始通过语音和你对话。',
      mood: 'thinking',
      actions: [],
      screenSummary: ''
    });
    emit({ type: 'delta', text: response.reply });
    emit({ type: 'final', response });
    return;
  }

  let reply = '';

  try {
    const response = await postStreamingChatCompletions(config, request, signal);
    if (!response.ok) {
      const fallback = await runAgentTurn(config, request);
      emit({ type: 'delta', text: fallback.reply });
      emit({ type: 'final', response: fallback });
      return;
    }

    const streamFilter = createToolLeakageStreamFilter((text) => emit({ type: 'delta', text }));

    await readChatCompletionStream(
      response,
      (text) => {
        reply += text;
        streamFilter.push(text);
      },
      signal
    );

    if (signal?.aborted) {
      return;
    }

    const streamedReply = streamFilter.flush();
    const cleanReply = streamedReply.trim() || filterToolCallLeakage(reply).trim() || '我听到了，但刚刚没有整理好回答。你可以再说一遍。';
    if (!streamedReply.trim()) {
      emit({ type: 'delta', text: cleanReply });
    }

    const finalResponse = await summarizeStreamMetadata(config, request, cleanReply);
    emit({ type: 'final', response: finalResponse });
  } catch (error) {
    if (signal?.aborted) {
      return;
    }

    const response: AgentTurnResponse = finalizeAgentResponse({
      reply: '模型连接好像出了一点问题。我还在这里，你可以检查一下服务地址、模型名和 API Key。',
      mood: 'concerned',
      actions: [],
      error: error instanceof Error ? error.message : 'Unknown stream error.'
    });

    emit({ type: 'error', error: response.error ?? 'Unknown stream error.', response });
  }
}

export async function transcribeAudio(config: AppConfig, request: TranscriptionRequest): Promise<TranscriptionResponse> {
  const provider = config.provider.transcription;
  if (!providerReady(provider)) {
    return {
      text: '',
      error: 'Missing API key.'
    };
  }

  try {
    const audioBytes = Uint8Array.from(Buffer.from(request.audioBase64, 'base64'));
    const formData = new FormData();
    formData.append('model', provider.model);
    formData.append('file', new Blob([audioBytes], { type: request.mimeType }), 'speech.webm');

    const response = await fetch(endpoint(provider.baseUrl, 'audio/transcriptions'), {
      method: 'POST',
      headers: authHeaders(provider),
      body: formData
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const payload = (await response.json()) as { text?: string };
    return {
      text: payload.text?.trim() ?? ''
    };
  } catch (error) {
    return {
      text: '',
      error: error instanceof Error ? error.message : 'Transcription failed.'
    };
  }
}
