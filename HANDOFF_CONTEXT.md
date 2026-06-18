# Virtual Lover 交接上下文

当前日期：2026-05-06

## 项目目标

这是一个 Electron + React + TypeScript 桌面 Live2D AI 伙伴原型，目标接近 Neuro-sama 的常驻桌面形态：

- 桌面常驻 Live2D 角色
- 打开软件后自动监听麦克风
- 用户直接语音对话，不依赖手动输入弹窗
- 流式模型回复 + TTS 分句播放
- 屏幕观察和视觉摘要
- 受控桌面操作，带风险分级和确认队列
- 长期记忆和人格一致性

## 已完成阶段

- Phase 0：Electron 桌面窗口、配置页、Live2D 加载入口。
- Phase 1：自动麦克风监听、VAD 自动断句、录音转写。
- Phase 2：对话流式生成、TTS 分句播放、回复中断后回到监听。
- Phase 3：Live2D 表情、动作、口型驱动初版。
- Phase 4：长期记忆、对话摘要、用户偏好和项目事实存储。
- Phase 5：周期屏幕观察、视觉摘要、动作风险分级、失败动作自修正。

路线图文件：[PROJECT_PLAN.md](E:/myProject/claude/virtual_lover/PROJECT_PLAN.md)

## 关键文件

- [src/renderer/App.tsx](E:/myProject/claude/virtual_lover/src/renderer/App.tsx)：前端主组件，包含 Live2D、语音监听、TTS、消息流、屏幕观察 UI、动作队列。
- [src/main/llm.ts](E:/myProject/claude/virtual_lover/src/main/llm.ts)：OpenAI-compatible chat/vision/transcription 请求、streaming、metadata、屏幕摘要。
- [src/main/main.ts](E:/myProject/claude/virtual_lover/src/main/main.ts)：Electron IPC、窗口、屏幕/动作/记忆/模型调用桥接。
- [src/main/automation.ts](E:/myProject/claude/virtual_lover/src/main/automation.ts)：Windows PowerShell 自动化执行。
- [src/main/memory.ts](E:/myProject/claude/virtual_lover/src/main/memory.ts)：长期记忆读写和合并。
- [src/shared/types.ts](E:/myProject/claude/virtual_lover/src/shared/types.ts)：共享类型、默认配置、Live2D 模型预设。
- [src/shared/risk.ts](E:/myProject/claude/virtual_lover/src/shared/risk.ts)：动作风险评估。
- [index.html](E:/myProject/claude/virtual_lover/index.html)：加载本地 Cubism runtime。
- [public/live2dcubismcore.min.js](E:/myProject/claude/virtual_lover/public/live2dcubismcore.min.js)：本地 Live2D Cubism 4 runtime。

## 最近一次对话完成的改动

### 1. Live2D 模型预设

用户要求“在网络上搜集好看的 Live2D 模型并替换到项目中”。

做法：

- 没使用版权不明的二创模型。
- 使用 Live2D 官方示例资源：[Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources)
- 通过 jsDelivr 加载 `model3.json`。
- 在 `src/shared/types.ts` 增加 `LIVE2D_MODEL_PRESETS`：
  - Hiyori
  - Mao
  - Natori
  - Rice
  - Haru
  - Ren
- 默认模型改为 Hiyori。
- 设置页新增 `Live2D 预设` 下拉。
- 旧默认 Haru 测试 URL 会自动迁移到新默认 Hiyori；用户自定义 URL 不覆盖。

### 2. 真正修复 Live2D 不生效

用户截图显示仍是备用圆脸形象。

排查结果：

- 本地配置已经换成了官方 `model3.json`，所以不是 URL 没保存。
- 真正问题有两层：
  - 缺少 Cubism 4 runtime。
  - Pixi 在当前 CSP 下禁止 `unsafe-eval`，Live2D 初始化失败。

修复：

- 安装依赖：
  - `live2dcubismcore`
  - `@pixi/unsafe-eval@6.5.10`
- 将 `node_modules/live2dcubismcore/live2dcubismcore.min.js` 复制到 `public/live2dcubismcore.min.js`。
- `index.html` 改为从本地加载 `/live2dcubismcore.min.js`。
- 在 Live2D 初始化时执行：

```ts
const { install } = await import('@pixi/unsafe-eval');
install({ ShaderSystem: PIXI.ShaderSystem });
```

- 手动截图确认过：真实 Live2D 角色已经显示，不再是备用形象。

### 3. Live2D 语音联动和看向镜头

用户反馈：

- 语音回复时模型没有和语音联动。
- 正常情况下模型应该看向镜头，也就是看向电脑前的用户。

最近已改但还需要人工验证：

- `Live2DModel.from(...)` 改成：

```ts
Live2DModel.from(modelUrl, { autoInteract: false, autoUpdate: false })
```

- 在 Pixi ticker 中改为由应用掌控更新顺序：
  - 先调用 `liveModel.update(app.ticker.deltaMS)`
  - 再写入自定义参数
  - 这样避免口型和视线被 Live2D motion/update 同帧覆盖
- 默认视线改成正视镜头：
  - idle/listening/speaking：`focusX = 0`, `focusY = 0`
  - thinking：允许轻微偏头 `focusX = -0.1`, `focusY = 0.08`
- 显式写入：
  - `ParamMouthOpenY`
  - `ParamEyeBallX`
  - `ParamEyeBallY`
  - `ParamAngleX`
  - `ParamAngleY`
  - `ParamBodyAngleX`
- TTS 口型包络增强：
  - 仍保留时间估算口型。
  - 增加 `SpeechSynthesisUtterance.onboundary`，如果系统 TTS 发 boundary 事件，会按字符推进打短促开口峰值。

最后一次中断前状态：

- `npm run build` 已通过。
- `npm run preview` 已重启。
- 还没有人工确认“播放语音时嘴型是否明显联动”。

## 当前运行和环境

- 工作目录：`E:\myProject\claude\virtual_lover`
- Shell：PowerShell
- 不是 git 仓库，`git status` 会失败。
- 当前 Electron 预览通常通过 `npm run preview` 后台运行。
- 用户本地配置文件在：
  - `C:\Users\25024\AppData\Roaming\virtual-lover\config.json`
- 该配置里用户填了模型服务、API Key、视觉模型、转写模型等。不要覆盖用户的 API 配置。

## 验证过的命令

```bash
npm run build
```

多次通过。

预览启动方式：

```bash
npm run preview
```

如果需要重启预览，可先停止与当前 workspace 相关的 `cmd.exe/node.exe/electron.exe/esbuild.exe`，再启动 `npm run preview`。

## 接下来建议做什么

### 优先级 1：验证并完善语音口型联动

现在代码已改，但需要实际触发 TTS 验证：

- 打开设置，确保 `语音回复` 开启。
- 让模型说一段较长回复。
- 观察 `ParamMouthOpenY` 是否随语音明显开合。

如果仍不明显，下一步建议：

- 加一个开发用“测试说话”按钮，直接播放固定 TTS 文本，绕过模型和麦克风，快速验证口型。
- 在 UI 暂时显示 `speechLevel` 数值条，确认前端口型包络是否在变。
- 如果 `speechLevel` 在变但模型嘴不动，说明仍是参数写入或参数名问题。
- 如果 `speechLevel` 不变，说明 TTS 事件/播放链问题。

### 优先级 2：更真实的音频驱动

现在是 Web Speech TTS 的文本/时间包络，不是真实音频能量。

后续可以改成：

- 使用可控 TTS 服务生成音频流。
- 通过 WebAudio `AnalyserNode` 分析播放音频能量。
- 用真实 RMS/频段能量驱动 `ParamMouthOpenY`。

这样会比 Web Speech API 的 `boundary` 更稳定，也更接近 Neuro 的实时口型。

### 优先级 3：模型居中和预设体验

当前真实 Live2D 已能显示，但不同模型高度和比例不一样。

建议：

- 给每个 Live2D 预设增加 layout 配置：
  - `scale`
  - `offsetX`
  - `offsetY`
- 设置页加“模型大小/位置”滑条。
- 保存到 `config.live2d`。

### 优先级 4：去掉临时调试残留

已清理过临时截图和主进程 console 转发，但后续若继续调试，可以临时加回 Live2D 错误日志。

备用形象现在有 `title` 失败原因，鼠标悬停可看到加载错误。

## 注意事项

- 不要覆盖用户的 `config.json` API Key 和模型服务配置。
- 不要把 `git reset`、`git checkout --` 用在这个目录，因为不是 git 仓库，而且用户可能有本地改动。
- 代码编辑请继续用 `apply_patch`。
- 网络模型资源优先使用官方或授权明确来源。
- Live2D 官方模型来源目前是 CubismWebSamples，README 已记录。

## 2026-05-07 继续开发记录

本轮已继续推进优先级 1 和优先级 3：

- 在底部语音栏新增“测试说话”按钮，直接触发固定 TTS 文本，绕过模型回复和麦克风，方便单独验证 Live2D 口型。
- 在底部语音栏新增可见的 `口型 xx%` 电平条，用于确认 `speechLevel` 包络是否在 TTS 播放时变化。
- 测试说话时如果正在监听，会先无提交暂停当前录音，避免把系统 TTS 又录回麦克风。
- `src/shared/types.ts` 为 `live2d` 增加 `scale`、`offsetX`、`offsetY`，旧配置会通过默认配置自动补齐。
- 每个官方 Live2D 预设增加推荐 layout；切换预设时会同步应用模型大小和位置。
- 设置页新增“模型大小 / 水平位置 / 垂直位置 / 重置位置”控件，便于按不同模型微调居中效果。
- `npm run build` 已通过。
- `npm run preview` 已重启，当前 Electron 预览正在运行新版构建。

下一步建议：

- 人工点击底部 `测试说话` 按钮，观察真实 Live2D 的嘴部是否随语音明显开合，同时确认口型电平条是否变化。
- 如果电平条变化但嘴不动，继续排查模型参数名或 Cubism 参数写入；如果电平条不变，继续排查 Web Speech TTS 的 `onstart/onboundary/onend` 链路。
- 根据实际截图微调各预设 layout 的默认值，尤其是 Mao/Haru/Ren 的高度和底部位置。

### 口型只在少数字上变化的修复

用户反馈“比如说了 20 个字，但是最多只有 5 个字使口型发生了变化”。原因基本确定是 Web Speech 的 `boundary` 事件在中文 TTS 下太稀疏，且旧逻辑用 `boundary.charIndex` 判断口型进度；如果 `charIndex` 很快跳到句末，包络会提前进入低幅度收尾。

已改为：

- `boundary` 只提供短促开口峰值，不再决定整体进度。
- 只要 TTS 还没触发 `onend/onerror`，就持续按虚拟字符节奏生成口型起伏。
- 口型刷新间隔从 70ms 改为 52ms。
- `npm run build` 已通过，`npm run preview` 已重启。

### 默认动作/表情抢占口型的修复

用户继续反馈：部分 Live2D 官方模型的默认 motion/expression 本身会张嘴，播放这些动作时会打断 TTS 口型变化。

已改为：

- 进入 `speaking` activity 时调用 `internalModel.motionManager.stopAllMotions()`，停掉正在播的 idle/listening 默认动作。
- 进入 `speaking` activity 时也尝试调用 `expressionManager.stopAllExpressions()`，避免表情 motion 在说话期间写嘴部参数。
- 说话期间不再启动新的 Live2D motion/expression；说完回到 idle/listening 后再恢复表情和动作。
- `ParamMouthOpenY` 改为每帧最后写入，确保模型自带参数更新、mood 参数更新之后，最终由 TTS 包络接管嘴部。
- `npm run build` 已通过，`npm run preview` 已重启。

用户再次反馈仍然会被自带表情口型遮挡。进一步排查 `pixi-live2d-display` 后发现更关键的问题是：旧代码在 `liveModel.update()` 之后写嘴部参数，但 Cubism 的 `model.update()` 已经在 `liveModel.update()` 内部执行完了，写得太晚，未必能参与本帧网格刷新。

已进一步改为：

- 把自定义 Live2D 参数写入注册到 internal model 的 `beforeModelUpdate` 事件。
- 现在参数会在 motion/expression/physics/pose 都算完之后、Cubism `model.update()` 之前写入。
- 说话态跳过 mood 里的 mouth 参数，不再让 `ParamMouthForm` 参与表情嘴型。
- 说话态强制锁住常见嘴型参数：`ParamMouthForm`、`ParamMouthSmile`、`ParamMouthOpenX`、`ParamMouthAngle`、`ParamMouthPucker` 等。
- `ParamMouthOpenY` 仍由 TTS `speechLevel` 最终控制。
- `npm run build` 已通过，`npm run preview` 已重启。

### 口型一直圆形张开的问题修复

用户继续反馈：口型不再被表情遮挡后，变成“只开不合”，说话期间嘴一直是圆形。

原因：

- 上一版 TTS 包络最低值太高，目标电平几乎一直维持在 40% 以上。
- 说话态把 `ParamMouthForm` 固定为 0，很多 Live2D 模型上会呈现稳定圆口。

已改为：

- TTS 包络改成明确的 syllable phase：每个虚拟字符周期都用 `sin(pi * phase)` 形成开合谷值。
- 下行 smoothing 提高，让嘴能更快合上。
- 口型刷新间隔改为 46ms。
- `ParamMouthForm` 不再固定锁 0，而是在说话期间由应用轻微动态驱动，避免全程圆口。
- `npm run build` 已通过，`npm run preview` 已重启。

### 口型闪烁过快的调参

用户反馈：现在有开合了，但是嘴型闪烁太快。

已调慢：

- 虚拟字符开合周期从约 `132ms` 改为约 `190ms`，并限制在 `135ms - 300ms`。
- `ParamMouthForm` 动态频率从 `82ms/137ms` 改为 `260ms/420ms`，幅度也降低。
- 细碎 consonant/vowel 抖动幅度降低，周期拉长。
- speechLevel smoothing 降低，更新间隔从 `46ms` 改为 `58ms`。
- `npm run build` 已通过，`npm run preview` 已重启。

## 2026-05-07 Edge TTS 接入记录

用户表示无法使用 OpenAI TTS，因为银行卡无法支付 OpenAI API。已先接入不需要 OpenAI Key 的 Microsoft Edge 在线 TTS 方案。

实现：

- 安装依赖：`node-edge-tts`（MIT）。
- 新增 [src/main/tts.ts](E:/myProject/claude/virtual_lover/src/main/tts.ts)，主进程用 Edge TTS 生成临时 mp3，读取为 base64 后删除临时文件。
- 新增 IPC：`audio:synthesizeSpeech`。
- preload 新增 `window.lover.synthesizeSpeech(...)`。
- `VoiceConfig` 新增：
  - `ttsProvider: 'system' | 'edge'`
  - `edgeVoice`
- 默认 TTS 引擎改为 `edge`，默认声音 `zh-CN-XiaoxiaoNeural`。
- 设置页新增 `TTS 引擎` 和 `Edge 声音` 下拉，目前内置：晓晓、晓伊、晓涵、晓梦、云希、云健。
- 前端播放 Edge TTS 音频时使用真实 `HTMLAudioElement + WebAudio AnalyserNode` 分析音频能量来驱动 `speechLevel`，不再只依赖模拟文本包络。
- 如果 Edge TTS 生成或播放失败，会清理资源并回退到系统 `speechSynthesis`。

验证：

- `npm run build` 已通过。
- 用 `node-edge-tts` 单独生成中文 mp3 测试通过。
- `npm run preview` 已重启。

注意：

- Edge TTS 使用 Microsoft Edge 在线朗读接口，免费但非正式 API，长期稳定性不能完全保证。
- 后续如果需要更稳定的商用中文声音，可继续加火山/讯飞/腾讯云/阿里云 TTS Provider。

## 2026-05-07 舞台指令解析记录

用户指出模型回复里类似 `*轻轻歪头，耳朵微微抖动*`、`*小声说*` 的内容不应该被念出来，而应该驱动 Live2D 表情/动作或调整 TTS 语气。

已实现轻量规则解析：

- 新增 `parseSpeechSegments(text)`：把 `*...*` 舞台指令从 TTS 文本里剥离，只朗读普通正文。
- 舞台指令会影响后续语音片段的 `SpeechStyle`：
  - `小声/悄悄/低声/耳语`：降低音量、降低语速、略降音高。
  - `兴奋/激动/大声/欢呼`：提高音量、语速、音高。
  - `笑/开心/眨眼/微笑/撒娇/可爱/耳朵`：切 `happy` mood。
  - `思考/歪头/疑惑/想了想`：切 `thinking` mood。
  - `认真/专注/观察`：切 `focused` mood。
  - `担心/害怕/委屈`：切 `concerned` mood。
- TTS 队列从纯字符串改为 `SpeechSegment[]`，每个片段包含 `text` 和 `style`。
- Edge TTS IPC 请求新增可选 `rate/pitch/volume`，主进程会把它们转成 Edge prosody 参数。
- 系统 `speechSynthesis` fallback 也会应用片段级 `rate/pitch/volume`。
- 流式分句里增加保护：如果某个句子里 `*` 还没闭合，不会提前入队朗读，避免把半截舞台指令念出来。

验证：

- `npm run build` 已通过。
- `npm run preview` 已重启。

后续建议：

- 让 LLM 输出更规范的舞台指令或结构化 metadata，减少正则规则误判。
- 可继续把舞台指令映射到 Live2D motion group，比如 `歪头`、`挥手`、`害羞` 等，而不仅仅是 mood。

## 2026-05-07 紧凑模式二次缩放修复

用户反馈：第一次点击紧凑模式正常，回到正常模式后，第二次再进入紧凑模式时 Live2D 缩放不正常。

排查判断：
- `Live2DAvatar` 的布局逻辑每次用 `model.width / model.scale.x`、`model.height / model.scale.y` 反推原始尺寸。模型已经缩放过后再次切换窗口尺寸，容易把当前缩放状态带入下一次布局，导致二次缩放异常。
- Electron `window:compact` 会异步调整窗口尺寸，React state 切换和真实 DOM 尺寸变更不是同一帧完成，Live2D 需要在窗口变更后补一次/多次重布局。

已修复：
- Live2D 模型加载完成时缓存 `naturalWidth` / `naturalHeight`，后续布局始终基于原始模型尺寸计算缩放，不再从当前缩放后的宽高反推。
- `layout()` 增加容器尺寸保护，避免在尺寸还没稳定时用过小 bounds 计算缩放。
- 新增 `avatarLayoutToken`，切换紧凑模式前后以及窗口 resize 后延迟触发多次 Live2D 重布局。
- `Live2DAvatar` 新增 `layoutToken` prop，并在 `activity/layoutToken` 变化时按 `0/80/180/360ms` 重新布局。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

## 2026-05-07 PowerShell CLIXML 噪声修复

用户贴出自动化执行结果中的 `#< CLIXML ... <Obj S="progress"> ... </Objs>` 内容。

判断：
- 这不是应用业务错误，而是 Windows PowerShell 在非交互执行时把 progress 记录序列化成 CLIXML 后写到 stderr。
- 旧的 `runPowerShell(...)` 只要看到 stderr 就直接返回，导致 UI 显示整段 CLIXML。

已修复：
- `src/main/automation.ts` 新增 PowerShell prelude：
  - `$ProgressPreference = 'SilentlyContinue'`
  - `$InformationPreference = 'SilentlyContinue'`
  - `$VerbosePreference = 'SilentlyContinue'`
  - `$WarningPreference = 'SilentlyContinue'`
  - 设置 UTF-8 输出编码
- 调用 `powershell.exe` 增加 `-NoLogo`、`-NonInteractive`。
- 新增 `cleanPowerShellOutput(...)`，兜底移除 `#< CLIXML ... </Objs>` 和 NUL 字符。
- `runPowerShell(...)` 的成功和失败路径都会清理 stdout/stderr 后再返回或抛错。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

## 2026-05-07 电脑控制权限执行提示修复

用户反馈：使用指令让 AI 发起动作队列后，执行时报 `Computer control is disabled.`

原因：
- 动作队列可以生成并展示，但执行时主进程会检查 `config.permissions.control`。
- 如果“电脑控制”开关没开，旧逻辑仍然调用执行 IPC，主进程返回英文错误，并且前端会把失败结果显示出来。

已修复：
- `src/renderer/App.tsx` 的 `executeActions(...)` 在调用主进程前先检查 `config.permissions.control`。
- 如果电脑控制未开启，会显示中文状态“电脑控制未开启，动作已保留在队列中”，并保留动作队列，不再把动作拿去执行。
- 最近动作结果会提示：`电脑控制未开启。输入 /control on 或点击顶部“电脑控制”按钮后再执行。`
- 文本输入命令新增：
  - `/control on`：开启电脑控制并保存配置。
  - `/control off`：关闭电脑控制并保存配置。
- `/help` 命令说明已补充 `/control on/off`。
- `src/main/automation.ts` 中兜底错误文案从英文改为中文：`电脑控制未开启。`

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

## 2026-05-07 文本输入斜杠命令

用户要求：文字输入框支持 `/` 命令，例如 `/clear` 清空聊天窗口上下文，`/restart` 重新开始新的对话窗口。

已实现：
- `src/renderer/App.tsx` 新增 `replaceMessages(...)`，可直接替换消息列表、同步 `messagesRef` 并持久化到 `localStorage`。
- 新增 `stopActiveTurn()`，会取消当前流式回复、停止 TTS、清空朗读缓冲、暂停监听，并重置 thinking/speaking 状态。
- 新增 `handleTextCommand(...)`：
  - `/clear`：停止当前回合，清空聊天消息、待执行动作、最近动作结果和输入状态，并写入空历史；不清长期记忆。
  - `/restart`：停止当前回合，重置为新的会话起点，显示默认问候，清空动作队列和最近动作结果；不清长期记忆。
  - `/new`：作为 `/restart` 的别名。
  - `/help` 或 `/commands`：在聊天窗口显示可用命令说明。
- 手动输入提交时会先判断是否以 `/` 开头；命令不会发送给模型。
- 即使模型服务未配置，输入框也允许输入命令；普通文本仍要求先配置模型服务。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

## 2026-05-07 隐藏测试 UI 与语音插话

用户需求：
- 口型测试条和“测试说话”播放按钮现在不需要显示，但代码不要删。
- AI 语音回复时，用户新说的话可以打断 AI 语音回复；AI 电脑播放出来的声音不能打断自己的回复。
- 歪头/点头等参数动作测试按钮去掉。

已实现：
- `src/renderer/App.tsx` 中底部语音栏的 `speech-level-row` 口型测试条已用 JSX 注释隐藏。
- `测试说话` 播放按钮已用 JSX 注释隐藏，`handleLipSyncTest` 和 `LIP_SYNC_TEST_TEXT` 仍保留，后续调试可以恢复。
- 运行页 `.gesture-strip` 动作测试按钮已用 JSX 注释隐藏，参数动作逻辑仍保留，舞台指令依然可触发动作。
- 麦克风采集统一启用 `echoCancellation`、`noiseSuppression`、`autoGainControl`。
- AI 开始朗读时，如果自动监听开启且用户没有手动停止监听，会启动一个强制 VAD 的插话监听。
- 插话监听在 AI 播放开始后有 `700ms` 保护期，并使用更高 VAD 起始阈值、`220ms` 连续确认，降低扬声器回声误触发。
- 检测到真实插话后，会取消当前流式回复、停止 TTS、清空待朗读队列，然后继续录用户这句话并走原来的转写/对话流程。
- 录音如果是在 AI 播放期间启动，会额外比较转写文本和当前 AI 正在朗读的文本；高度相似时按“AI 播放回声”忽略。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

## 2026-05-07 Live2D 参数模拟动作

用户希望采用“第三种层级”：不依赖模型自带 motion 文件，而是直接写常见 Live2D 参数来模拟更多动作。

已实现：
- `src/renderer/App.tsx` 新增 `AvatarGestureName` / `AvatarGestureState`。
- `Live2DAvatar` 新增 `gesture` prop，每帧在 `beforeModelUpdate` 写入短时 gesture 曲线。
- 新增参数模拟动作：
  - `tiltLeft` / `tiltRight`：通过 `ParamAngleZ`、`ParamAngleX`、`ParamBodyAngleX` 模拟歪头。
  - `nod`：通过 `ParamAngleY`、`ParamBodyAngleY` 模拟点头。
  - `shakeHead`：通过 `ParamAngleX`、`ParamBodyAngleX` 模拟摇头。
  - `lookAround`：通过 `ParamEyeBallX/Y`、`ParamAngleX` 模拟环顾。
  - `shy`：通过低头、侧头、眼开合、`ParamCheek`、嘴角模拟害羞/脸红。
  - `surprised`：通过眼睛睁大、眉毛抬起、头部上抬和轻微张嘴模拟惊讶。
  - `happyHop`：通过身体上下/左右参数、眼笑、嘴角模拟开心跳动。
  - `softSway`：轻微晃动，并尝试写入常见耳朵参数别名；模型无耳朵参数时会自动无效。
- 舞台指令解析新增 gesture 映射：`*歪头*`、`*点头*`、`*摇头*`、`*害羞*`、`*惊讶*`、`*开心/兴奋*`、`*轻轻晃动/耳朵抖动*` 等会触发对应参数动作。
- 如果 TTS 关闭，舞台指令仍会触发 mood/gesture，不再完全依赖朗读队列。
- 运行页新增一排动作测试按钮：歪头、点头、摇头、害羞、惊讶、开心。
- `src/renderer/styles.css` 新增 `.gesture-strip` 样式。

注意：
- 这些动作只会在模型具备对应参数时生效；比如没有 `ParamAngleZ` 的模型无法明显歪头，没有 `ParamCheek` 的模型不会脸红。
- 这类参数模拟适合头部、眼神、表情、身体小幅晃动；挥手、转身、伸懒腰等仍需要模型本身有手臂/身体 motion 或专用参数。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

## 2026-05-07 语音控制入口与手动文本输入

用户要求：
- 截图里的运行页顶部按钮排也要能控制语音交流。
- 支持手动输入文本，不只依赖麦克风语音。

已实现：
- `src/renderer/App.tsx` 的运行页 `.permission-row` 新增麦克风按钮：可开始聆听、停止并发送语音；模型回复/朗读期间点击会打断回复并继续听。
- 同一按钮排新增 `语音回复` 开关，和底部语音栏的 TTS 开关共用同一份 `config.voice.ttsEnabled`。
- 底部 `.voice-dock` 新增手动文本输入框和发送按钮。
- 手动发送时如果正在朗读/生成，会先取消当前流式回复、停止 TTS、暂停麦克风监听，再把输入文本走原有 `sendUtterance(...)` 对话链路，所以仍支持屏幕上下文、流式回复、动作队列、记忆更新和 TTS 朗读。
- `src/renderer/styles.css` 新增 `.manual-chat-form` 样式，输入框在紧凑模式下也保留在底部语音栏内。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

### 追加修复

用户继续反馈：第二次点击紧凑模式时，人物仍会变成占据整个背景框的大小。

进一步判断：
- 只靠重新布局还不够，因为进入紧凑模式时如果 React 先加上 `.is-compact`，右侧控制面板会先隐藏，舞台会短暂获得正常窗口下的超宽尺寸，Live2D 会先按这个大尺寸计算缩放。
- 如果后续 Electron resize 和 Pixi canvas resize 的时机没有完全对齐，这个过大的 scale 可能保留下来。

已追加修复：
- 进入紧凑模式时先调用 `window.lover.setCompact(true)` 缩小 Electron 窗口，再延迟切换 React 的 `compact` 布局态。
- 退出紧凑模式时先取消 React 的 `compact` 布局态，再恢复普通窗口。
- 紧凑切换期间禁用按钮，避免连续点击造成状态交错。
- Live2D 紧凑态布局新增最大计算尺寸：宽 `370`、高 `430`。即使某次布局拿到旧的大容器尺寸，也不会把人物放大到占满背景框。
- `layout()` 内显式调用 `app.renderer.resize(...)`，并监听 `window.resize` / `visualViewport.resize` 做多帧重布局，减少 Pixi canvas 和 DOM 尺寸不同步。
- Electron `window:compact` 的 `setSize(..., animate)` 改为不使用动画，降低 resize 时序不确定性。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。

### 主进程窗口 bounds 强制修复

用户截图确认：第二次紧凑时不是 Live2D 单独放大，而是整个 Electron 透明窗口仍保持正常模式大小，前端只隐藏了右侧面板。

已继续修复：
- `src/main/main.ts` 引入 Electron `screen`，不再只调用 `setSize`。
- 新增 `targetBoundsForSize(...)`，按当前窗口右上角锚点计算目标窗口矩形，并限制在当前显示器 workArea 内。
- 新增 `forceWindowBounds(...)`：先退出 fullscreen/maximized/minimized 状态，再 `setBounds(target, false)`，并在 `60ms/180ms` 后再次强制应用，避免 Windows 窗口状态或贴靠动画把尺寸带回来。
- 紧凑尺寸固定为 `390x560`，普通尺寸固定为 `1080x740`，延续之前行为。

验证：
- `npm run build` 已通过。
- `npm run preview` 已重启。
