# N.E.K.O 可迁移功能审阅报告

## 当前迁移留空项

- `AV02 / syncEmotionMappingWithServer`：`github_girl` 依赖 `/api/live2d/emotion_mapping/{model}` 后端动态同步模型情绪映射；当前项目暂留空，不硬造接口，现阶段仅读取本地 `model3.json` 的 `EmotionMapping`。
- `AV09 / ModelProfilerUI`：`github_girl` 的 `model-profiler.js` / `model-profiler-ui.js` 主要面向 VRM/MMD，且在 `model_manager.html` 中对 Live2D 明确返回 `Live2D 模型暂不支持性能分析`；当前项目只有 Live2D，暂留空，等后续迁入 VRM/MMD 管理器后再原样接入。

目标项目：`E:\myProject\claude\github_girl\N.E.K.O`

当前项目：`E:\myProject\claude\virtual_lover`

审阅时间：2026-06-15

## 覆盖范围

- 已按 Git 跟踪清单审阅：3145 个文件。
- 文本/源码/配置/文档：2731 个。
- 二进制资源：413 个。
- Git submodule 指针：1 个，`local_server/cosyvoice_server/CosyVoice`。
- 原仓库启用了 sparse checkout，`.agent`、`.github`、`tests`、`specs` 起初未检出；为完整审阅已把这些目录加入 sparse checkout。
- 已生成逐文件索引：`E:\myProject\claude\virtual_lover\github_girl_file_review_index.json`。

## 当前项目对照

`virtual_lover` 已具备的基础能力：

- Electron + React 桌面壳。
- Live2D 渲染、口型、表情/动作触发。
- OpenAI-compatible 对话、视觉截图、转写。
- OpenAI/Doubao/Edge TTS。
- 长期记忆、梦境/心跳/突触式主观记忆。
- 屏幕观察、周期观察、受控鼠标键盘自动化、风险分级。
- 语音监听、VAD、打断回复、流式回复。

因此下面的候选功能分为三种：

- `增强型`：你已有类似能力，但 N.E.K.O 做得更完整。
- `新增型`：当前项目基本没有。
- `大工程`：能迁，但需要先做架构拆分或后端服务层。

## 迁移候选功能

| ID | 类型 | 功能 | 可迁移价值 | 证据文件 |
| --- | --- | --- | --- | --- |
| A01 | 大工程 | 三服务器架构：主服务、记忆服务、Agent 服务分离 | 把当前 Electron 主进程里的 LLM/记忆/Agent 压力拆出去，降低单进程复杂度 | `app/main_server.py`, `app/memory_server.py`, `app/agent_server.py`, `docs/zh-CN/architecture/three-servers.md` |
| A02 | 增强型 | 启动器、端口冲突检测、健康指纹、进程清理 | 当前开发服务和 Electron 启动可更稳，避免端口被占无提示 | `launcher.py`, `utils/port_utils.py`, `app/main_server.py` |
| A03 | 新增型 | 存储位置选择、迁移、维护模式写围栏 | 给用户选择数据目录，支持迁移与安全重启 | `main_routers/storage_location_router.py`, `utils/storage_migration.py`, `utils/storage_policy.py` |
| A04 | 新增型 | Steam Cloud / Auto Cloud 云存档 | 角色、记忆、模型配置可云同步 | `utils/cloudsave_runtime.py`, `utils/cloudsave_autocloud.py`, `main_routers/cloudsave_router.py` |
| A05 | 新增型 | Steam 创意工坊角色/模型/语音包分发 | 让用户分享角色卡、模型、声音包 | `main_routers/workshop_router.py`, `utils/workshop_utils.py` |
| A06 | 增强型 | 稳健日志、轮转、节流、诊断文件 | 当前日志可以升级成可长期运行的诊断体系 | `utils/logger_config.py`, `main_routers/debug_router.py` |
| A07 | 新增型 | Token 用量统计与可关闭遥测 | 统计模型调用、缓存命中、版本兼容问题 | `utils/token_tracker.py`, `local_server/telemetry_server/` |
| A08 | 增强型 | 本地突变接口 CSRF/Origin 防护 | 当前自动化/配置接口可加本地安全边界 | `main_routers/system_router.py`, `tests/unit/test_uncovered_endpoints_csrf.py` |
| M01 | 增强型 | 事实记忆 FactStore | 把当前主观记忆拆出可查询的原子事实层 | `memory/facts.py`, `app/memory_server.py` |
| M02 | 增强型 | 反思记忆 ReflectionEngine | 把多个事实总结成稳定洞察，减少复读和浅记忆 | `memory/reflection.py`, `config/prompts/prompts_memory.py` |
| M03 | 增强型 | 人格记忆 PersonaManager | 分实体维护主人、AI、关系动态 | `memory/persona.py` |
| M04 | 增强型 | 近期记忆压缩与审阅 | 当前历史可升级为可压缩、可校对、可回滚 | `memory/recent.py`, `main_routers/memory_router.py`, `templates/memory_browser.html` |
| M05 | 新增型 | 时间索引 SQLite 记忆 | 支持按日期/时间窗口召回 | `memory/timeindex.py`, `memory/temporal.py` |
| M06 | 新增型 | BM25 + cosine + RRF 混合召回 | 给模型一个 `recall_memory` 工具，按语义和时间查记忆 | `memory/hybrid_recall.py`, `memory/embeddings.py` |
| M07 | 新增型 | 本地 ONNX embedding warmup/backfill | 离线向量化，不依赖外部 embedding API | `memory/embedding_worker.py`, `scripts/prepare_embedding_model.py` |
| M08 | 新增型 | 证据打分、反驳、确认、归档 | 记忆不再一写永久正确，可被用户纠偏 | `memory/evidence.py`, `memory/event_log.py`, `memory/evidence_handlers.py` |
| M09 | 新增型 | Outbox 持久后台任务队列 | 记忆抽取/反思中途退出后可恢复 | `memory/outbox.py`, `app/memory_server.py` |
| M10 | 新增型 | 用户禁谈/回避指令 | 用户说“别再提 X”后持久生效 | `memory/user_directives.py`, `config/prompts/prompts_directives.py` |
| M11 | 增强型 | Anti-repeat 语料和 BM25 复读抑制 | 主动搭话更少绕同一个话题打转 | `memory/anti_repeat.py` |
| M12 | 新增型 | 记忆 refine：聚类、合并、改写 | 周期整理人格/反思，防止记忆碎片化 | `memory/refine.py` |
| L01 | 增强型 | 多供应商配置注册表 | 替换当前硬编码 provider 配置，支持 14+ 服务商 | `config/api_providers.json`, `utils/api_config_loader.py`, `config/providers.py` |
| L02 | 增强型 | Realtime 客户端多后端适配 | 当前语音对话可扩展 Qwen/Gemini/GLM/Step 等 | `main_logic/omni_realtime_client.py`, `tests/unit/test_voice_session.py` |
| L03 | 增强型 | Offline ChatCompletion 流式工具调用 | 当前 LLM 流可接统一 tool calling | `main_logic/omni_offline_client.py`, `main_logic/tool_calling.py` |
| L04 | 新增型 | 统一工具注册/远程 callback | 插件、Agent、主对话共享同一套工具接口 | `main_routers/tool_router.py`, `main_logic/tool_calling.py` |
| L05 | 增强型 | 长回复尾部摘要 | 回复很长时保留上下文，不让后续对话失忆 | `config/prompts/prompts_response.py`, `main_logic/omni_offline_client.py` |
| L06 | 新增型 | 工具调用泄漏过滤 | 防止模型把隐藏 tool call 标记直接说给用户 | `utils/llm_tool_leak_filter.py`, `tests/unit/test_tool_call_leak_filter.py` |
| L07 | 增强型 | Prompt 模块化与多语言 | 当前系统提示可拆成角色、记忆、主动、情绪、游戏等模块 | `config/prompts/` |
| V01 | 增强型 | TTS 提供商矩阵 | 扩展 OpenAI/Doubao/Edge 到 Qwen、Gemini、StepFun、Grok、Minimax、ElevenLabs、MiMo、GPT-SoVITS、CosyVoice 等 | `main_logic/tts_client.py`, `utils/native_voice_registry.py` |
| V02 | 新增型 | 声音克隆 | 上传样本生成角色声音 | `utils/voice_clone.py`, `main_routers/characters_router.py`, `templates/voice_clone.html` |
| V03 | 增强型 | RNNoise 降噪、AGC、Limiter | 语音输入更稳 | `utils/audio_processor.py`, `static/app-audio-capture.js` |
| V04 | 新增型 | 静音检测与裁剪 | 语音克隆样本/录音自动去静音 | `utils/audio_silence_remover.py` |
| V05 | 增强型 | TTS 流式文本规整 | 清除括号、Markdown、CJK 空格，提升朗读自然度 | `utils/frontend_utils.py`, `tests/unit/test_tts_text_strippers.py` |
| V06 | 新增型 | 独立字幕窗口与翻译 | 适合直播/桌面伴随字幕 | `templates/subtitle.html`, `static/subtitle.js`, `app/monitor.py` |
| AV01 | 增强型 | Live2D 模型管理、上传、参数编辑 | 当前只支持 URL/预设，可升级成本地模型库 | `main_routers/live2d_router.py`, `templates/model_manager.html`, `templates/live2d_parameter_editor.html` |
| AV02 | 增强型 | Live2D 情绪映射与触摸区域 | 表情/动作不再只靠简单 mood | `static/live2d-emotion.js`, `static/touch-config.js` |
| AV03 | 新增型 | VRM 3D Avatar | 增加 3D 角色形态 | `main_routers/vrm_router.py`, `static/vrm-*.js`, `docs/zh-CN/frontend/vrm.md` |
| AV04 | 新增型 | MMD/PMX/PMD + VMD 动作 | 支持 MMD 模型和舞蹈动作 | `main_routers/mmd_router.py`, `static/mmd-*.js` |
| AV05 | 新增型 | PNGTuber 模型包与导入器 | 轻量替代 Live2D/VRM，支持 PNGTubeRemix/PNGTuber Plus | `main_routers/pngtuber_router.py`, `main_routers/pngtuber_importers/`, `static/pngtuber-core.js` |
| AV06 | 新增型 | Avatar 工具交互：棒棒糖、拳头、锤子等 | 把用户和角色互动变成可记忆事件 | `frontend/react-neko-chat/src/avatarTools.ts`, `config/prompts/prompts_avatar_interaction.py` |
| AV07 | 新增型 | 自动告别、回球、闲置视觉状态 | 桌宠更像常驻生命体 | `static/app-auto-goodbye.js`, `templates/return-ball.html` |
| AV08 | 增强型 | 多屏拖拽、悬浮按钮、反应气泡 | 当前窗口/Avatar 交互可更桌宠化 | `static/avatar-*.js`, `static/avatar-multiscreen-drag-hint.js` |
| AV09 | 新增型 | 模型性能面板 | 用户能诊断 Avatar FPS/资源占用 | `static/model-profiler.js`, `static/model-profiler-ui.js` |
| C01 | 增强型 | 多角色 CRUD、快速切换 | 当前可升级为完整角色管理器 | `main_routers/characters_router.py`, `static/app-character.js` |
| C02 | 新增型 | 人格预设与新手人格选择 | 首次创建角色更顺滑 | `utils/persona_presets.py`, `utils/initial_personality_state.py` |
| C03 | 新增型 | 角色卡导入/导出/完整包 | 角色、模型、头像、声音可分享备份 | `main_routers/characters_router.py`, `templates/character_card_manager.html` |
| C04 | 新增型 | AI 角色卡助手 | 让模型帮用户生成/润色角色设定 | `main_routers/card_assist_router.py`, `config/prompts/prompts_card_assist.py` |
| C05 | 新增型 | 角色头像/卡面管理 | UI 角色列表更有实体感 | `main_routers/characters_router.py`, `static/default/card_faces/` |
| G01 | 大工程 | Agent 服务与 ZeroMQ 事件总线 | 把当前自动化从“动作执行”升级为“任务执行系统” | `main_logic/agent_event_bus.py`, `app/agent_server.py` |
| G02 | 增强型 | 任务跟踪、去重、取消、纠错 | 自动化任务不会重复派发，用户可中断修正 | `brain/task_executor.py`, `brain/deduper.py`, `app/agent_server.py` |
| G03 | 增强型 | Computer Use Adapter | 当前 PowerShell 自动化可升级为截图驱动的视觉动作循环 | `brain/computer_use.py`, `brain/cua/` |
| G04 | 新增型 | Browser Use Adapter | 支持网页任务自动化 | `brain/browser_use_adapter.py` |
| G05 | 新增型 | OpenClaw/QwenPaw 兼容 | 可接外部 Agent 后端 | `brain/openclaw_adapter.py`, `docs/zh-CN/architecture/neko-qwenpaw-integration.md` |
| G06 | 新增型 | OpenFang 无头执行后端 | 可把任务交给外部执行器 | `brain/openfang_adapter.py` |
| G07 | 新增型 | Agent HUD | 桌面上显示任务运行状态 | `templates/agenthud.html`, `static/app-agent.js` |
| P01 | 大工程 | 插件 SDK、装饰器、生命周期、配置 | 把功能变成可插拔生态 | `plugin/sdk/`, `plugin/core/`, `docs/zh-CN/plugins/` |
| P02 | 大工程 | 插件子进程 Host + ZMQ transport | 插件崩溃不拖垮主应用 | `plugin/core/host.py`, `plugin/core/zmq_transport.py` |
| P03 | 大工程 | Message Plane：messages/events/memory/conversations bus | 插件可订阅对话、事件、记忆 | `plugin/message_plane/`, `plugin/core/bus/` |
| P04 | 新增型 | Vue 插件管理器 | 用户可启停、配置、看日志/指标 | `frontend/plugin-manager/src/` |
| P05 | 新增型 | 插件市场、包管理、导入导出 | 可安装/升级/打包插件 | `frontend/plugin-manager/src/components/plugin/MarketPanel.vue`, `plugin/neko_plugin_cli/` |
| P06 | 新增型 | Hosted TSX 插件 UI | 插件能带自己的面板，不必改主前端 | `frontend/plugin-manager/src/components/plugin/hosted/` |
| P07 | 新增型 | MCP Adapter 插件 | 接 MCP 工具生态 | `plugin/plugins/mcp_adapter/` |
| P08 | 新增型 | Web Search 插件 | 联网搜索并摘要 | `plugin/plugins/web_search/`, `utils/web_scraper.py` |
| P09 | 新增型 | 备忘提醒插件 | 闹钟、一次性/重复提醒 | `plugin/plugins/memo_reminder/` |
| P10 | 增强型 | 主动搭话控制器插件 | 统一管理主动搭话模式和频率 | `plugin/plugins/proactive_controller/`, `main_routers/proactive_router.py` |
| P11 | 新增型 | 生活助手插件 | 天气、出行、路线、POI | `plugin/plugins/lifekit/` |
| P12 | 新增型 | 米家智能家居插件 | 控制智能家居设备 | `plugin/plugins/mijia/` |
| P13 | 新增型 | 音乐推送插件 | 用户上传音乐/链接推入主对话 | `plugin/plugins/music_pusher/` |
| P14 | 新增型 | B站弹幕/私信插件 | 直播弹幕陪伴、私信自动回复 | `plugin/plugins/bilibili_danmaku/`, `plugin/plugins/bilibili_dm/` |
| P15 | 新增型 | QQ 自动回复插件 | OneBot 接入 QQ 消息 | `plugin/plugins/qq_auto_reply/` |
| P16 | 新增型 | Galgame 游玩助手 | 读剧情、选项建议、OCR/桥接 | `plugin/plugins/galgame_plugin/`, `main_routers/galgame_router.py` |
| P17 | 新增型 | Minecraft 游戏插件 | 游戏状态桥接、自主玩法、语音讲解 | `plugin/plugins/game_agent_minecraft/` |
| P18 | 新增型 | Study Companion 插件 | OCR、题目、讲解、总结、番茄钟 | `plugin/plugins/study_companion/` |
| P19 | 新增型 | Slay the Spire 2 自动游玩插件 | 策略解析、自动行动、陪玩 commentary | `plugin/plugins/sts2_autoplay/` |
| P20 | 新增型 | Claude Code 陪伴插件 | 监测开发活动，主动鼓励/陪伴 | `plugin/plugins/claude_companion/` |
| PR01 | 增强型 | 用户活动追踪 | 根据窗口、输入空闲、语音状态判断用户在工作/娱乐/走神 | `main_logic/activity/`, `config/activity_keywords.py` |
| PR02 | 增强型 | 主动搭话两阶段生成 | 先筛选时机/主题，再生成更自然的话 | `config/prompts/prompts_proactive.py`, `main_routers/system_router.py` |
| PR03 | 新增型 | 热搜、新闻、个性动态 | 让角色主动聊外部世界 | `utils/web_scraper.py` |
| PR04 | 新增型 | 节假日/周末上下文 | 问候更像真实生活陪伴 | `utils/holiday_cache.py` |
| PR05 | 新增型 | 梗图抓取 | 主动分享/解释 meme | `utils/meme_fetcher.py`, `main_routers/system_router.py` |
| MU01 | 新增型 | 音乐搜索/代理/播放 | 网易云、SoundCloud、iTunes、Musopen 等 | `main_routers/music_router.py`, `utils/music_crawlers.py` |
| MU02 | 新增型 | Jukebox 歌曲 + VMD 动作绑定 | 音乐播放时驱动 Avatar 动作 | `main_routers/jukebox_router.py`, `static/Jukebox.js` |
| GAME01 | 新增型 | 通用游戏路由 | 游戏事件进入 LLM，输出台词、动作、记忆 | `main_routers/game_router.py`, `utils/game_route_state.py` |
| GAME02 | 新增型 | 足球/篮球 Demo | 角色作为游戏解说/教练 | `templates/soccer_demo.html`, `templates/basketball_demo.html` |
| GAME03 | 新增型 | 游戏语音 transcript 注入 | 游戏时的语音也能进入上下文 | `utils/game_route_state.py`, `main_routers/game_router.py` |
| GAME04 | 新增型 | 游戏记忆策略 | 赛前/赛中/赛后记忆整理 | `config/prompts/prompts_game_route.py`, `main_routers/game_router.py` |
| UI01 | 增强型 | React 聊天窗 full/compact 双形态 | 当前 UI 可升级成桌宠悬浮胶囊 + 完整聊天窗 | `frontend/react-neko-chat/src/App.tsx`, `FullChatSurface.tsx` |
| UI02 | 增强型 | 富文本、Markdown、代码块、数学公式 | 回复显示更现代 | `frontend/react-neko-chat/src/SmartTextBlock.tsx` |
| UI03 | 新增型 | 紧凑历史导出/选择 | 用户可导出精选聊天记录 | `frontend/react-neko-chat/src/CompactExportHistoryPanel.tsx` |
| UI04 | 新增型 | Avatar 工具轮和快捷栏 | 桌宠交互更像游戏 UI | `frontend/react-neko-chat/src/AvatarToolItemManager.tsx`, `AvatarToolQuickbar.tsx` |
| UI05 | 增强型 | 深色模式、统一 tooltip、toast、dialog | 当前界面可统一交互细节 | `static/theme-manager.js`, `static/neko-tooltip.js`, `static/common_dialogs.js` |
| UI06 | 新增型 | Yui 新手引导：角色演出 + 高亮 + 语音 | 比普通 onboarding 更有“她在带你用”的感觉 | `static/yui-guide-director.js`, `static/yui-guide-avatar-stage.js` |
| UI07 | 新增型 | 跨页面 handoff | 教程/设置/插件页面之间能接力状态 | `static/yui-guide-page-handoff.js` |
| UI08 | 增强型 | API Key 设置页连通性测试 | 用户填模型配置时直接验证 | `main_routers/config_router.py`, `templates/api_key_settings.html` |
| CAP01 | 增强型 | 跨平台截图桥与截图压缩 | 当前 screen capture 可扩展到插件和 Wayland fallback | `main_routers/capture_router.py`, `utils/capture_bridge.py`, `utils/screenshot_utils.py` |
| CAP02 | 新增型 | OCR/屏幕分类 | Galgame/学习伴侣场景可读屏幕文字 | `plugin/plugins/galgame_plugin/`, `plugin/plugins/study_companion/` |
| CAP03 | 新增型 | 摄像头视觉输入 | AI 女友可在用户授权后看到用户摄像头画面 | `static/app-screen.js`, `main_routers/websocket_router.py`, `main_logic/core.py`, `main_logic/omni_realtime_client.py`, `main_logic/omni_offline_client.py` |
| I18N01 | 新增型 | 8 语言角色、页面、prompt 国际化 | 当前中文/英文配置可扩展多语言 | `config/characters/*.json`, `static/locales/`, `scripts/check_i18n.py` |
| DEV01 | 新增型 | VitePress 开发者文档站 | 给项目沉淀 API/架构/插件文档 | `docs/`, `docs/.vitepress/` |
| DEV02 | 新增型 | Docker 部署与配置参考 | 后端服务可容器化 | `docker/`, `README.MD` |
| DEV03 | 增强型 | 静态检查脚本 | 防 trailing slash、async 阻塞、prompt 泄漏、层级倒置等 | `scripts/check_*.py`, `.github/workflows/analyze.yml` |
| DEV04 | 新增型 | 测试台 Testbench | 模拟对话、评测、诊断、会话导出 | `tests/testbench/` |
| DEV05 | 增强型 | 大量单元/集成/前端 smoke 测试 | 迁移高风险功能前可借鉴测试合同 | `tests/unit/`, `tests/frontend/`, `tests/integration/` |

## 优先迁移建议

第一批最适合当前项目的小步迁移：

1. `V03` RNNoise/AGC/Limiter 和 `V05` TTS 文本规整。
2. `M10` 用户禁谈指令、`M11` 复读抑制。
3. `UI02` 富文本渲染、`UI05` tooltip/toast/dialog 统一。
4. `AV01` 本地 Live2D 模型管理和 `AV02` 情绪映射。
5. `C04` AI 角色卡助手。
6. `CAP01` 截图压缩/视觉分析工具化。

第二批值得做成中型里程碑：

1. `M01-M06` 三层记忆 + 混合召回。
2. `PR01-PR04` 用户活动追踪 + 主动搭话升级。
3. `G01-G04` Agent 任务系统。
4. `UI01/UI03/UI04` React 聊天窗升级。
5. `V01/V02` TTS provider matrix + 声音克隆。

第三批属于平台化重构：

1. `P01-P06` 插件生态。
2. `AV03-AV05` VRM/MMD/PNGTuber 多 Avatar。
3. `A04/A05` Steam Cloud + 创意工坊。
4. `DEV04` Testbench 评测台。

## 当前迁移备注

- `AV08` 已迁入桌宠独立模式第一段：照抄 `github_girl` `static/live2d-ui-buttons.js` 的模型 `getBounds()` 浮动按钮基准尺寸（48px 按钮、12px 间距、5 按钮、按模型高度一半缩放到 0.5-1.0）和 `static/avatar-ui-drag.js` 的 `neko-model-dragging` 拖动保护类。当前项目新增顶部“桌宠模式”按钮，进入后 Electron 窗口切到透明模型独立尺寸，隐藏窗口栏/控制面板/语音 dock；鼠标移到模型右侧热区显示竖向功能按钮，按住模型拖动时通过主进程 IPC 移动整个桌面窗口。已补第二段：桌宠透明空白区通过 Electron `setIgnoreMouseEvents(true, { forward: true })` 穿透到桌面，只有模型真实 bounds 和可见工具条恢复窗口交互；拖动改为超过 5px 阈值才进入 `neko-model-dragging`，普通点击继续交给 Live2D `pointertap` 触发表情/动作。适配点：本项目没有 `github_girl` 完整的多屏吸附/回球/教程提示状态机，本次先迁入模型独立、右侧悬浮按钮、桌面穿透、拖动窗口四件核心能力。
- `AV08` 已补第三段反应气泡：照抄 `github_girl` `static/avatar-reaction-bubble.js` 的 `thinking / emotion-ready / fading` 阶段、最小显示/淡出/最大显示计时、头部右侧优先且越界翻到左侧的定位思路；照抄 `static/css/avatar-reaction-bubble.css` 的 DOM 层级、`chat_bubble.png` 外壳、happy/sad/angry/calm/surprise 情绪图和关键帧动画。当前项目没有 `github_girl` 同名 `neko-assistant-turn-start/end`、`neko-assistant-emotion-ready`、`neko-assistant-speech-start/end/cancel` 全局事件流，先桥接到本项目 `sendUtterance`、流式回复收尾、语音队列结束和 Live2D 触摸回调；待后续补统一事件总线后再原样接事件。
- `AV08` 已补第四段多屏拖拽提示：照抄 `github_girl` `static/avatar-multiscreen-drag-hint.js` 的 `neko:avatar-multiscreen-drag-hint:v1` localStorage 状态、3 天 snooze、30 秒 miss 窗口、2 次 miss 后提示、`window.NekoAvatarMultiScreenDragHint` 兼容对象、知道了/不再提醒行为；照抄 `zh-CN.json` 文案和提示框 CSS/`paw_ui.png` 装饰。适配点：当前项目没有 `electronScreen.moveWindowToDisplay` / Live2DManager `_checkAndSwitchDisplay`，所以主进程新增 `window:displays:list` 和 `window:moveBy` 拖动结果，桌宠拖动结束时根据 `displayChanged/clamped/displayCount` 桥接 miss/success。
- `AV08` 已补第五段 Avatar performance stage 地基：原样复制 `github_girl` `static/avatar-performance-stage.js` 到 `public/static/avatar-performance-stage.js` 并在入口加载，保留 `window.AvatarPerformanceStage` / `window.AvatarPerformance`、stage/driver/coordinator/session/capability lock/sequence/preset/lookAt/poseTimeline 合约。适配点：当前项目没有 `github_girl` 的 `Live2DManager` 类，所以在 React `Live2DAvatar` 内新增 `window.live2dManager` 兼容门面，映射 `getCurrentModel`、`playMotion`、`playExpression`、`setEmotion`、`resolveAssetPath`、`setTemporaryPoseOverride`、`clearTemporaryPoseOverride` 到现有 Live2D model/ref/EmotionMapping；同时创建 `window.virtualLoverLive2DPerformance`，并让本项目自动表情/动作/默认 lookAt 尊重 performance capability lock。锁 ID 先兼容 `default/live2d/main-live2d/yui/virtual-lover`，等待后续角色 ID 体系迁移后再收敛。

- `V03` 已迁入前端麦克风输入健康反馈：照抄 `github_girl` `static/app-audio-capture.js` 的浮点时域 peak/RMS/clipping 判定、`0.5%` 削顶样本阈值、等待声音/正常/音量偏低/音量较高/过载文案和颜色分级；当前项目继续使用已有 Web Audio AGC/limiter 链，VAD 仍以 RMS 判定，音量条显示改为 peak。`github_girl` 的 Python RNNoise 后端链路依赖 `utils/audio_processor.py`、`pyrnnoise`/native DLL 与 realtime PCM 服务，当前 Electron 项目暂未具备对应后端，先标为未原样迁入。
- `AV02` 已补齐 Live2D 触摸热区鼠标指针：照抄 `github_girl` 的模型 `hitTest` 悬停判定，并迁入 `cat_claw1_cursor.png`/`cat_claw2_cursor.png` 猫爪 cursor 资源与 hotspot；当前项目额外合并了已迁入的自定义框选区域命中，因此鼠标进入可触摸框/模型命中区域时会显示猫爪手势，按下时切换另一帧，移出或松开恢复默认。
- `UI08` 已迁移核心连通性测试：照抄 `github_girl` 的最小 chat completion 探测、10 秒后端超时、状态灯、测试中/成功/失败/未测试状态、字段变更后清空旧结果。当前项目没有 `api_providers.json`/Key Book/候选区域 URL 体系，所以先按本项目设置中的 `baseUrl/apiKey/model` 作为 custom API 测试；转写接口按当前项目真实 `/audio/transcriptions` 通道生成 WAV 小样本检测。
- `M10` 已迁移用户禁忌指令核心：照抄 `github_girl` `config/prompts/prompts_directives.py` 的 7 语言 ban-topic 正则、term trim、长度 [2,40]、并行匹配、具体对象限定；照抄 `memory/user_directives.py` 的重复命中刷新思路，记录 `term/locale/source/expiresAt/hitCount`，3 天 TTL 后不再注入 prompt/召回/反思。适配点：本项目没有按角色拆分的 `memory/{name}/user_directives.json`，所以写入现有 `memory.json` 的 `directives` 数组；prompt 注入复用本项目已有长期用户指令段落，而不是另建 github_girl 的渲染块。
- `M11` 已向 `github_girl` 对齐 anti-repeat 核心：BM25 背景窗口 100、前景窗口 5、注入 topK 6、最小 ngram 12、k1=1.5、b=0.75、regen 阈值 8.0、drop 阈值 16.0；软提示文案改为 `github_girl` 的“最近几轮你已经聊过的话题”块。主动搭话出口照抄“初稿超 regen 先给一次纠正机会，纠正后仍超 drop 才丢弃”的语义。适配点：本项目 heartbeat 主动消息目前是本地模板，不是 github_girl 的 Phase2 LLM 生成，所以 regen 只能换一个模板候选，无法注入 `render_regen_avoid_instruction` 让 LLM 重采样；常规回复仍走 prompt 软约束。
- `CAP03` 已迁入摄像头视觉核心：照抄 `github_girl` `static/app-screen.js` 的 `getUserMedia` 尝试顺序（后置 environment -> 前置 user -> 任意摄像头）、`frameRate ideal/max = 1`、临时 `video` 抽帧、中心 16x16 黑帧检测、720p 内 JPEG 0.8 编码、摄像头权限/无设备/被占用错误提示；主进程补了本应用 `media` 权限请求放行。后端语义照抄 `websocket_router.py` / `core.py`：`camera` 与 `screen` 同级进入视觉模型。适配点：当前项目没有 `github_girl` 的 WebSocket 实时 `stream_data input_type=camera` / Realtime `append_video_frame` 常驻通道，所以落到本项目已有 `AgentTurnRequest.camera` 多模态消息链路；开启“每轮看我”会每轮抓帧，手动“看我”会把当前帧排队给下一轮对话。
- `P17` 已迁入 Minecraft 陪玩第二段核心桥接：照抄 `github_girl` `plugin/plugins/game_agent_minecraft/client.py` 的 WebSocket 协议（出站 `task/query_inventory`，入站 `log/screenshot/task_finished/inventory/agent_status`）、默认 `ws://localhost:48909`、单 pending task、`task_id` 回传匹配、最近日志/截图/背包缓存；主进程新增 `minecraftAgent` 服务和 IPC，preload 暴露状态/任务/背包/事件，工具注册表新增 `plugin.minecraft_task` 与 `plugin.query_inventory`。同时补文本进入陪玩模式：用户说“陪我玩我的世界 / 进入游戏状态 / 开启 Minecraft 陪玩”会自动开启屏幕陪玩并拉起 mc-agent 状态，不再必须点击按钮。适配点：当前项目没有 `github_girl` 插件 SDK 的 `push_message`/`@llm_tool`/message plane，所以本轮先迁底层桥与 IPC；LLM 自动派 `minecraft_task` 的输出协议待下一段迁入。
- `P17` 已补齐 Minecraft 陪玩第三段工具闭环：按 `github_girl` `game_agent_minecraft.__init__.py` 的 fire-and-forget 语义，将 `plugin.minecraft_task` 改为立即派发、后台等待 `task_finished`，任务完成后通过现有 `minecraft:agentEvent` 回流一条自然完成提示；新增 `plugin.game_agent_status`，并让市场里声明的 `game_agent_status` 能真正调用。前端新增 reactive 文本派发：用户直接说“帮我砍树 / 查背包 / 状态怎么样 / 停一下 / 找钻石 / 回家 / 跟着我”等，会自动开启 Minecraft 陪玩并调用对应 MCP 工具，不再依赖按钮。LLM 元数据新增 `toolCalls` 协议，仅在 Minecraft 陪玩启用时允许模型自动调用 `plugin.minecraft_task` / `plugin.query_inventory` / `plugin.game_agent_status`，并按 `github_girl` 提示词约束不把“工具/连接/minecraft_task/tool”等内部词说给用户。适配点：仍未迁入 `github_girl` 完整 plugin SDK message plane，本项目用 `AgentTurnResponse.toolCalls + preload invokeAgentTool` 承接同等能力。
- `P17` 已迁入 Minecraft 陪玩第四段外部身体引导：照抄 `github_girl` `plugin/plugins/game_agent_minecraft/surfaces/quickstart.tsx` 的 mc-agent 下载/启动/管理面板思路，在市场 `Minecraft Agent` MCP 配置里加入连接状态刷新、`http://localhost:8765` 管理面板、`ws://localhost:48909` 桥接地址、`启动mc-agent.bat` 本地脚本入口、夸克/Google Drive/百度网盘下载入口和完整 LAN 联机步骤。关键说明同步到 UI：mc-agent 才是她在 Minecraft 里的“身体”，需要独立 Minecraft 账号进入同一个 LAN 世界；当前应用负责对话、观察与任务下发。适配点：`github_girl` 本身也不内置 mc-agent 二进制/源码，而是要求用户下载外部包运行，所以本项目先按原逻辑迁入口，不把大型外部 agent 打进 Electron 包。
- `P17` 已补第五段稳定性和中文意图：修复 Minecraft 陪玩文本意图、状态 prompt 和任务 preset 的中文匹配，覆盖“她能不能动/能控制吗/帮我找铁/收集煤/做火把/整理背包”等更贴近实际游戏的说法；前端 Minecraft 状态/任务回复改为明确区分“已作为第二玩家进世界”和“还没启动 mc-agent，只能看屏幕陪玩”，避免误导用户以为她已经能控制角色。同时新增 React 根级 ErrorBoundary 和 mc-agent 启动入口异常兜底，降低市场面板或 preload 版本不一致导致窗口白屏/崩溃的风险。
- `P17` 已补第六段任务回包安全路由：按 `github_girl` `game_agent_minecraft` 插件测试里的 task_id 规则，主进程保留最近 32 个已下发任务，见过 task_id 回显后启用现代协议保护；未知 task_id 的 `task_finished` 只记日志和状态，不会完成当前 pending，也不会污染背包；历史 task_id 的迟到完成会作为回顾事件发出，不打断当前任务；无 task_id 的旧式完成包只在还没见过现代回显前走 FIFO 兜底，stop/reconnect 会重置 latch。这样 Minecraft Agent 后续多任务、迟到包、重复包更接近 `github_girl` 的行为。
- `P17` 已补第七段 bot 视角入模：对齐 `github_girl` `service.py` 中“agent screenshot 进入 LLM 视觉上下文 + completion cue 触发继续判断”的语义，在本项目新增 `AgentTurnRequest.minecraftStatus`，LLM 会把 mc-agent 最新截图作为“她在 Minecraft 里的身体视角”附到多模态消息，同时带入连接、当前任务、最近日志和背包。普通对话、游戏陪玩周期 nudge、任务完成后都会携带该上下文；任务完成后除了固定提示，还会追加一轮 completion nudge，让模型基于最新 bot 画面判断是否补一句观察或继续明确下一步。适配点：当前项目没有 `github_girl` 的 push_message/message-plane，因此用 Electron renderer 主动发起 `agentTurn` 承接同等时机。
- `P17` 已补第八段受阻/危险语义：照抄 `github_girl` `_format_completion_cue` 的 blocked marker 思路，将 mc-agent `status=ok` 但反馈包含 `not found`、`unavailable`、`please provide`、`no path`、`blocked` 等文本的完成包改判为 `blocked`，前端不再说“做完了”，而是提示目标/路径/坐标可能需要换思路。`alert` 帧也从普通日志升级为高优先级 Minecraft 事件，携带 severity/cause，renderer 会立即播报危险并触发一轮带 bot 视角的补判断。适配点：当前项目没有 `github_girl` push_message priority/coalesce 队列，所以用现有消息队列和 `requestGameCompanionNudge(cue)` 承接。
- `P17` 已补第九段截图预算：按 `github_girl` `service.py` / `plugin.toml` 的 `screenshot_max_edge_px=1024`、`screenshot_jpeg_quality=80`、`screenshot_max_bytes=102400` 思路，主进程收到 mc-agent 截图后会用 Electron `nativeImage` 压成 JPEG，按 1024/512/256 最长边和 80/65/50/40/30 质量阶梯尝试，尽量把单帧控制在 100KB 内再进入 bot 视角缓存和 LLM 多模态上下文；失败时保留原图，不丢掉视觉信息。适配点：`github_girl` 用 Pillow，本项目用 Electron 原生图像能力，避免新增依赖。
- `P17` 已补第十段自主 nudge loop：按 `github_girl` `GameAgentService._system_prompt_loop` 的 8s in-progress、8s 后 keep-going、10s keep-going 冷却思路，在本项目 `minecraftAgent` 主进程服务里新增系统循环。任务执行超过 8s 会发 `[你正在做事]` cue，要求模型只在有新画面/反馈时讲一句、不要编结果、不要派新任务；任务结束并空闲 8s 后会发 `[你闲下来了]` cue，让模型基于 bot 视角和背包决定是否聊一句或派下一步。适配点：当前项目没有 `push_message ai_behavior="read"` 的 message-plane，所以没有照搬 general read-only 状态注入，避免每 5s 把被动状态变成强制发言；in-progress/keep-going 通过 `minecraft:agentEvent` 的 `nudge` 事件进入已有 `requestGameCompanionNudge(cue)` 多模态链路。
- `P17` 已补第十一段任务防抖和连接抖动恢复：照抄 `github_girl` `GameAgentService._OVERWRITE_MIN_SURVIVAL_S = 2.0` 的 anti-thrash floor，`overwrite=true` 也不能打断刚下发 2 秒内的新任务，防止模型连续工具调用把 mc-agent 在多个目标之间来回打断；同步更新工具 schema 和 LLM 规则，要求只在用户明确纠正/停止/改目标或观察到卡住时 overwrite。另按 `github_girl` `_on_log("Connection lost and re-established.")` 的语义，WebSocket 非预期断开时立即把当前 pending task 标记为 interrupted/丢失，并释放 busy 状态、唤醒前端，而不是等 120s 超时。适配点：本项目没有 agent 日志层的固定重连文本，所以挂在 Electron WebSocket `onclose` 上承接同等语义。
- `P17` 已补第十二段自主循环可观测性：`MinecraftAgentStatus` 增加 `lastNudgeKind/lastNudgeAt`，主进程每次发 in-progress / keep-going nudge 都会记录；市场 Minecraft Agent 配置页显示“自主：执行中观察/空闲续玩 + 时间”，LLM 的 Minecraft bot 视角上下文也带入最近自主判断时间。这样用户问“她为什么没继续动/她有没有自己判断”时，不再只能靠最近日志猜。
- `P17` 已补第十三段 mc-agent 协议 smoke：按 `github_girl` `smoke_local.py` / `README.md` 的目标，新增 `scripts/smoke-minecraft-agent.mjs`、`npm run smoke:minecraft-agent` 和 `npm run smoke:minecraft-agent:mock`。真实模式会连 `ws://localhost:48909`（可用 `MC_AGENT_WS` / `--ws` 改），发送 `query_inventory`，再发送带 `task_id` 的 `task` 帧，等待匹配的 `task_finished`，统计 `log/screenshot/inventory/agent_status/alert`，可用 `--dump-dir` 保存截图；mock 模式内置最小 WebSocket mc-agent，不依赖真实游戏也能验证 inventory/screenshot/task_finished/task_id echo。适配点：`github_girl` 直接实例化 Python `GameAgentService` 并假装 push_message；本项目主逻辑绑定 Electron main/nativeImage，不适合在普通 Node 里直接实例化，所以先做 Node 版真实/模拟 WebSocket 协议 smoke，后续再补 Electron 内部服务级 smoke。
- `P17` 已补第十四段 task_id 迟到包 smoke：继续按 `github_girl` `game_agent_minecraft` 测试里的“任务完成必须匹配当前 task_id”语义，`scripts/smoke-minecraft-agent.mjs` 新增 `--scenario stale-task-id`，mock mc-agent 会先发一个错误 `task_id` 的 `task_finished`，再发正确 `task_id` 的完成包；脚本会记录并忽略错误完成包，只有当前任务的完成包能通过。新增 `npm run smoke:minecraft-agent:mock:stale` 作为快捷入口。适配点：这仍是 WebSocket 协议级 smoke，用来锁住 task_id 串线问题；Electron 主进程内的 overwrite/busy 防抖服务级 smoke 还需要后续单独补。
- `P17` 已补第十五段 richer status 入模：按 `github_girl` game agent “状态进入服务上下文”的方向，`agent_status` 帧现在会宽松解析 `position/pos/location`、`health/hp`、`food/hunger`、`dimension/world`、`biome`、`gameMode`、`selectedItem/heldItem`、`equipment`、`nearbyEntities` 等字段，缓存为 `MinecraftAgentWorldState` 并进入 `MinecraftAgentStatus`、工具状态回复、游戏陪玩 prompt 和 LLM 的 Minecraft bot 视角上下文。适配点：外部 mc-agent 当前字段规范还不固定，所以本项目先做多字段兼容解析；如果后续 mc-agent 明确血量、坐标、附近实体协议，再把 schema 收紧。
- `P17` 已补第十六段长目标状态：在 `MinecraftAgentStatus` 中新增 `activeGoal/activeGoalUpdatedAt`，文本直达 Minecraft 任务会把用户原话作为这一局当前目标，LLM 工具调用也可传 `goal`；停止/取消类任务会清空目标。空闲续玩 nudge、Minecraft bot 视角 prompt、状态工具、市场 Minecraft 配置和前端状态回复都会带入该目标，让“建房子/长线挖矿/跟随探索”不再只靠最近一条 task 猜。适配点：这只是目标记忆和续玩约束，还不是完整 plan/checkpoint/失败恢复系统。
- `P17` 已补第十七段玩家协作状态：继续沿 `github_girl` damage-cause / nearby player 提示词方向，`agent_status` 现在会宽松接收 `trackedPlayer/targetPlayer/followTarget/master/owner/user/human/nearestPlayer` 和 `nearbyPlayers/players`，规范成 `MinecraftAgentPlayerState`（名字、距离、坐标、血量、手持物），并放进 `worldState.trackedPlayer/nearbyPlayers`。LLM 的 Minecraft bot 视角、状态工具和前端状态回复都会看到“用户/队友距离、位置、附近玩家”，为跟随、别挡路、找回用户、多人协作打基础。适配点：外部 mc-agent 还没有固定玩家字段 schema，所以本项目先多字段兼容，不假定一定存在用户坐标。
- `P17` 已补第十八段路径/危险/目标状态：继续沿 `github_girl` blocked marker、damage-cause hint 和 pathfinding 长耗时保护方向，`agent_status` 现在会宽松解析 `path/pathState/pathfinding/navigation/route`、`target/currentTarget/destination/blockTarget`、`danger/risk/threat/hazard/hostiles`，规范成 `MinecraftAgentPathState`、`MinecraftAgentTargetState`、`MinecraftAgentDangerState`。LLM Minecraft 视角、状态工具和前端状态回复都会看到“路径是否卡住、目标坐标/距离、受阻物、危险等级/原因/敌对实体、低血量风险”。适配点：这不是本项目自己做寻路，而是接住外部 mc-agent 的真实路径/危险 ground truth，避免模型靠截图硬猜。
- `P17` 已补第十九段游戏内聊天桥：按 `github_girl` game agent “游戏内身体/外部 agent 负责实际交互，本应用负责对话和任务调度”的方向，主进程 `minecraftAgent` 新增最近游戏聊天缓存和 `plugin.minecraft_chat` 工具；入站兼容 `chat/game_chat/player_chat/message`，出站发送 `{ type: "chat", text, message }` 给外部 mc-agent。LLM 的 Minecraft bot 视角会带入最近聊天，前端文本直达支持“在游戏里说/回复/打字…”，收到游戏聊天事件会触发陪玩 nudge，让她能自然判断是否在 MC 里回一句。适配点：`github_girl` 已公开的 Minecraft 插件说明里没有稳定聊天帧 schema，本项目先做兼容层；真正把消息发进 MC 聊天还需要外部 mc-agent 实现/确认该帧。
- `P17` 已补第二十段目标阶段/检查点状态：继续按 `github_girl` `GameAgentService` 把 pending、dispatched history、task_finished、keep-going nudge 分开的思路，本项目新增 `MinecraftAgentPlanState`，在任务帧真正发出后记录 active step，收到完成/受阻/超时/打断/迟到完成后回写最近步骤、摘要、连续失败次数和最后结果时间。`planState` 进入 `MinecraftAgentStatus`、LLM 的 Minecraft bot 视角、状态工具、前端状态回复和 keep-going nudge；当连续受阻时，prompt 会要求换具体坐标/目标或先问用户，不再重复派同一个动作。适配点：这还不是外部 mc-agent 里的真正规划器，而是当前应用内的目标阶段缓存；完整 plan/checkpoint/失败恢复仍需要后续结合 message-plane 和外部身体状态实现。
- `P17` 已补第二十一段协议回放测试扩展：继续按 `github_girl` `smoke_local.py` / `smoke_overwrite.py` 的思路，把本项目 `scripts/smoke-minecraft-agent.mjs` 从普通 task/query_inventory/stale-task-id 扩到 `rich-state`、`blocked-task`、`chat` 三个 mock 场景。`rich-state` 会回放血量、坐标、维度、生物群系、装备、附近实体、队友位置、路径、危险、聊天和告警；`blocked-task` 会模拟 `status=ok` 但文本含 `could not/no path` 的 blocked marker；`chat` 会验证出站聊天帧和入站聊天回显。新增 `npm run smoke:minecraft-agent:mock:rich|blocked|chat`，用于后续改 Agent 架构时快速锁住协议行为。适配点：这仍是 Node WebSocket 协议级 smoke，不是 Electron 主进程内部服务测试；服务级测试还要等测试入口或 message-plane 拆出来后补。
- `P17` 已补第二十二段多人协作语义：在不破坏 `github_girl` 已迁的 `minecraft_task`/busy/overwrite/nudge 规则前提下，新增“跟随 3-5 格、不挡视线/路径、距离超过 8 格先等待或找回、危险优先保护、分工不抢资源、共享箱子只处理富余物品”等协作约束。文本直达现在能识别“别挡路/保护我/等我/带路/分工/共享箱子”等指令并转成更具体的英文 task；LLM Minecraft 视角、游戏同伴 prompt、状态工具回复和市场能力都同步显示协作状态。主进程状态解析新增 `sharedContainers` 和 `blockInteraction` 兼容字段，rich-state smoke 也回放并断言共享容器/方块交互进度。适配点：`github_girl` 公开 Minecraft 插件本身没有更细的协作 schema，本轮属于在其 game-agent 桥接逻辑之上的本项目适配增强；真正“不挡路/共享箱子/分工”的物理执行还依赖外部 mc-agent 按 task 落地。
- `P17` 已补第二十三段 Electron 主进程服务级 smoke：新增 `scripts/smoke-minecraft-agent-service.mjs` 和 `npm run smoke:minecraft-agent:service`，脚本会临时 bundle 真实 `MinecraftAgentService`，给 Node 环境注入最小 WebSocket client，再启动 mock mc-agent 验证主进程服务语义：`queryInventory` live 回包、`dispatchTask` pending 状态事件、busy 拦截、2 秒 overwrite 防抖、超过保护窗后的打断/替换、匹配 `task_finished` 清 pending、游戏内聊天事件、断线时中断 pending 并回流 disconnected 状态。该 smoke 抓出并修复了一个真实 race：原 `queryInventory` 先发送 `query_inventory` 再登记 waiter，外部 agent 快速回包时会丢响应；现在改为先登记 waiter 再发送，发送失败再移除 waiter。适配点：这不是完整 Electron 窗口 E2E，但已经覆盖主进程服务内核和 renderer 依赖的 `minecraft:agentEvent` 事件源。
- `P17` 已补第二十四段 mc-agent 协作协议确认：保持 `github_girl` 旧协议向后兼容，不强制外部 agent 必须实现新握手；同时本项目新增 `MinecraftAgentProtocolState`，能识别外部 agent 发来的 `hello/agent_hello/capabilities/agent_capabilities/protocol` 帧，也会从 `agent_status`、聊天和 task_id echo 中推断已支持能力。`MinecraftAgentStatus.protocol` 现在包含客户端协议版本、agent 名称/版本/协议版本、已确认能力、仍缺能力和协作 contract；LLM Minecraft 视角与游戏同伴 prompt 会看到这些信息。出站 `task` 帧新增 `client` 元数据，携带 `virtual-lover-mc-agent/1`、客户端能力列表和协作 contract（跟随 3-5 格、超过 8 格找回/等待、不挡路、不挖用户脚下、不抢资源、共享箱子只处理富余物品），旧 agent 可忽略，新 agent 可据此实现物理层协作。服务级 smoke 和协议 smoke 都已覆盖 task frame contract 与 agent 能力声明。适配点：这仍不是内置 mineflayer 机器人本体；它把双方协议边界钉住，方便后续实现/替换外部 mc-agent。
- `P17` 已补第二十五段 Electron renderer IPC/preload smoke：新增 `scripts/smoke-minecraft-renderer.mjs` 和 `npm run smoke:minecraft-agent:renderer`，脚本会临时 bundle 真实 `MinecraftAgentService` 与真实 `src/preload/preload.ts`，再启动一个隐藏 Electron renderer，通过 `window.lover.getMinecraftAgentStatus()`、`window.lover.invokeAgentTool(plugin.query_inventory/plugin.minecraft_task)` 和 `window.lover.onMinecraftAgentEvent()` 验证 Minecraft 状态、背包、任务派发、`protocol` 事件、`taskFinished` 事件和 DOM 事件流都能从 mock mc-agent 一路穿过主进程 IPC/preload 到 renderer。mock 还会断言出站 task frame 保留 `virtual-lover-mc-agent/1` 客户端协议元数据和协作 contract。适配点：这不是完整聊天 UI 视觉 E2E，也没有连接真实 Minecraft/mineflayer；但它已经把 Electron renderer 依赖的关键桥打通，后续 UI 改动或 preload 断链会被稳定回归抓住。
- `P17` 已补第二十六段内置 mineflayer starter：`github_girl` 原项目没有把 mc-agent 二进制打进插件，而是通过 quickstart 指向外部分发包；本项目在保持该下载路径的同时新增 `integrations/minecraft-agent` 独立 Node 包，内含 `mineflayer`/`mineflayer-pathfinder` starter、`config.example.json`、`start-windows.cmd` 和 README。该 starter 默认监听 `ws://127.0.0.1:48909`，向本应用声明 `virtual-lover-mc-agent/1`、回传 `agent_status/inventory/chat/log/alert/task_finished`，并能执行基础物理任务：跟随/靠近玩家、停止、查背包、游戏内发言、挖附近木头或常见矿物、攻击附近敌对生物、吃食物。主进程新增 `minecraft:agentStarterInfo` IPC，preload 暴露 `getMinecraftAgentStarterInfo()`，市场 Minecraft Agent 配置页会显示本地 starter 绝对路径、安装/启动命令，并提供“打开本地 starter”和默认启动内置 `start-windows.cmd` 的入口；根 `package.json` 新增 `minecraft-agent:install/start/check` 快捷命令。适配点：这仍不是 `github_girl` 外部分发的完整 mindserver/mc-agent 管理面板，也没有真实渲染截图、容器锁、复杂建造和长期规划；但第二账号身体已经从“只给下载链接”推进到“项目内可运行 starter + 协议骨架”。
- `P17` 已补第二十七段 starter 管理/诊断/配置保存：继续沿 `github_girl` quickstart 管理面板思路，把本项目内置 `integrations/minecraft-agent` 从“有脚本可打开”推进到“市场里能诊断和写配置”。主进程 `minecraft:agentStarterInfo` 现在会检测 unpack 后 starter 路径、`start-windows.cmd`、`config.json`、`node_modules`、Node/npm PATH、当前 starter bridge URL 与应用 WS URL 是否一致，并返回结构化 diagnostics；新增 `minecraft:agentStarterConfig:save`，可生成 `config.json`、写入 MC host/LAN port/bot username/auth/owner/bridge port，并自动同步应用 `minecraftAgentWsUrl`。市场 Minecraft Agent 配置页新增 starter 表单、刷新诊断、生成默认配置、保存 starter 配置按钮；打包配置加入 `asarUnpack` 和 starter lockfile，避免正式包里脚本被塞进 asar 之后无法直接运行。适配点：仍未做到自动读取 Minecraft 聊天里的 LAN 端口，也还没有真正启动外部进程并捕获 stdout/stderr；但用户手动 LAN 联机前的端口/依赖/配置错误已经能在应用里定位。
- `P17` 已补第二十八段 starter 进程管理/日志回流：在保留 `github_girl` quickstart “用户可自己启动外部 mc-agent”设计的同时，本项目因为已经内置 `integrations/minecraft-agent`，新增 `src/main/minecraftAgentStarterProcess.ts` 作为独立主进程模块，负责 `npm install`、`npm start`、停止进程树、隐藏启动窗口、捕获 stdout/stderr、识别常见 error/warn 日志并通过 `minecraft:agentStarterEvent` 推给 renderer。preload 新增 `getMinecraftAgentStarterProcessState()`、`runMinecraftAgentStarterProcessAction()`、`onMinecraftAgentStarterEvent()`；市场 Minecraft Agent 配置页新增“安装依赖 / 启动内置 starter / 停止”和最近启动日志面板。适配点：`github_girl` 不内置进程管理，本轮属于把其管理面板思路落到当前 Electron 内置 starter；仍未做真实 Minecraft LAN 世界验证。
- `P17` 已补第二十九段 LAN 端口识别与启动错误结构化：继续贴合 `github_girl` quickstart 里“Open to LAN 后看聊天框端口、排错先看黑窗口最后几行”的设计，市场 Minecraft Agent 配置页新增“LAN 端口提示”输入框，能识别 `Local game hosted on port XXXXX`、`hosted on port XXXXX`、中文“端口 XXXXX”和直接端口数字，识别后自动写入 starter `minecraft.port` 并保存。`minecraftAgentStarterProcess` 现在会把 stdout/stderr 中的 `EADDRINUSE`、`ECONNREFUSED/connection refused/timed out`、`unsupported protocol/version mismatch/outdated client/server`、`auth/microsoft/invalid session/login failed`、`kicked/whitelist/banned`、`cannot find module/missing dependencies` 等日志归类成结构化 `issues`，市场面板展示标题、修复动作和原始日志。适配点：目前仍是基于日志文本的本地规则，不是完整 mindserver settings_spec，也还没有自动从 Minecraft 客户端窗口 OCR/剪贴板读取端口。

当前进度估算：整体迁移约 70%；核心桌宠/Live2D 体验约 73%；屏幕/摄像头视觉链路约 76%；Minecraft P17 当前项目内闭环约 99%，完整游戏 Agent 自主玩法约 94%。

## Agent / Minecraft 剩余缺口

### Agent 整体还差什么

1. **独立 Agent 服务与事件总线（G01）**：当前 Agent 仍主要压在 Electron 主进程和 renderer 调度里；`github_girl` 是主服务/记忆服务/Agent 服务分离，并通过事件总线传任务状态。后续要把任务执行、工具调用、状态推送拆成独立服务，减少主进程复杂度。
2. **任务系统完整化（G02）**：当前已有工具注册、任务快照和 Minecraft pending 保护，但还没有 `github_girl` 级别的全局任务去重、纠错、中断、重试、恢复队列。需要统一所有电脑控制、浏览器控制、游戏控制的 task_id、dedupe、cancel、retry。
3. **message-plane / push_message 语义（L04/G01）**：当前没有 `push_message ai_behavior="read/respond"`、priority、coalesce、visibility 这一层，所以很多 `github_girl` 的被动上下文注入只能用主动 `agentTurn` 适配。要完整迁入，必须补统一消息平面。
4. **Computer Use / Browser Use 适配器（G03/G04）**：当前电脑控制还偏“提出动作 + Electron 执行”；`github_girl` 有更系统的视觉动作循环、浏览器任务适配、外部执行器适配。需要把桌面/浏览器自动化也纳入同一 Agent 任务系统。
5. **外部 Agent 后端兼容（G05/G06）**：OpenClaw/QwenPaw/OpenFang 这类外部执行后端还没接，后续可让复杂任务交给专用 agent，而不是全部塞进主模型。
6. **Agent HUD（G07）**：当前状态散落在聊天、市场和设置里；还缺桌面级任务 HUD，持续显示当前任务、步骤、取消/纠错入口。
7. **MCP/Skill 生命周期**：现在已有市场和内置工具概念，但还不是完整的 MCP/Skill 运行时：安装、卸载、权限、配置 schema、版本、隔离进程、工具发现、日志、健康检查都要补。
8. **测试和回放**：缺可重复的 agent 任务回放、模拟工具返回、端到端视觉测试；现在主要靠手动试和 TypeScript/build 验证。

### Minecraft 还差什么

1. **mc-agent 身体已有项目内 starter，但仍需真实联机打磨**：当前应用负责对话、视觉、任务下发；本轮新增 `integrations/minecraft-agent` mineflayer starter，可控制第二账号做基础移动/挖掘/聊天/背包/战斗动作，也已能在市场中生成/保存 config、诊断 Node/npm/依赖/WS 配置。还缺 `github_girl` 外部分发包里的完整 mindserver 管理面板、二进制版本管理、自动识别 Minecraft LAN 端口、截图流、复杂建造、容器锁和真实联机压力测试。
2. **message-plane 未补导致 general read-only 状态注入没原样迁**：`github_girl` 能把日志/截图作为 `read` 上下文静默塞给模型；本项目目前只迁了任务完成、危险、执行中、空闲续玩这些会触发判断的 cue。要原样迁，需要先补 message-plane。
3. **更丰富的游戏状态**：已能接住并入模血量、饥饿、坐标、朝向、维度、生物群系、装备、手持物、附近实体、用户/队友位置、附近玩家、方块/目标、路径状态、危险等级、共享容器、方块交互进度、最近游戏聊天、协议能力声明等常见状态；还缺更稳定的用户身份映射、用户视线方向语义、容器锁/物品预定等协作 ground truth，需要外部 mc-agent 真正按 `virtual-lover-mc-agent/1` 输出。
4. **长期目标规划**：已有 `activeGoal` 和 `planState` 保存这一局持续目标、当前步骤、最近步骤、连续受阻次数，并进入空闲续玩判断；状态层也能接住路径/目标/危险反馈。还缺真正的多阶段 plan 生成、checkpoint 持久化、失败恢复策略和资源预算。
5. **多玩家协作语义**：已补跟随半径、别挡路、保护、带路、等待、分工采集、共享箱子等任务/prompt/status 规则，并通过 task frame `client.collaboration` 把 contract 明确传给外部 agent；还缺外部 mc-agent 真实物理层的“不挡路”寻路策略、共享容器锁/物品预定、稳定用户身份映射和基于用户视线方向的协作细节。
6. **游戏内自然沟通**：已补基础聊天桥，能缓存游戏聊天并通过 `plugin.minecraft_chat` 向外部 mc-agent 发送短句；还缺外部 mc-agent 对聊天帧的稳定协议确认、游戏内用户身份映射，以及把游戏内聊天和桌面对话做更完整的去重/合并。
7. **启动与连接自动化**：市场里已有下载、路径、管理面板、本地 starter 诊断、配置保存、依赖安装、启动/停止、日志回流、LAN 端口识别和常见启动错误结构化提示；还不能自动从 Minecraft 客户端窗口 OCR/剪贴板抓端口，也还不能自动确认 bot 已进世界。
8. **E2E 测试环境**：已有 Node 版 mc-agent 协议 smoke 和 mock/stale-task-id/rich-state/blocked-task/chat 场景，能验证 task/query_inventory/screenshot/task_finished/迟到包、richer status、blocked marker、chat/alert 回放；也已有主进程服务级 smoke 覆盖 live inventory、busy、overwrite 防抖、匹配完成、聊天、断线和事件回流；本轮新增 Electron renderer IPC/preload smoke，能验证 renderer 通过 `window.lover` 拿到状态、协议、背包、任务与事件。还缺完整聊天 UI 视觉 E2E，以及接真实 Minecraft/mineflayer 的联机回放。

### 下一步建议顺序

1. 先做 **mc-agent starter 真实联机回放**：在本地 Minecraft LAN 世界里跑 `integrations/minecraft-agent`，补 smoke/诊断日志，确认第二账号能稳定进世界、跟随、挖木头、聊天、回传背包和状态。
2. 再补 **自动进服确认/状态闭环**：根据 `agent_status`、游戏聊天和 starter 日志判断 bot 是否真的进世界，并在市场里显示“已作为第二玩家入服/未入服/端口可能错误”。
3. 再补 **完整聊天 UI 视觉 E2E**，验证真实 App 聊天窗口里 Minecraft 状态、任务、协议能力和事件能完整显示。
4. 然后做 **全局 message-plane**，让 Minecraft 和其他 Agent 能共享 `read/respond`、priority、coalesce。
5. 最后再拆 **独立 Agent 服务 + 任务系统**，这是大工程，应该在 Minecraft 核心稳定后动。

## 文件域审阅摘要

- `app/`：四个服务入口，主服务、记忆服务、Agent 服务、监控/字幕服务。
- `main_logic/`：对话核心、Realtime/Offline LLM、TTS、tool calling、活动追踪、主动投递。
- `memory/`：事实/反思/人格/召回/证据/归档/embedding/anti-repeat/禁谈指令。
- `main_routers/`：角色、模型、记忆、Agent、系统、创意工坊、游戏、音乐、云存档等 API。
- `brain/`：Computer Use、Browser Use、OpenClaw、OpenFang、任务执行器。
- `plugin/`：插件 SDK、host、message plane、CLI、内置插件。
- `frontend/react-neko-chat/`：React 聊天窗组件。
- `frontend/plugin-manager/`：Vue 插件管理器。
- `static/` + `templates/`：传统页面、Avatar runtime、音频、教程、字幕、Jukebox。
- `config/`：模型供应商、角色本地化、全部 prompt。
- `utils/`：音频、TTS、配置、存储、日志、截图、爬虫、遥测、Steam、工具函数。
- `docs/`：API、架构、部署、前端、插件文档。
- `tests/`：单元、集成、前端、E2E、testbench。
- `.agent/`、`.github/`、`scripts/`、`docker/`、`local_server/`：工程化、CI、部署、遥测/CosyVoice 辅助服务。
