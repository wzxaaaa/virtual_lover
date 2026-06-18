# Virtual Lover

面向个人桌面的 AI VTuber / Live2D 伙伴原型。目标不是普通聊天窗口，而是接近 Neuro-sama 的实时陪伴形态：常驻桌面、自动听你说话、实时思考、语音回复、驱动 Live2D，并在授权后观察屏幕和提出电脑操作。

## 当前能力

- Electron + React 桌面窗口，默认置顶。
- Live2D 模型 URL 配置，加载失败时使用备用动画形象。
- 内置 Live2D 官方示例预设：Hiyori、Mao、Natori、Rice、Haru、Ren，默认使用 Hiyori。
- Live2D 会根据 mood 和听/想/说状态切换表情、动作和姿态，TTS 播放时同步驱动口型。
- 设置页可调 Live2D 口型灵敏度、表情权重和关键动作冷却。
- 启动后自动进入麦克风监听。
- VAD 自动断句：检测到人声才开始录音，停顿后自动提交转写。
- 对话回复流式生成，前端按句子分段播放 TTS。
- 回复中可用麦克风按钮打断，停止当前生成/语音并重新监听。
- 长期记忆：保存对话摘要、用户偏好和项目事实，并在后续回复中自然使用。
- 设置页可查看和清空长期记忆。
- OpenAI-compatible 模型服务配置：对话、视觉、语音转写分别可填模型名。
- 屏幕观察：开启权限后捕获主屏幕截图并随对话发送给视觉模型。
- 周期屏幕观察：可定时生成屏幕摘要，后续对话会带上稳定的视觉上下文。
- 受控电脑操作：AI 只提出动作计划，默认需要用户确认后执行。
- 桌面 Agent 安全分级：动作会被标记为可自动、待确认或已阻止；失败动作会带着结果进入下一轮自修正。
- Windows 基础自动化：鼠标移动/点击、输入文字、快捷键、打开应用、等待。

## 开发

```bash
npm install
npm run dev
```

预览生产构建：

```bash
npm run preview
```

类型检查和构建：

```bash
npm run build
```

## 配置

在应用右侧设置中填写：

- 服务地址：OpenAI-compatible API 根地址，例如 `https://api.openai.com/v1` 或本地代理地址。
- API Key：远程服务通常必填；`localhost` 和 `127.0.0.1` 地址允许为空。
- 对话模型、视觉模型、转写模型。
- Live2D 模型 URL。
- Live2D 预设：来自 [Live2D/CubismWebSamples](https://github.com/Live2D/CubismWebSamples/tree/develop/Samples/Resources)，应用通过 jsDelivr 加载 `model3.json`；也可以继续填自定义 URL。
- 人格提示词、语言、系统语音。

VAD 设置：

- 自动判断说完：默认开启。
- 拾音灵敏度：越低越容易触发录音，环境吵时可以调高。
- 停顿判定：越短越快回复，越长越不容易打断长句。

配置文件保存在 Electron 的 `userData/config.json` 中。当前原型使用明文保存 API Key，后续生产化应接入系统密钥链。

长期记忆保存在 Electron 的 `userData/memory.json` 中。记忆由模型每轮输出的 `memoryNotes` 更新，应用会去重并限制数量；如果记错了，可以在设置页清空。

## 安全边界

屏幕观察、电脑控制、每轮截图都是独立开关。电脑控制默认开启动作确认；关闭动作确认后，模型提出的动作会自动执行，但仍受 `maxActionsPerTurn` 限制。
