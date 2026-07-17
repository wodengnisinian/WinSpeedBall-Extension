```
如有 Bug 或其他问题，可使用邮箱联系作者。或者，如果您愿意参与这个项目的制作，作者诚恳地向您发出邀约。感谢您的一丝偶然想法，让这个项目更加完美。
作者邮箱 / Email：zbdwxb57531@qq.com
```

# WinSpeedBall Extension

面向 Microsoft Edge 和 Chromium 浏览器的学习辅助扩展，提供视频控制、区域截图 OCR、网页语音转文字、可配置 AI 学习辅助、图书翻页和本地用户脚本功能。

当前发布版本：WinSpeedBall `3.7.0 Developer Beta`

内置 SDK 版本：`3.7.0-beta`

本版推荐使用短接口名：`WSB.video.all()`、`WSB.video.status()`、`WSB.video.rate()`、`WSB.video.volume()` 和 `WSB.book.status()`。旧接口名继续兼容，现有脚本无需立即修改。

## 3.6.0 与 3.7.0 版本区别

| 对比项目 | 3.6.0 Developer Beta | 3.7.0 Developer Beta |
| --- | --- | --- |
| 版本定位 | 建立视频强控制、WSB SDK、能力声明、基础 AI/OCR、日志和本地隐私管理 | 在 3.6.0 基础上完成问题获取、网页语音、图书阅读器、公开接口和工程结构升级 |
| 视频控制 | 支持多 Frame 媒体识别、倍速锁、播放状态聚合和持续控制 | 公开媒体数量、总时长、已播放、播放状态、自动播放和倍速锁等完整状态，并减少动态页面重复扫描 |
| 问题获取 | 以区域截图和本地 OCR 为主 | 合并截图预览与 OCR 结果，新增 Edge 标签页声音获取和本地 Whisper 转写 |
| AI 功能 | 提供基础多 Provider 配置、提问和回复窗口 | DeepSeek、OpenAI、Claude、本地模型使用独立工作区与历史；完善窗口替换、文本正规化和响应大小保护 |
| 图书功能 | 未形成完整的学习通图书控制体系 | 支持学习通 `insertbook`、SSLibrary EPUB、旧版 JPath/Readweb、多层 iframe、自动翻页和封底检测 |
| Developer SDK | 建立 WSB API、能力授权和受限沙箱基础 | SDK 升级为 `3.7.0-beta`，增加短接口、`book.read`、`qa.read`、`ai.read`，单脚本隔离存储提升到 5 MiB |
| 数据与安全 | 提供本地账户、使用声明、权限确认和隐私清理 | 增加网页语音本地处理说明、问题与 AI 回复独立只读授权、长脚本标识防冲突和 AI 响应上限 |
| 工程结构 | 主要运行文件集中在项目根目录 | 按 `background`、`popup`、`content`、`ocr`、`voice`、`sdk`、`workspace`、`vendor` 分类整理并增加结构守卫 |

从 3.6.0 升级到 3.7.0 后，原有长接口名仍然兼容，但 Developer SDK 授权与 Runtime 版本已经更新，首次运行高级脚本时需要重新确认能力。

## 3.7.0 更新项目

### Developer Mode 与公开接口

- SDK Runtime 和授权绑定版本升级为 `3.7.0-beta`，编辑器新增行数、字符数、能力数量和保存状态统计。
- 新增草稿复制、`Ctrl+S` 保存、导入导出、契约校验、最多 20 个草稿和真实 API 测试。
- 推荐使用 `video.all/status/rate/volume` 与 `book.status` 短接口，旧名称继续兼容。
- `WSB.video.status()` 补齐媒体数量、总时长、已播放、播放状态、自动播放和倍速锁等字段。
- 新增 `book.read`、`qa.read`、`ai.read` 只读能力，可读取图书状态、OCR/语音问题及 AI 最新回复与历史。
- 单个高级 SDK 脚本隔离存储由 256 KiB 提升至 5 MiB；单值仍为 64 KiB，最多 100 个键。

### AI 与问题获取

- DeepSeek、OpenAI、Claude 和本地模型分别保存问题草稿、回复与历史记录，使用 `DS`、`OAI`、`CLD`、`LM` 快速切换。
- 框选截图预览与 OCR 结果合并显示，新增当前 Edge 标签页声音获取和本地 Whisper Tiny q8 转写。
- OCR、网页语音和 AI 回复统一执行简体中文与英文正规化。
- AI 回复使用固定独立窗口，新回复会完整关闭旧回复窗口，避免内容重叠。
- AI 响应最多读取 2 MiB，超限立即取消，降低异常响应持续占用内存的风险。

### 图书功能

- 新增学习通课程 `insertbook` 组件、SSLibrary EPUB 和旧版超星 JPath/Readweb 图片阅读器支持。
- 扫描多层 iframe 后锁定评分最高的真实阅读器，并在 MAIN 主环境调用原生翻页接口。
- 图书页面拆分为图书自动翻阅、图片自动翻阅和学习通版本，学习通模式最低支持 2 秒翻页间隔。
- 按 400、300、250、150、50 秒递减间隔检测封底页，到达封底后自动停止。
- 自动避开课程“上一节”“下一节”按钮，并按需申请阅读器来源权限、记录完整执行日志。

### 工程、安全与文档

- 运行代码和资源按职责重新整理目录，项目根目录只保留 Manifest、更新日志、说明、隐私政策和 Git 配置。
- 长脚本标识使用稳定哈希后缀，避免截断后出现注册名或隔离环境冲突。
- 媒体主环境扫描合并为单次 DOM 遍历，减少动态页面中的重复查询。
- 新增项目结构守卫并扩充自动化测试，持续检查入口、依赖、资源、权限和公开接口一致性。
- README、完整使用说明、隐私说明、使用声明和插件内更新日志均已同步到 3.7.0。

完整逐项记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 主要功能

- 视频倍速、音量、静音和持续播放控制
- 区域截图及本地中英文 OCR
- 获取当前 Edge 标签页播放的声音，并使用内置 Whisper Tiny q8 在本机转成文字
- OCR 完成后按用户设置自动发送给 DeepSeek、OpenAI、Claude 或本地模型
- 新 AI 回复优先显示在前方；重新打开插件时不会被历史回复抢走焦点，独立窗口并存时尽量相邻排列
- AI 回复窗口采用紧凑阅读布局，长文本独立滚动，并显示更新时间和字数
- 新回复到达时完整关闭上一个 AI 回复窗口，再打开新的置前窗口，避免新旧回复重叠
- 自定义 OCR 自动发送提示词，支持 `{{OCR}}` 占位符
- 图书界面保留“图书自动翻阅”和“图片自动翻阅”，并新增“学习通版本”：专门控制超星 PDG/JPath 图像书及其书名页、目录页、正文页和封底页
- 支持学习通 `insertbook` 课程组件、SSLibrary EPUB、旧版 JPath/Readweb 图片阅读器与多层 iframe，并使用浏览器 MAIN 主环境原生强控
- Developer SDK 提供只读 `book.read` 能力和精简接口 `WSB.book.status()`，可在绑定当前网页后读取图书当前选项、封底状态与检测倒计时；旧 `getStatus()` 名称继续兼容
- Developer SDK 新增 `qa.read` 与 `ai.read` 只读能力，公开 OCR/网页语音问题、最新 AI 答案和历史答案；API Key 始终不对脚本开放
- 按“视频、OCR、AI、图书、脚本、其他”分类运行本地脚本
- 详细任务日志和截图、OCR、AI 状态追踪
- 本地用户注册、登录、退出、资料修改、改密和账户删除
- 首次使用声明、禁止用途说明和版本化确认记录
- 顶部固定按钮，可将浏览器原生弹窗打开为持续停留的独立小窗口
- 浏览器主弹窗与独立主窗口均固定为 320×340，并共享记住上次打开的功能页；独立窗口另外记住位置
- 默认隐藏的 Developer Mode，提供实时脚本状态、多草稿复制与导入导出、Ctrl+S 保存、受限沙箱运行、单脚本 5 MiB 隔离存储和真实 API 测试
- `WSB.video`、`WSB.qa`、`WSB.page`、`WSB.book`、`WSB.ai`、`WSB.ocr.latest` 与按脚本隔离的 `WSB.storage`；对外方法优先使用短名称

## 完整使用说明与脚本开发

项目功能、安装使用、普通用户脚本要求、Developer SDK 规则、全部 WSB 公开接口、参数限制、返回模型和示例，统一见：

- [`docs/user-guide-and-script-api.md`](docs/user-guide-and-script-api.md)
- [`CHANGELOG.md`](CHANGELOG.md)：版本更新与优化记录
- [`PRIVACY.md`](PRIVACY.md)：本地数据、第三方服务与删除方式
- [`docs/usage-declaration.md`](docs/usage-declaration.md)：允许用途、禁止用途与责任边界

## 在 Microsoft Edge 中安装

1. 打开 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `WinSpeedBall-Extension-publish`。
5. 修改代码后，需要在扩展管理页面点击“重新加载”。

## 网站权限

- 视频控制、区域 OCR 和页面总结默认只在用户打开扩展后临时访问当前标签页。
- 网页语音只有在“问题获取 → 网页语音”中点击“开始录音”后才会获取当前标签页声音；不使用麦克风权限。
- 自动翻页等持续功能会在启动时申请当前网站权限，不会申请读取和修改所有网站。
- 保存 AI 设置时只申请当前服务地址的访问权限；切换服务后会单独申请新地址，不会一次授权全部网络地址。
- 本地脚本通过浏览器官方 `chrome.userScripts` 安全环境运行。请在扩展详情页开启“允许用户脚本”。
- 本地脚本默认只能手动运行；确认脚本权限并点击“权”按钮后，才会在当前授权网站自动运行。
- 标签页跳转到其他网站或用户撤销网站权限后，持续任务会自动停止。

用户脚本必须包含权限声明：

```javascript
// ==UserScript==
// @name Example
// @property 其他
// @match https://example.com/*
// @permission dom
// ==/UserScript==
```

当前兼容层支持 `dom`、`network` 和用于宿主自动翻页桥接的 `automation`。首次运行或权限变化后，扩展会再次请求用户确认。新 SDK 脚本应改用 `@wsb-capability`，不能与旧 `@permission` 混用。

## 问题获取与 AI 使用方法

1. 在设置页面选择 DeepSeek、OpenAI、Claude 或本地模型，并填写对应的 API Key、服务地址和模型；本地模型可以不填 API Key。
2. AI 提问页面顶部将四个服务缩写为 `DS`、`OAI`、`CLD`、`LM`，并排显示在一行；当前标签决定本次请求使用哪个服务。
3. 四个 AI 标签分别保存问题草稿、回复和历史记录，切换标签不会互相覆盖。
4. 如需自动发送，打开“OCR 识别完成后自动发送给 AI”。
5. 自定义提示词可以留空，也可以使用 `{{OCR}}` 插入本次识别结果。
6. 点击区域 OCR，回到网页框选内容。
7. 截图会保存到扩展的 IndexedDB，并由后台隐藏工作页继续识别；主弹窗不加载 OCR 引擎，关闭弹窗也不会中断识别。
8. OCR 失败后可以点击“重新识别”，任务仍由同一个后台离屏流程执行。
9. OCR 和 AI 的当前状态、失败原因可以在日志页面查看。

网页内播放语音题目时：

1. 进入“问题获取 → 网页语音”。
2. 点击“开始录音”，再播放网页里的题目声音。
3. 播放完后点击“停止识别”。单次最长录制 60 秒。
4. 扩展使用内置的 Whisper Tiny q8 模型在本机识别。模型资源约 67 MB，首次加载通常较慢，完成后会保留 5 分钟供下一次识别复用。
5. 语音、OCR 识别结果和 AI 回复都会自动把繁体中文转为简体中文，并将全角、兼容和常见样式字符转换为正常的中文或英文；无法转换的异常文字会被移除。OCR 和 AI 回复会保留原有换行与段落。
6. 识别结果可以复制，也可以手动发送给 AI。录音只在内存中临时处理，不会写入文件或上传；仅转写文字保存在扩展本地存储中。

Edge 只允许在用户从当前网页点击工具栏扩展图标后获取该标签页声音。因此，固定独立窗口会给出操作提示；请切回播放语音的网页，点击工具栏中的 WinSpeedBall 图标，再在打开的原生弹窗中开始录音。

旧版 DeepSeek 配置会自动迁移。升级后请在设置页点击一次“保存”，让浏览器确认当前 AI 服务地址的访问权限。

## 账户与使用声明

- 当前账户为本地账户，只在当前浏览器配置中有效，不支持云同步、订阅结算或在线找回密码。
- 密码使用随机盐和 PBKDF2-SHA-256 摘要保存，不保存明文；登录会话只保存在浏览器临时会话区。
- 用户可以注册、登录、退出、修改显示名称、修改密码和删除本地账户。
- 使用声明会记录版本、内容摘要和确认时间。声明更新后需要重新确认。
- 声明用于解释产品用途、禁止行为、数据处理和使用责任，不是不可篡改的司法存证，也不能替代正式法律意见。
- 完整文档见 [`PRIVACY.md`](PRIVACY.md) 和 [`docs/usage-declaration.md`](docs/usage-declaration.md)。

## 隐私说明

- 截图、OCR 结果和网页语音转写文字默认保存在本机浏览器扩展存储中。
- Tesseract OCR 在本地运行，不上传截图。
- Whisper 在本地运行，不上传网页录音；录音识别完成或取消后立即从内存释放。
- 只有启用自动发送或手动点击发送时，识别后的文字才会发送到用户配置的 AI 服务。
- API Key 保存在当前浏览器的受信任扩展存储中，不会向网页内容脚本开放，也不会写入日志。
- 日志记录任务编号、状态、耗时和文字数量，不记录完整 OCR 内容或 API Key。
- 本地账户不要求邮箱或手机号；用户名和密码摘要不会上传到项目服务器。

## 目录结构

```text
assets/       图片、图标和捐赠资源
background/   Service Worker 与后台领域服务
content/      注入网页的媒体检测和控制脚本
docs/         使用文档与人工测试页面
ocr/          本地 OCR 引擎和离屏工作页面
popup/        插件主界面、AI 回复窗口及界面控制器
sdk/          用户脚本 SDK、协议和沙箱运行器
shared/       前后台共享模块
tests/        自动化测试与 Edge 端到端测试
vendor/       OpenCC、Tesseract 和 Whisper 本地依赖
voice/        网页语音过滤和本地 Whisper Worker
workspace/    隔离的用户脚本界面工作区
```

项目根目录只保留 `manifest.json`、更新日志、说明文件和 Git 配置，运行代码全部按照职责存放在对应目录。

## 项目模块

- `background/service-worker.js`：扩展生命周期、标签页控制、OCR 和自动翻页编排。
- `background/storage-service.js`：本地存储、后台日志和截图 IndexedDB。
- `background/declaration-service.js`：使用声明内容、版本、摘要和确认记录。
- `background/user-service.js`：LocalUserProvider 实现、本地账户、密码摘要和会话生命周期。
- `background/user-provider.js`：UserProvider 契约、注册表和活动 Provider 门面。
- `background/subscription-service.js`：Free、Pro、Enterprise 计划和额度接口预留，不包含支付。
- `background/feature-gate.js`：功能登记、计划查询和统一能力判定。
- `background/developer-mode-service.js`：Developer Mode 开关、FeatureGate 校验和 SDK 状态。
- `background/privacy-service.js`：统计和清理本地截图、OCR、AI 历史、日志、用户脚本及账户数据。
- `background/window-service.js`：固定窗口找回、位置和大小持久化，以及关闭后重新打开恢复。
- `sdk/contracts.js`：`3.7.0-beta` 内置 SDK 的公开 API、事件、能力和版本化请求协议。
- `sdk/script-runner.js`、`sdk/script-worker.js`：独立 Worker、私有 MessagePort、超时终止和运行全局限制。
- `background/permission-service.js`：SDK 能力授权、代码与来源绑定、短期运行令牌和撤销。
- `background/sdk-context-service.js`：一次性标签页、来源和能力确认，防止确认期间页面切换。
- `background/sdk-service.js`：经过权限和 FeatureGate 校验的真实 Video、Page、Book、AI、OCR 与 Storage 调度。
- `background/ai-providers.js`：不同 AI 服务的请求协议、响应解析、超时、请求与响应大小限制和安全校验。
- `background/ai-service.js`：AI Provider 选择、独立配置、旧数据迁移、OCR 结果关联及脱敏后的最新回复与历史读取。
- `background/ocr-service.js`：离屏 OCR 调度、任务状态、结果处理和自动 AI。
- `ocr/engine.js`、`ocr/offscreen.html`、`ocr/offscreen.js`：本地 OCR 引擎和统一离屏任务页面。
- `background/voice-service.js`、`voice/worker.js`：Edge 标签页音频获取、录音状态、本地 Whisper 模型和语音转写。
- `voice/text-filter.js`：OCR、语音和 AI 输出的简体中文与英文正规化。
- `popup/ai-reply.html`、`popup/ai-reply.js`：独立 AI 回复窗口、完整关闭、复制操作和快捷键。
- `background/video-service.js`：多 Frame 视频控制、脚本注入和播放状态聚合。
- `background/book-service.js`：学习通内嵌图书的多框架扫描、阅读器评分和目标框架锁定。
- `content/book-core-main.js`：在浏览器 MAIN 主环境中预加载；V7 使用真实 frame 列表和动态来源注入定位学习通 PDG/JPath 阅读器，按页类型调用 `goto`，并检查 `#pagejump` 当前选项是否为封底页；无响应时强制切换图片节点并同步页码回调。
- `background/message-schema.js`：消息来源与参数校验。
- `background/message-router.js`：消息分发与统一响应。
- `background/user-script-service.js`：浏览器用户脚本注册和执行；长脚本标识使用哈希后缀，避免截断后发生注册名冲突。
- `popup/popup-utils.js`：弹窗通用格式化和参数规范化。
- `popup/popup-storage.js`：弹窗本地存储访问层。
- `popup/message-client.js`：弹窗后台消息和网站授权客户端。
- `popup/ai-controller.js`：AI 提示词、请求状态和历史记录控制。
- `popup/developer-controller.js`：开发者文档、多草稿管理、声明校验和真实 API 测试。
- `popup/sdk-session-controller.js`：SDK 授权确认、沙箱会话、RPC 转发和停止撤销。
- `popup/index.js`：视频、OCR、设置、脚本和导航界面编排。
- `workspace/index.html`、`workspace/index.js`：隔离运行普通用户脚本界面。
- `content/player-adapters.js`：HTML5 播放器控制能力与 YouTube、Bilibili 站点识别。
- `content/media-core-main.js`：页面主环境强控制核心，负责媒体属性锁、单次 DOM 遍历注册、状态修复和多媒体同步。
- `content/index.js`：页面媒体注册表、增量 DOM 扫描、区域截图和页面文字提取。

媒体层首次加载时建立一次索引，之后只扫描新加入的 DOM 节点和 Shadow Root。持续控制每秒只检查已注册的媒体元素，并每 30 秒进行一次完整性校准。

## 验证

项目不需要构建步骤。修改后执行全部脚本语法检查：

```powershell
$files = rg --files -g '*.js' -g '*.mjs'
foreach ($file in $files) { node --check $file }
```

执行全部自动化测试：

```powershell
$tests = Get-ChildItem tests -Filter '*.test.js' | ForEach-Object { $_.FullName }
node --test $tests
```

安装 Microsoft Edge 和 Playwright 后，可以执行真实扩展端到端测试。脚本会自动查找 Edge 与本机 Codex 运行时中的 Playwright；其他环境可通过 `EDGE_EXECUTABLE_PATH` 和 `WSB_PLAYWRIGHT_MODULE` 指定路径：

```powershell
node tests/edge-extension-e2e.mjs
```

`docs/ocr-runtime-test.html` 用于验证项目内置 Tesseract、WASM 核心和英文语言包能否实际识别测试图片。

`docs/test-video.html`、`docs/test-shadow-video.html` 和 `docs/test-ruffle-detect.html` 分别用于验证标准媒体、Shadow DOM 和特殊播放器识别。

## 注意事项

- 自动翻页使用浏览器 Alarm API，正式环境的最小可靠周期为 30 秒。
- 浏览器内部页面和受保护页面不允许扩展注入脚本或截图。
- 用户脚本具有网页操作能力，只应导入自己信任的脚本。
