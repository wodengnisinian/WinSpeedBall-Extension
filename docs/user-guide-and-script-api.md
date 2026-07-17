# WinSpeedBall 功能、使用与脚本开发说明

适用版本：WinSpeedBall `3.7.0 Developer Beta`

SDK 版本：`3.7.0-beta`

浏览器要求：Microsoft Edge 或 Chromium 135 及以上版本

## 1. 项目说明

WinSpeedBall 是一个在本机浏览器中运行的学习辅助扩展，主要提供视频控制、本地 OCR、AI 学习辅助、图书翻页、用户脚本、Developer SDK、运行日志和本地数据管理。

浏览器主弹窗和独立主窗口当前固定为 `320×340`，AI 回复次窗口固定为 `320×240`。扩展使用按需网站授权，不默认申请所有网站的长期访问权限。

## 2. 安装与首次使用

1. 打开 `edge://extensions/` 或 Chromium 浏览器对应的扩展管理页。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择项目根目录。
4. 首次打开扩展时阅读并确认使用声明。
5. 如果需要普通用户脚本，在扩展详情页开启“允许用户脚本”。
6. 修改项目文件后，需要回到扩展管理页点击“重新加载”，并重新打开扩展弹窗。

项目根目录：

```text
WinSpeedBall-Extension-publish
```

## 3. 功能与使用方式

### 3.1 视频控制

功能：

- 读取播放状态、媒体数量、总时长、当前时间、音量和倍速。
- 设置 `0.25` 至 `16` 倍播放速度。
- 以 `0.25` 为步长增加或降低倍速，也可以恢复为 `1.0` 倍。
- 播放、暂停、设置音量、静音和取消静音。
- 自动播放与持续控制。
- 对 iframe、Shadow DOM、动态播放器和 Video.js 播放器进行识别。
- 对网页反复恢复倍速的情况使用倍速锁和分阶段校正。

使用步骤：

1. 打开包含视频的普通网页。
2. 打开扩展并进入“视频”。
3. 输入倍速后点击“应用”，或使用 `-0.25`、`重置`、`+0.25`。
4. 根据需要点击“播放”“暂停”或开启自动播放。
5. 如果播放器位于跨域 iframe，扩展会申请当前页面和播放器来源的权限。

注意：Canvas、Ruffle、Flash、受保护媒体和浏览器内部页面可能无法直接控制。

### 3.2 问题获取

功能：

- 在网页上拖选区域并截图。
- 使用项目内置 Tesseract 在本机识别中文和英文。
- 复制 OCR 结果、重新识别或发送给 AI。
- 弹窗关闭后，后台 OCR 任务仍可继续运行。

使用步骤：

1. 打开扩展并进入“问题获取”。
2. 点击“框选截图 OCR”，或者按 `Alt+O`。
3. 回到网页，按住鼠标拖选区域。
4. 松开鼠标后等待本地识别完成。
5. 截图预览和 OCR 文字结果合并显示在“框选识别”标签中，不再设置单独的“OCR 结果”标签；可以直接复制、重新识别或发送给 AI。

网页中的题目通过声音播放时，切换到“网页语音”标签：

1. 点击“开始录音”，然后播放当前 Edge 标签页里的题目声音。
2. 播放完后点击“停止识别”；单次录制最长 60 秒，也可以在录制过程中取消。
3. 扩展使用随项目内置的 Whisper Tiny q8 模型在本机转写，不需要麦克风，也不会上传录音。
4. 首次加载约 67 MB 的本地运行库和模型时会稍慢；模型会保留 5 分钟，方便连续识别多道语音题。
5. 转写文字可以复制或手动发送给 AI。原始录音只在内存中临时存在，最终只保存转写文字。

网页语音获取只支持普通网页中实际播放到当前标签页的声音。Edge 内部页面、受保护媒体和浏览器禁止捕获的页面无法使用。
Edge 还要求用户先在目标网页上调用扩展：如果你正在使用固定独立窗口，请切回播放题目语音的网页，点击工具栏中的 WinSpeedBall 图标，再在原生弹窗的“网页语音”中点击“开始录音”。

### 3.3 AI 学习辅助

支持的 Provider：

- `DS`：DeepSeek
- `OAI`：OpenAI
- `CLD`：Claude
- `LM`：本地 OpenAI 兼容模型

四个简称按钮缩小后并排显示在同一行，每个 Provider 分别保存问题草稿、回复和历史记录。

功能：

- 总结页面、解释重点、提取知识点、翻译和自定义提问。
- 读取当前页面正文作为输入。
- OCR 完成后自动发送给 AI。
- 自定义 OCR 提示词，使用 `{{OCR}}` 插入识别文本。
- AI 回复使用独立次窗口，并保存本地历史记录。

配置步骤：

1. 进入“设置 → AI 服务”。
2. 选择 Provider，填写 API Key、Base URL 和 Model。本地模型可以不填 API Key。
3. 先点击“测试”，确认连接成功后再点击“保存”。
4. 需要自动发送 OCR 时，开启“OCR 识别完成后自动发送给 AI”。
5. 回到“AI”页面，可以直接读取页面提问；也可以在 OCR 页面点击“发给 AI”。

API Key 只保存在扩展存储中，不开放给网页脚本或 SDK 脚本。

当前安全限制：

- 单次 AI 请求体最大约 `512 KiB`，响应最多读取 `2 MiB`，请求超过 `45` 秒会超时。
- 云端 Provider 的 Base URL 必须使用 HTTPS；本地模型只允许使用 `localhost`、`127.0.0.1` 或 `[::1]` 的 HTTP/HTTPS 地址。
- Base URL 不能包含用户名、密码、查询参数或片段；请求不携带浏览器登录凭据，也不跟随重定向。

### 3.4 图书翻页

功能：

- 支持学习通 `mooc1.chaoxing.com/mycourse/studentstudy` 课程章节中的 `module="insertbook"` 内嵌图书。
- 精确识别 `ans-insertbook-module` 组件以及最终打开的 `epub.sslibrary.com/epub/reader` 阅读器。
- 支持旧版超星 JPath/Readweb 图片阅读器，识别 `#Readweb`、`.duxiuimg`、`input.Jimg`，并直接调用 `window.readweb.nextPage()` 或 `window.readweb.prevPage()`。
- 扫描课程页面中的多层 iframe，锁定真正的图书阅读器后再执行操作。
- 在 Edge 的 MAIN 主页面环境中加载图书控制核心，优先调用阅读器原生翻页按钮，失败时再使用页面控制器或浏览器原生方向键。
- 自动避开课程正文的“上一节”“下一节”和章节翻页按钮。
- 手动上一页、下一页。
- 按设定间隔自动翻页。
- 学习通版本按 400、300、250、150、50 秒的递减间隔读取 `#pagejump` 当前选中项，检测到“封底页”后自动停止；最后阶段每 50 秒持续检查。
- 学习通界面的封底页检测状态区会显示“待启动、检测中、已到封底”、当前选项和下次检测倒计时。
- 后台任务状态与失败原因写入运行日志。

使用步骤：

1. 在学习通课程章节中展开或打开图书内容，使图书页面显示出来。
2. 打开扩展并进入“图书”，点击“检测图书”。
3. 检测成功后，先测试“上一页”或“下一页”。
4. 普通图书和图片模式的自动翻页间隔设置为 `30` 至 `3600` 秒；学习通版本可设置为 `2` 至 `3600` 秒。
5. 点击“启动自动翻页”；不再需要时点击“停止”。

首次控制时，Edge 可能询问是否允许扩展访问当前学习通页面及图书 iframe 来源。新版阅读器会经过 `resapi.chaoxing.com/realReadNew` 跳转到 `epub.sslibrary.com/epub/reader`；旧版图片阅读器使用 `readsvr.chaoxing.com`、`readsvr1` 至 `readsvr5` 或 `moocreadsvr.chaoxing.com`。只有用户允许后，扩展才能进入跨域阅读器框架。授权后会在页面加载早期预注入 MAIN 主环境控制核心；当前页面已经打开时则自动运行时补注入。扩展先扫描所有可访问框架，再只向评分最高的图书阅读器发送一次翻页指令，不会同时翻动多个图书。

浏览器 Alarm 的最小可靠周期为 30 秒；学习通版本低于 30 秒时使用快速定时器执行翻页，并用 30 秒 Alarm 负责后台唤醒保护。

### 3.5 普通用户脚本

功能：

- 导入本地 `.js` 脚本。
- 按“视频、AI、OCR、图书、脚本、其他”分类显示。
- 手动运行、授权当前网站、启用自动注册、查看运行状态。
- 在兼容工作区显示脚本界面和受控菜单命令。

使用步骤：

1. 在扩展详情页开启“允许用户脚本”。
2. 进入“脚本”，点击 `+` 新建脚本槽位。
3. 选择本地 `.js` 文件。
4. 确认脚本声明的权限。
5. 手动运行时直接点击运行按钮；需要自动运行时，再授权当前网站并启用脚本。

普通用户脚本的具体要求见第 4 节。

### 3.6 Developer Mode 与 SDK

功能：

- 最多保存 20 个 SDK 草稿。
- 新建、复制、导入、导出、校验和删除脚本。
- 实时显示代码行数、字符数、能力数量和草稿保存状态。
- 支持使用 `Ctrl+S` 快速保存当前草稿。
- 显示能力清单和公开方法。
- API 契约测试会实时显示当前方法所需能力。
- 在独立 Sandbox Worker 中执行 SDK 脚本。
- 建立短期授权会话并调用真实 Video、Page、Book、AI、OCR 和 Storage 服务。

使用步骤：

1. 进入“设置 → 高级设置”。
2. 开启 Developer Mode，并确认高级功能提示。
3. 进入“开发者”，新建、复制或导入 SDK 脚本。
4. 点击“校验”，确认能力声明正确。
5. 点击“授权并启动”，检查当前网站和能力范围。
6. 使用保存按钮或 `Ctrl+S` 保存，然后运行脚本或使用 API 契约测试。
7. 完成后停止会话；关闭 Developer Mode 也会撤销会话和运行令牌。

### 3.7 日志中心

运行日志记录视频、图书、OCR、AI、脚本、权限和主要界面操作，支持：

- 搜索
- 级别筛选
- 刷新
- 复制
- JSON 导出
- 清空
- 鼠标、触控板和键盘滚动

“更新日志”用于查看当前版本及本轮制作记录。

### 3.8 本地账户、声明与隐私

- 本地账户只存在于当前浏览器，不是云账户。
- 支持注册、登录、退出、修改显示名称、修改密码和删除账户。
- 使用声明更新后需要重新确认。
- 隐私中心可以分类删除截图、问题获取记录、AI 历史、日志、脚本和账户数据。
- OCR 和 Whisper 语音转写默认完全在本机执行；只有用户主动发送或开启自动发送时，文字才会发送给所选 AI 服务。

### 3.9 独立窗口、捐赠与作者信息

- 顶部固定按钮可以把浏览器弹窗变为持续停留的独立主窗口。
- 浏览器弹窗和独立窗口分别保存页面状态。
- 捐赠页提供微信和支付宝静态收款码；扩展不会读取或验证支付结果。
- 作者页包含作者肆年、问题反馈邮箱、项目由来和协作邀请。

## 4. 普通用户脚本编写要求

普通用户脚本用于直接操作网页 DOM。它运行在浏览器 `USER_SCRIPT` 隔离环境中，不等同于 Developer SDK 脚本。

### 4.1 基础模板

```javascript
// ==UserScript==
// @name 示例网页脚本
// @version 1.0.0
// @property 其他
// @description 示例说明
// @match https://example.com/*
// @permission dom
// @run-at document_idle
// ==/UserScript==

(function () {
  "use strict";
  console.log("脚本已运行");
})();
```

### 4.2 元数据要求

| 字段 | 是否必需 | 说明 |
| --- | --- | --- |
| `@name` | 建议 | 脚本名称，也支持 `@名称` |
| `@version` | 建议 | 脚本版本 |
| `@property` | 必需 | 可用值：`视频`、`AI`、`OCR`、`图书`、`脚本`、`其他`；也支持 `@属性` |
| `@description` | 可选 | 脚本说明 |
| `@match` | 自动运行必需 | 自动运行的网站范围，可以写多行 |
| `@include` | 可选 | 补充包含范围 |
| `@exclude` | 可选 | 排除范围 |
| `@permission` | 必需 | 可以写多行，见下表 |
| `@run-at` | 可选 | `document_start`、`document_end`、`document_idle`；默认 `document_idle` |

### 4.3 普通脚本权限

| 权限 | 用途 |
| --- | --- |
| `dom` | 读取和修改当前网页 DOM |
| `network` | 发起受网页 CORS 和 CSP 规则限制的网络请求，不提供特权跨域绕过 |
| `automation` | 请求扩展已实现的受控自动翻页或下一条桥接 |

要求：

- 至少声明一个 `@permission`。
- 只允许 `dom`、`network`、`automation`。
- 权限声明变化后，必须重新确认。
- 自动运行需要脚本已启用、权限已确认，并且用户已授权对应网站。
- 单个脚本不得超过 `200000` 字符。
- 不要导入来源不明的脚本。

### 4.4 普通脚本读取插件视频状态

普通脚本目前只提供一个有限的 WSB 兼容接口：

```javascript
// ==UserScript==
// @name 读取插件视频状态
// @version 1.0.0
// @property 视频
// @match https://example.com/*
// @permission dom
// @wsb-capability video.read
// ==/UserScript==

(async function () {
  "use strict";
  const status = await WSB.video.status();
  console.log(status.duration, status.currentTime, status.rate);
})();
```

返回对象：

```javascript
{
  ok: true,
  duration: 506,
  currentTime: 98,
  mediaCount: 1,
  paused: false,
  rate: 2,
  durationSource: "media-element",
  playerType: "html5",
  error: ""
}
```

注意：这是普通脚本兼容桥，只开放 `WSB.video.status()`；旧名称 `WSB.video.getStatus()` 继续兼容。完整 WSB API 必须使用 Developer SDK。包含 `@permission` 与 `@wsb-capability video.read` 的普通脚本不能保存为 SDK 草稿。

### 4.5 兼容工作区提供的 GM 接口

兼容工作区提供以下常用接口：

- `GM_addStyle`
- `GM_getValue`、`GM_setValue`、`GM_deleteValue`
- `GM_openInTab`
- `GM_notification`
- `GM_registerMenuCommand`、`GM_unregisterMenuCommand`
- `GM_xmlhttpRequest`
- 对应的部分 `GM.*` Promise 写法

这些接口是兼容层，不代表完整 Tampermonkey API。兼容存储只服务当前工作区运行，不应当代替 Developer SDK 的隔离存储。

## 5. Developer SDK 脚本要求

### 5.1 SDK 脚本模板

```javascript
// ==UserScript==
// @name 视频进度记录
// @version 1.0.0
// @wsb-capability video.read
// @wsb-capability storage
// ==/UserScript==

const video = await WSB.video.current();
if (video) {
  await WSB.storage.set("lastProgress", {
    currentTime: video.currentTime,
    duration: video.duration,
    progress: video.progress
  });
}
```

### 5.2 SDK 能力

| 能力 | 允许访问 |
| --- | --- |
| `video.read` | 视频列表、当前视频和播放状态 |
| `video.control` | 倍速、音量、静音、播放和暂停 |
| `ocr.read` | 最近一次 OCR；交互截图和直接识别目前未接通 |
| `qa.read` | 问题获取中的最新 OCR、网页语音及聚合结果 |
| `ai.read` | 已保存的最新 AI 回复和历史回复；不包含 API Key |
| `ai.request` | AI 提问、总结和翻译 |
| `page.read` | 页面信息、标题、URL 和正文 |
| `book.read` | 只读访问已绑定当前网页中的图书状态、当前选项和封底检测状态 |
| `storage` | 当前脚本独立的本地存储空间 |

### 5.3 SDK 规则与限制

- 至少声明一个有效的 `@wsb-capability`。
- 不允许未知能力。
- SDK 脚本不能包含旧 `@permission`，两种模式不能混用。
- 草稿编辑器实际限制为 `200000` 字符，最多保存 20 个草稿。
- 脚本在独立 Worker 中运行，支持顶层 `await`。
- 默认执行超时为 5 秒，运行器允许的范围为 100 毫秒至 30 秒。
- 脚本返回结果必须可序列化，并且不超过 64 KiB。
- 单次 RPC 最多 16 个参数，序列化后不超过 64 KiB。
- 默认运行令牌有效期为 5 分钟，最长 10 分钟。
- 授权绑定脚本代码摘要、能力、当前网站来源和 SDK 版本；代码或能力变化后需要重新授权。

SDK Worker 不开放：

- `window`、`document`、`parent`、`top`
- `chrome`、`browser`
- `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`
- `Worker`、`SharedWorker`、`importScripts`
- `indexedDB`、`caches`
- `Function`、`eval`

因此，SDK 脚本不能直接操作网页 DOM，也不能自行联网；所有能力必须通过冻结的 `WSB` 对象调用。

### 5.4 SDK Storage 配额

- 每个脚本最多 100 个键。
- 键名只允许 `A-Z`、`a-z`、`0-9`、点、下划线和短横线，长度 1 至 128。
- 单值最大 64 KiB。
- 单个高级 SDK 脚本的隔离存储总容量最大 5 MiB。
- 值必须可以被 JSON 序列化。

## 6. WSB 公开接口

SDK 中的 `WSB`、各分组和方法均被冻结。方法返回 Promise；成功时直接得到下表中的返回值，失败时抛出带 `code` 的 Error。

推荐使用精简名称。旧版 `getAll/getStatus/setRate/setVolume` 仍可调用，便于现有脚本平滑升级。

旧接口迁移对照：

| 旧名称（兼容） | 推荐名称 |
| --- | --- |
| `WSB.video.getAll()` | `WSB.video.all()` |
| `WSB.video.getStatus()` | `WSB.video.status()` |
| `WSB.video.setRate(rate)` | `WSB.video.rate(rate)` |
| `WSB.video.setVolume(volume)` | `WSB.video.volume(volume)` |
| `WSB.book.getStatus()` | `WSB.book.status()` |

旧名称和推荐名称行为相同。新脚本应使用推荐名称，旧脚本可以继续运行并逐步迁移。

### 6.1 `WSB.video`

需要能力：读取使用 `video.read`，控制使用 `video.control`。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.video.all()` | 无 | `Video[]`，所有已发现媒体 |
| `WSB.video.current()` | 无 | 当前优先媒体 `Video`，没有时为 `null` |
| `WSB.video.status()` | 无 | 当前聚合状态 `VideoStatus` |
| `WSB.video.rate(rate)` | `rate`：`0.25` 至 `16` | 应用后的 `VideoStatus` |
| `WSB.video.volume(volume)` | `volume`：`0` 至 `1` | 应用后的 `VideoStatus` |
| `WSB.video.mute(muted = true)` | 布尔值 | 应用后的 `VideoStatus` |
| `WSB.video.play()` | 无 | 播放后的 `VideoStatus` |
| `WSB.video.pause()` | 无 | 暂停后的 `VideoStatus` |

`Video` 模型：

```javascript
{
  id: "媒体标识",
  frameId: 0,
  title: "媒体标题",
  duration: 506,
  currentTime: 98,
  progress: 0.1936,
  rate: 2,
  volume: 0.8,
  muted: false,
  paused: false,
  mediaType: "video",
  controlMode: "locked"
}
```

`VideoStatus` 在 `Video` 基础上补充聚合字段：

```javascript
{
  mediaCount: 6,
  frameCount: 2,
  duration: 506,
  currentTime: 98,
  remainingTime: 408,
  playing: true,
  playbackState: "playing",
  targetRate: 2,
  rateLocked: true,
  rateStable: true,
  autoplay: false,
  keepPlaying: true,
  playerType: "HTML5 强控制"
}
```

界面字段对应关系：倍速为 `rate`，播放状态为 `playbackState`，音量为 `volume`，媒体数量为 `mediaCount`，总时长为 `duration`，已播放为 `currentTime`，自动播放为 `autoplay`，倍速锁为 `rateLocked`。

### 6.2 `WSB.ocr`

需要能力：`ocr.read`。

| 方法 | 参数 | 返回值 | 当前状态 |
| --- | --- | --- | --- |
| `WSB.ocr.latest()` | 无 | `{ text, time, confidence }` | 可用 |
| `WSB.ocr.capture()` | 无 | 预留 | 未接通，返回 `SDK_DEPENDENCY_NOT_READY` |
| `WSB.ocr.recognize(input)` | `{ dataUrl, language? }` | 预留 | 未接通，返回 `SDK_DEPENDENCY_NOT_READY` |

`dataUrl` 只允许 PNG、JPEG 或 WebP Base64 图片，最大 16 MiB；`language` 最长 64 个字符。

### 6.3 `WSB.qa`

需要能力：`qa.read`。只读取扩展已经获取并保存在本地的问题文字，不会主动截图、录音或发送 AI。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.qa.latest()` | 无 | OCR 与网页语音中时间最新的 `Question`；没有记录时返回空状态对象 |
| `WSB.qa.ocr()` | 无 | 最新 OCR `Question` |
| `WSB.qa.voice()` | 无 | 最新网页语音 `Question` |

`Question` 模型：

```javascript
{
  source: "ocr", // 或 voice
  text: "获取到的问题文字",
  status: "completed",
  progress: 1,
  time: "2026-07-17T08:00:00.000Z",
  durationMs: 0,
  error: ""
}
```

接口不会返回 OCR 截图原图、标签页编号或语音原始录音。

### 6.4 `WSB.ai`

读取回复使用 `ai.read`，发送请求使用 `ai.request`。两个能力需要分别确认。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.ai.latest()` | 无 | 最新 `AiRecord`，没有记录时为 `null` |
| `WSB.ai.history(limit = 10)` | `limit`：`1` 至 `20` | 按时间倒序排列的 `AiRecord[]` |
| `WSB.ai.ask(prompt)` | 非空文本，最大 50000 字符 | `{ content, model }` |
| `WSB.ai.summary(sourceText)` | 非空文本，最大 50000 字符 | `{ content, model }` |
| `WSB.ai.translate(sourceText, targetLanguage)` | 文本最大 50000 字符；目标语言最大 64 字符 | `{ content, model }` |

AI 调用使用用户在设置中选择的 Provider。脚本无法读取 API Key。

`AiRecord` 包含 `provider`、`model`、`mode`、`question`、`answer`、`time`、`source` 和 `truncated`。`ai.latest()` 最多返回 2 MiB 答案；`ai.history()` 中每条答案最多返回 200000 字符，超过时 `truncated` 为 `true`。接口不返回 API Key、Base URL 或浏览器凭据。

### 6.5 `WSB.page`

需要能力：`page.read`。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.page.info()` | 无 | `{ title, url, language }` |
| `WSB.page.text()` | 无 | 页面正文字符串 |
| `WSB.page.title()` | 无 | 页面标题字符串 |
| `WSB.page.url()` | 无 | 页面 URL 字符串 |

`page.read` 会读取网页内容。只在用户明确确认当前来源和能力后使用。

### 6.6 `WSB.book`

需要能力：`book.read`。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.book.status()` | 无 | 当前网页的 `BookStatus` |

`book.read` 是只读能力，必须授权并绑定当前网页。它不会执行翻页、修改阅读器或向脚本暴露网页 DOM；授权后如果网页来源发生变化，调用会失败并要求重新授权。

`BookStatus` 模型：

```javascript
{
  mode: "chaoxing",
  detected: true,
  reader: "chaoxing-pdg",
  page: "362",
  pageType: "5",
  pageTypeLabel: "正文页",
  currentOption: {
    detected: true,
    value: "5",
    label: "正文362页"
  },
  isBackCover: false,
  running: true,
  intervalSeconds: 2,
  monitor: {
    enabled: true,
    reached: false,
    checkIndex: 1,
    nextCheckAt: "2026-07-17T08:00:00.000Z",
    nextCheckSeconds: 299,
    sequenceSeconds: [400, 300, 250, 150, 50]
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `string` | 当前公开图书模式；本接口返回 `chaoxing` |
| `detected` | `boolean` | 当前绑定网页中是否检测到可读取的学习通图书 |
| `reader` | `string` | 已检测阅读器类型；未检测到时为空字符串 |
| `page` | `string` | 阅读器报告的当前页码；未知时为空字符串 |
| `pageType` | `string` | JPath 当前页面类型编号 |
| `pageTypeLabel` | `string` | 页面类型中文名称，例如“正文页”或“封底页” |
| `currentOption.detected` | `boolean` | 是否检测到 `#pagejump` 当前选项 |
| `currentOption.value` | `string` | 当前选中 `option` 的 `value` |
| `currentOption.label` | `string` | 当前选项显示文字，例如“正文362页”或“封底页” |
| `isBackCover` | `boolean` | 本次实时读取是否已处于封底页 |
| `running` | `boolean` | 当前绑定网页是否正在运行学习通自动翻阅 |
| `intervalSeconds` | `number` | 当前自动翻阅间隔；未运行时为 `0` |
| `monitor.enabled` | `boolean` | 封底页定时检测是否启用 |
| `monitor.reached` | `boolean` | 后台检测任务是否已经确认到达封底页 |
| `monitor.checkIndex` | `number` | 当前检测间隔在递减序列中的索引 |
| `monitor.nextCheckAt` | `string` | 下次检测的 ISO 8601 时间；没有待检测任务时为空字符串 |
| `monitor.nextCheckSeconds` | `number` | 距离下次检测的剩余秒数 |
| `monitor.sequenceSeconds` | `number[]` | 封底页检测间隔序列，当前为 `[400, 300, 250, 150, 50]` |

`currentOption` 对应学习通阅读器 `#pagejump` 当前选中的一项；没有检测到该控件时，`detected` 为 `false`，`value` 和 `label` 为空字符串。`monitor.nextCheckAt` 使用 ISO 8601 时间，没有待执行检测时为空字符串。

### 6.7 `WSB.storage`

需要能力：`storage`。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.storage.get(key)` | 合法键名 | 已保存的值；不存在时为 `null` |
| `WSB.storage.set(key, value)` | 键名和可 JSON 序列化值 | `{ key, bytesUsed }` |

### 6.8 `WSB.event`

公开形式：

```javascript
const unsubscribe = WSB.event.on("video.finish", function (payload) {
  console.log(payload);
});

unsubscribe();
```

登记事件与能力：

| 事件 | 所需能力 |
| --- | --- |
| `video.play` | `video.read` |
| `video.pause` | `video.read` |
| `video.finish` | `video.read` |
| `ocr.complete` | `ocr.read` |
| `ai.complete` | `ai.request` |
| `page.change` | `page.read` |

当前实时事件传输尚未接通。`WSB.event.on` 属于预留契约，不能作为当前版本的可靠业务触发器。

## 7. SDK 示例

### 7.1 设置倍速并开始播放

```javascript
// ==UserScript==
// @name 设置两倍速并播放
// @version 1.0.0
// @wsb-capability video.control
// ==/UserScript==

await WSB.video.rate(2);
await WSB.video.play();
```

### 7.2 读取页面并请求 AI 总结

```javascript
// ==UserScript==
// @name 页面总结
// @version 1.0.0
// @wsb-capability page.read
// @wsb-capability ai.request
// ==/UserScript==

const pageText = await WSB.page.text();
const result = await WSB.ai.summary(pageText.slice(0, 50000));
console.log(result.content);
```

### 7.3 保存视频进度

```javascript
// ==UserScript==
// @name 保存视频进度
// @version 1.0.0
// @wsb-capability video.read
// @wsb-capability storage
// ==/UserScript==

const current = await WSB.video.current();
if (current) {
  await WSB.storage.set("progress", {
    currentTime: current.currentTime,
    duration: current.duration,
    savedAt: new Date().toISOString()
  });
}
```

### 7.4 判断学习通图书是否到达封底

```javascript
// ==UserScript==
// @name 检查学习通图书封底
// @version 1.0.0
// @wsb-capability book.read
// ==/UserScript==

const status = await WSB.book.status();
const optionLabel = status.currentOption.label.trim();
const reachedBackCover = status.isBackCover || optionLabel === "封底页";

if (reachedBackCover) {
  console.log("图书已经到达封底页");
} else {
  console.log("当前选项：", optionLabel || "未检测到");
}
```

### 7.5 读取最新问题和 AI 答案

```javascript
// ==UserScript==
// @name 读取最新问答
// @version 1.0.0
// @wsb-capability qa.read
// @wsb-capability ai.read
// ==/UserScript==

const question = await WSB.qa.latest();
const aiRecord = await WSB.ai.latest();

console.log("问题来源：", question.source);
console.log("问题：", question.text);
console.log("AI 答案：", aiRecord ? aiRecord.answer : "暂无答案");
```

## 8. 常见错误

| 错误码 | 含义 |
| --- | --- |
| `SDK_CAPABILITY_REQUIRED` | 未声明或未授权所需能力 |
| `SDK_CAPABILITY_UNKNOWN` | 声明了不存在的能力 |
| `SDK_METADATA_CONFLICT` | 混用了 `@permission` 和 `@wsb-capability` |
| `SDK_INVALID_ARGUMENT` | 参数类型、数量或范围错误 |
| `SDK_METHOD_NOT_ALLOWED` | 方法不存在或不允许调用 |
| `SDK_TAB_REQUIRED` | 当前接口需要已授权且仍然打开的网页标签页 |
| `SDK_BOOK_FAILED` | 图书阅读器状态读取失败 |
| `SDK_QA_READ_FAILED` | OCR 或网页语音问题读取失败 |
| `SDK_AI_READ_FAILED` | 最新 AI 回复或历史读取失败 |
| `SDK_PAYLOAD_TOO_LARGE` | 参数或结果超过大小限制 |
| `SDK_CONTEXT_CHANGED` | 授权后页面来源发生变化 |
| `SDK_TOKEN_EXPIRED` | 运行令牌已过期 |
| `SDK_QUOTA_EXCEEDED` | Storage 超过键数量或容量限制 |
| `SDK_DEPENDENCY_NOT_READY` | 接口已登记，但当前版本尚未接通 |
| `FEATURE_NOT_AVAILABLE` | 对应功能当前不可用 |

## 9. 使用边界

- 只在用户有权访问、处理和自动化的页面上使用。
- 不得用于考试作弊、伪造学习记录、绕过付费或访问控制、恶意自动化或侵犯隐私。
- 网站结构、播放器实现和平台规则变化后，脚本可能需要同步调整。
- 自动化脚本应设置停止条件、错误处理和合理间隔，避免无限循环点击。
- 对于视频、书本、测验混合课程，自动下一节脚本必须先判断章节类型，避免跳过非视频内容。

完整使用声明见 `docs/usage-declaration.md`，隐私说明见 `PRIVACY.md`。
