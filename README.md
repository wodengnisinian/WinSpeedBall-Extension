# WinSpeedBall Extension

WinSpeedBall 是面向 Microsoft Edge 和 Chromium 浏览器的本地学习辅助扩展，提供视频控制、文字问题 OCR、网页语音转写、AI答题、AI教学、图书翻阅和受限用户脚本能力。

当前发布版本：WinSpeedBall `3.8.5 Developer Beta`

内置 SDK 版本：`3.7.0-beta`

浏览器要求：Microsoft Edge 或 Chromium 135 及以上版本

如有 Bug、使用问题或项目协作意向，可联系作者：

- Email：`zbdwxb57531@qq.com`
- GitHub：[`wodengnisinian/WinSpeedBall-Extension`](https://github.com/wodengnisinian/WinSpeedBall-Extension)

## 3.8.5 主要更新

- Developer SDK 的运行令牌、授权会话和沙箱脚本不再按固定时间到期，适合用户持续调用视频、图书及其他已授权接口。
- 长期会话仍绑定脚本代码、能力、当前网站、标签页和图书模式；用户停止会话、替换或删除脚本、关闭 Developer Mode、撤销授权或浏览器会话结束时会清理。
- 升级时清理旧版带到期时间的令牌与会话，防止已经过期的旧记录被恢复成长期授权。
- 视频接口补齐读取、播放、暂停、倍速、音量、静音、自动播放、倍速锁和重置。
- 图书接口补齐状态、前后翻阅、自动翻阅、停止和间隔调整，并严格隔离普通图书、图片序列和学习通图像书。
- AI教学改为独立的大尺寸教学界面，以公式、原题条件、提问和不同数据例题逐步引导。
- AI答题优先遵守用户对直接答案、格式和字数的要求。
- LaTeX 公式使用内置 MathJax 渲染为本地 SVG，放大、加粗并支持长公式换行。
- OCR 加强浅灰色选项文字，减少 A、B、C、D 选项遗漏。
- 主界面、AI教学、AI回复和脚本工作区统一为白底、黑字、灰色提示和淡蓝色交互色。
- 隐藏可见滚动条但保留滚轮、触控板、触摸、键盘翻页、阅读进度、位置记忆和回顶功能。
- 完成 Developer SDK、消息协议、跨页面注入、图书任务、窗口状态、AI、OCR、权限和发布一致性审查；补强长期会话撤销栅栏与失败重试、`documentId` 页面绑定、Sonnet 5 教学兼容、多脚本存储配额，并加入 SDK 沙箱联网封锁、原生心跳看门狗及 RPC 并发与速率保护。

完整逐项记录见 [`CHANGELOG.md`](CHANGELOG.md)。

## 主要功能

### 视频

- 自动发现当前标签页及多层 Frame 中的 HTML5 媒体。
- 设置 `0.25` 至 `16` 倍速、音量和静音状态。
- 播放、暂停、自动播放、倍速锁和一键恢复默认状态。
- 显示媒体数量、总时长、当前进度、播放状态和控制状态。

### 文字问题与语音问题

- 在网页中框选题目区域，通过内置 Tesseract 在本机进行 OCR。
- 对浅灰色选项文字进行图像增强，尽量保留 A、B、C、D 等选项。
- 获取用户主动选择的当前 Edge 标签页声音。
- 使用内置 Whisper Tiny q8 在本机转写，不读取麦克风。
- 文字问题和语音问题分别记住上次打开状态。

### AI答题

- 支持 DeepSeek、OpenAI、Claude 和本地 OpenAI 兼容模型。
- 四个服务分别保存问题草稿、回复和历史记录。
- 直接问题默认返回简洁答案；用户明确要求解析、格式、字数或范围时优先遵守。
- AI 回复使用独立窗口，支持复制、长内容滚动和阅读进度。
- LaTeX、Markdown、JSON、表格、上下标和常见数学符号不会被普通文本清理误删。

### AI教学

- 点击顶部“AI教学”进入独立 `720×600` 教学工作区，其他界面仍保持 `320×340`。
- 面向理科题优先指出公式、定理或规律，再对应原题条件逐步解析。
- 使用提问与不同数据例题引导，不直接用例题替用户完成原题。
- 支持检查当前回答、细化步骤、继续下一步和恢复本地教学进度。
- 教学步骤支持平滑滚动、键盘翻页、阅读进度、位置记忆和回顶。

### 图书

- “图书自动翻阅”只处理普通网页图书阅读器，使用浏览器原生按钮。
- “图片自动翻阅”只处理普通网页图片序列，使用浏览器原生滚动。
- “学习通版本”单独处理学习通 PDG/JPath 图像书，使用专用 `readweb.goto` 和 JPath 页面切换机制。
- 支持学习通课程 `insertbook`、SSLibrary EPUB、旧版 Readweb 和多层 iframe。
- 学习通模式支持书名页、目录页、正文页和封底页，并按递减间隔检查封底。

### 本地账户、窗口与日志

- 支持本地注册、登录、退出、资料修改、密码修改和账户删除，不连接项目自建账户服务器。
- 密码使用随机盐和 PBKDF2-SHA-256 摘要保存，不保存明文。
- 浏览器弹窗可以固定为独立小窗口，并记住普通界面或 AI教学界面及各功能页状态。
- 日志中心提供运行日志、搜索、级别筛选、复制、导出、清空和插件内更新日志。
- 隐私中心按截图、问题、AI、日志、脚本和账户分类统计与清理本地数据。

### 本地脚本与 Developer Mode

- 普通用户脚本使用浏览器官方 `chrome.userScripts` 环境。
- Developer SDK 使用独立 Worker、私有 MessagePort、能力声明、用户确认和隔离存储。
- SDK 脚本不能直接访问网页 DOM、浏览器扩展 API、网络 API、API Key 或登录凭据。
- 扩展通过 `unlimitedStorage` 移除浏览器对扩展本地存储的固定总配额；单个 SDK 脚本仍最多保存 5 MiB 隔离数据，单值最多 64 KiB，最多 100 个键。
- 最多保存 20 个 SDK 草稿，支持复制、导入、导出、校验、`Ctrl+S` 保存和真实 API 测试。

## 安装

本项目不需要构建，可以直接作为解压缩扩展加载：

1. 下载或克隆本仓库。
2. 打开 `edge://extensions/`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择包含 `manifest.json` 的项目目录。
6. 项目文件更新后，在扩展管理页点击“重新加载”。

Chromium 浏览器可在对应的扩展管理页使用相同方式安装。

## 基本使用

### 视频控制

1. 打开需要控制的视频网页。
2. 点击浏览器工具栏中的 WinSpeedBall 图标。
3. 在“视频”页面点击检测或读取状态。
4. 设置倍速、音量、自动播放或倍速锁。

### 文字问题

1. 打开“问题获取 → 文字问题”。
2. 点击框选按钮。
3. 回到网页拖动选择题目区域。
4. 等待本地 OCR 完成。
5. 复制识别结果，或按设置发送给 AI。

### 语音问题

1. 切换到正在播放题目声音的网页。
2. 从该网页点击浏览器工具栏中的 WinSpeedBall 图标。
3. 打开“问题获取 → 语音问题”并点击“开始录音”。
4. 播放完题目后点击“停止识别”。

Edge 只允许从当前网页打开的原生插件弹窗获取标签页声音。固定独立窗口会提示用户回到目标网页重新打开插件。

### 图书翻阅

1. 普通网页图书选择“图书自动翻阅”。
2. 普通网页图片序列选择“图片自动翻阅”。
3. 学习通 PDG/JPath 图像书选择“学习通版本”。
4. 首次控制跨域阅读器时，按浏览器提示确认当前网页和阅读器来源权限。

普通图书和图片模式不会识别学习通阅读器，也不会申请学习通框架权限。

## Developer SDK

### 长期会话规则

Developer SDK 的运行令牌、授权会话和脚本 Worker 默认没有固定到期时间。用户可在会话保持打开时持续调用已确认的接口。

以下操作仍会结束或撤销会话：

- 点击“停止会话”。
- 关闭承载当前 Developer 会话的插件窗口。
- 使用同一草稿重新创建会话。
- 修改能力或代码后重新授权。
- 删除脚本或清理脚本数据。
- 关闭 Developer Mode。
- 撤销当前网站权限。
- 当前标签页关闭或跳转到其他来源。
- 浏览器会话结束。

一次性页面确认仍保留短期安全有效期，只用于防止用户确认期间网页、能力或图书模式发生变化。AI 等外部请求仍保留单次请求超时和响应大小限制，避免异常网络请求长期占用资源。

旧版带 `expiresAt` 的运行记录不会迁移为长期授权；升级后需要重新启动对应 SDK 会话。

### 能力声明

| 能力 | 允许访问的内容 |
| --- | --- |
| `video.read` | 视频列表、当前视频和完整播放状态 |
| `video.control` | 倍速、音量、静音、播放、暂停、自动播放、倍速锁和状态重置 |
| `ocr.read` | 最近一次 OCR 结果和 OCR 预留接口 |
| `qa.read` | 最新文字问题、语音问题和聚合问题 |
| `ai.read` | 本地保存的最新 AI 回复和历史回复 |
| `ai.request` | 向用户当前配置的 AI 服务提问、总结和翻译 |
| `page.read` | 当前授权页面的标题、URL、语言和正文 |
| `book.read` | 当前已授权图书模式的受限状态 |
| `book.control` | 当前已授权图书模式的翻阅和自动任务 |
| `storage` | 当前脚本独立的本地键值存储 |

能力必须写在脚本头部，并由用户确认：

```javascript
// ==UserScript==
// @name 视频状态示例
// @version 1.0.0
// @wsb-capability video.read
// ==/UserScript==

const status = await WSB.video.status();
console.log(status);
```

能力、代码、网站或 SDK 版本变化后需要重新确认。新 SDK 脚本不能同时使用旧版 `@permission`。

### 公开接口

| 分组 | 公开方法 | 所需能力 | 说明 |
| --- | --- | --- | --- |
| Video | `WSB.video.all()` | `video.read` | 返回全部已发现媒体 |
| Video | `WSB.video.current()` | `video.read` | 返回当前优先媒体，没有时为 `null` |
| Video | `WSB.video.status()` | `video.read` | 返回聚合视频状态 |
| Video | `WSB.video.rate(rate)` | `video.control` | 设置倍速并开启倍速锁 |
| Video | `WSB.video.volume(volume)` | `video.control` | 设置 `0` 至 `1` 音量 |
| Video | `WSB.video.mute(muted = true)` | `video.control` | 静音或取消静音 |
| Video | `WSB.video.play()` | `video.control` | 播放当前优先媒体 |
| Video | `WSB.video.pause()` | `video.control` | 暂停当前优先媒体 |
| Video | `WSB.video.auto(enabled = true)` | `video.control` | 开启或关闭自动播放 |
| Video | `WSB.video.lock(enabled = true)` | `video.control` | 开启或关闭倍速锁 |
| Video | `WSB.video.reset()` | `video.control` | 恢复默认视频状态 |
| OCR | `WSB.ocr.latest()` | `ocr.read` | 返回最近一次 OCR 结果 |
| OCR | `WSB.ocr.capture()` | `ocr.read` | 预留接口，当前返回 `SDK_DEPENDENCY_NOT_READY` |
| OCR | `WSB.ocr.recognize(input)` | `ocr.read` | 预留接口，当前返回 `SDK_DEPENDENCY_NOT_READY` |
| Question | `WSB.qa.latest()` | `qa.read` | 返回时间最新的问题 |
| Question | `WSB.qa.ocr()` | `qa.read` | 返回最新文字问题 |
| Question | `WSB.qa.voice()` | `qa.read` | 返回最新语音问题 |
| AI | `WSB.ai.latest()` | `ai.read` | 返回最新 AI 回复 |
| AI | `WSB.ai.history(limit = 10)` | `ai.read` | 返回 `1` 至 `20` 条历史回复 |
| AI | `WSB.ai.ask(prompt)` | `ai.request` | 使用当前 AI 服务提问 |
| AI | `WSB.ai.summary(sourceText)` | `ai.request` | 总结指定文字 |
| AI | `WSB.ai.translate(sourceText, targetLanguage)` | `ai.request` | 翻译指定文字 |
| Page | `WSB.page.info()` | `page.read` | 返回标题、URL 和语言 |
| Page | `WSB.page.text()` | `page.read` | 返回页面正文 |
| Page | `WSB.page.title()` | `page.read` | 返回页面标题 |
| Page | `WSB.page.url()` | `page.read` | 返回页面 URL |
| Book | `WSB.book.status(mode?)` | `book.read` | 返回当前授权模式状态 |
| Book | `WSB.book.prev(mode?)` | `book.control` | 翻到上一页或上一张 |
| Book | `WSB.book.next(mode?)` | `book.control` | 翻到下一页或下一张 |
| Book | `WSB.book.start(options?)` | `book.control` | 启动自动翻阅 |
| Book | `WSB.book.stop()` | `book.control` | 停止当前脚本的自动翻阅 |
| Book | `WSB.book.interval(seconds, mode?)` | `book.control` | 修改自动翻阅间隔 |
| Event | `WSB.event.on(eventName, callback)` | 按事件决定 | 预留事件契约，当前未接通实时事件 |
| Storage | `WSB.storage.get(key)` | `storage` | 读取当前脚本的隔离数据 |
| Storage | `WSB.storage.set(key, value)` | `storage` | 保存当前脚本的隔离数据 |

全部推荐公开方法名均不超过 13 个字符。旧名称 `video.getAll/getStatus/setRate/setVolume` 与 `book.getStatus/turnPrev/turnNext/startAuto/stopAuto/setInterval` 继续映射到相同实现。

除返回取消订阅函数的预留接口 `WSB.event.on()` 外，公开业务方法均返回 Promise。建议统一使用 `await` 和 `try...catch`：

```javascript
try {
  const video = await WSB.video.status();
  console.log("媒体数量：", video.mediaCount);
} catch (error) {
  console.error(error.code, error.message);
}
```

### 视频脚本示例

```javascript
// ==UserScript==
// @name 两倍速持续播放
// @version 1.0.0
// @wsb-capability video.control
// ==/UserScript==

await WSB.video.rate(2);
await WSB.video.auto(true);
await WSB.video.play();
```

`WSB.video.rate()` 会同时开启倍速锁。只关闭倍速锁时调用 `WSB.video.lock(false)`；恢复默认状态时调用 `WSB.video.reset()`。

### 图书脚本示例

启动普通网页图书自动翻阅：

```javascript
// ==UserScript==
// @name 普通图书自动翻阅
// @version 1.0.0
// @wsb-capability book.read
// @wsb-capability book.control
// ==/UserScript==

const status = await WSB.book.status("book");
if (!status.detected) {
  throw new Error("未检测到普通网页图书阅读器");
}

await WSB.book.start({
  mode: "book",
  intervalSeconds: 30
});
```

图书模式：

| 模式 | 内容 | SDK 间隔 |
| --- | --- | --- |
| `"book"` | 普通网页图书阅读器 | `30` 至 `240` 秒 |
| `"image"` | 普通网页图片序列 | `30` 至 `240` 秒 |
| `"chaoxing"` | 学习通 PDG/JPath 图像书 | `2` 至 `240` 秒 |

学习通 `2` 至 `29` 秒属于浏览器后台快速定时。浏览器休眠、节能或冻结页面时可能延迟，扩展会通过 30 秒 Alarm 进行唤醒恢复；需要稳定快速翻阅时应保持阅读器标签页和浏览器处于活动状态。

启动含图书能力的会话前，需要在“SDK 运行会话”中选择唯一图书授权模式。无参方法使用本次会话模式，显式传入其他模式会返回 `BOOK_MODE_NOT_AUTHORIZED`。

同一时间只允许一个图书自动翻阅任务。停止会话、替换脚本、删除脚本、关闭 Developer Mode 或撤销授权时，插件会停止对应任务。

完整参数、返回字段、错误码和更多脚本示例见 [`docs/user-guide-and-script-api.md`](docs/user-guide-and-script-api.md)。

## 普通用户脚本

普通用户脚本通过浏览器官方 `chrome.userScripts` 环境运行。扩展详情页需要开启“允许用户脚本”。

示例：

```javascript
// ==UserScript==
// @name Example
// @property 其他
// @match https://example.com/*
// @permission dom
// ==/UserScript==
```

当前兼容层支持：

- `dom`：所有普通用户脚本必需的基础权限，用于读取和修改已匹配页面的 DOM。
- `network`：在 `dom` 基础上按需叠加，允许 `fetch`、XHR、WebSocket 等主动联网；未声明时，插件会在按脚本代码与有效权限边界分离的 `USER_SCRIPT worldId` 和兼容工作区中设置 `connect-src 'none'`。
- `automation`：在 `dom` 基础上按需叠加，仅解锁兼容工作区的受控自动翻页或下一条桥接；不会同时开放联网能力或普通脚本消息 API。

浏览器的 `USER_SCRIPT` 环境只要注入网页就天然可以访问 DOM，因此不接受只有 `network` 或只有 `automation` 的脚本。`network` 只是对脚本直接调用主动网络 API 的防护，不承诺阻止脚本通过 DOM 创建图片、链接、表单等页面资源、触发导航，或向网页主环境注入代码后联网。普通脚本仍属于可信代码兼容层，不是 Developer SDK 级强沙箱；只应运行自己编写或已经完整审查的脚本。

## 数据与隐私

- 本地账户、设置、日志、截图、OCR 结果、语音转写、AI 草稿、回复和历史默认保存在当前浏览器。
- Tesseract OCR 在本机运行，不因识别自动上传截图。
- Whisper 在本机运行，原始标签页录音只在内存中处理，完成或取消后释放。
- 只有用户主动发送、开启自动发送或开始 AI教学时，对应文字才会发送到用户选择的 AI 服务。
- API Key 只保存在受信任扩展存储中，不向网页、普通日志或 SDK 脚本开放。
- 云端 AI 服务必须使用 HTTPS；本地模型只允许 `localhost`、`127.0.0.1` 或 `[::1]`。
- 用户可以在插件隐私页面查看数据摘要并按分类清理。

完整说明见：

- [`PRIVACY.md`](PRIVACY.md)
- [`docs/usage-declaration.md`](docs/usage-declaration.md)

## 权限说明

- `activeTab` 与 `scripting`：在用户当前打开并授权的网页中检测和控制内容。
- `storage`：保存本地设置、状态、日志、脚本和识别结果。
- `unlimitedStorage`：移除扩展本地存储的固定总配额，使多个 SDK 脚本可以分别使用声明的隔离存储；不会授予任意磁盘文件读取能力。
- `alarms`：维持自动翻阅、任务清理和模型回收。
- `offscreen`：在后台运行本地 OCR。
- `tabCapture`：仅在用户主动开始语音问题后获取当前标签页声音。
- `userScripts`：运行用户导入并授权的普通脚本。
- `webNavigation`：识别受控页面和阅读器 Frame 生命周期。
- 可选网站权限：只在用户启动需要网页持续访问的功能时按来源申请。

扩展不会默认申请读取和修改所有网站。

## 文档

- [`docs/user-guide-and-script-api.md`](docs/user-guide-and-script-api.md)：完整功能、参数、返回模型、错误码和脚本示例
- [`CHANGELOG.md`](CHANGELOG.md)：版本更新与优化记录
- [`PRIVACY.md`](PRIVACY.md)：数据保存、发送、清理与安全说明
- [`docs/usage-declaration.md`](docs/usage-declaration.md)：允许用途、禁止用途和责任边界
- [`docs/ocr-runtime-test.html`](docs/ocr-runtime-test.html)：本地 OCR 运行时检查页

## 项目结构

```text
assets/       图标和捐赠资源
background/   Service Worker、权限、AI、OCR、语音、视频、图书和 SDK 服务
content/      注入网页的媒体、图书和区域截图控制
docs/         使用说明和人工测试页
ocr/          本地 OCR 引擎与离屏页面
popup/        插件主界面、AI答题、AI教学、日志和窗口控制
sdk/          Developer SDK 契约、沙箱、Worker 和公开接口
shared/       文本、公式和滚动等共享模块
tests/        Node 自动化测试与 Edge 端到端测试
vendor/       Tesseract、Whisper、OpenCC 和 MathJax 本地依赖
voice/        网页语音处理和本地 Whisper Worker
workspace/    普通用户脚本隔离工作区
```

## 开发与验证

项目不需要构建步骤。

检查 JavaScript 语法：

```powershell
$files = rg --files -g '*.js' -g '*.mjs'
foreach ($file in $files) {
  node --check $file
}
```

运行全部 Node 测试：

```powershell
node --test
```

运行真实 Edge 扩展端到端测试：

```powershell
node tests/edge-extension-e2e.mjs
```

其他环境可以通过 `EDGE_EXECUTABLE_PATH` 和 `WSB_PLAYWRIGHT_MODULE` 指定 Edge 与 Playwright 路径。

## 使用边界

- 仅在用户有权访问、处理和控制的内容中使用本扩展。
- 不得用于考试作弊、代答代交、伪造学习记录、绕过访问控制或其他违法违规行为。
- 自动化脚本应设置合理频率和明确停止条件。
- 浏览器内部页面和受保护页面不允许扩展注入脚本或截图。
- 第三方网页结构、播放器、AI 服务和浏览器策略变化可能影响功能。
- 项目按现状提供，使用者需要自行核对目标网站规则、课程纪律和适用法律。
