# WinSpeedBall 功能、使用与脚本开发说明

适用版本：WinSpeedBall `3.8.5 Developer Beta`

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
- 使用项目内置 Tesseract 在本机识别中文和英文；识别前会自动放大截图、加深浅灰色文字并增加边缘留白，避免灰色 A、B、C、D 选项被忽略。
- 复制 OCR 结果、重新识别或发送给 AI。
- 弹窗关闭后，后台 OCR 任务仍可继续运行。

使用步骤：

1. 打开扩展并进入“问题获取”。
2. 点击“框选截图 OCR”，或者按 `Alt+O`。
3. 回到网页，按住鼠标拖选区域。
4. 松开鼠标后等待本地识别完成。
5. 截图预览和 OCR 文字结果合并显示在“文字问题”标签中，不再设置单独的“OCR 结果”标签；可以直接复制、重新识别或发送给 AI。

OCR 图像增强仅处理发送给本地识别器的临时副本，不会修改保存的原始截图。题目选项使用浅灰色字体时，应将题干和全部选项一起框入，扩展会自动加深这些文字后再识别。

网页中的题目通过声音播放时，切换到“语音问题”标签：

1. 点击“开始录音”，然后播放当前 Edge 标签页里的题目声音。
2. 播放完后点击“停止识别”；单次录制最长 60 秒，也可以在录制过程中取消。
3. 扩展使用随项目内置的 Whisper Tiny q8 模型在本机转写，不需要麦克风，也不会上传录音。
4. 首次加载约 67 MB 的本地运行库和模型时会稍慢；模型会保留 5 分钟，方便连续识别多道语音题。
5. 转写文字可以复制或手动发送给 AI。原始录音只在内存中临时存在，最终只保存转写文字。

“语音问题”只支持普通网页中实际播放到当前标签页的声音。Edge 内部页面、受保护媒体和浏览器禁止捕获的页面无法使用。
Edge 还要求用户先在目标网页上调用扩展：如果你正在使用固定独立窗口，请切回播放题目语音的网页，点击工具栏中的 WinSpeedBall 图标，再在原生弹窗的“语音问题”中点击“开始录音”。

“文字问题”和“语音问题”会独立记住最后一次打开的标签。再次打开插件时自动恢复该标签，不会改变原有的主功能页、窗口模式或页面滚动位置恢复逻辑。

### 3.3 AI答题与AI教学

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
- 新工作区默认使用“直接答案”模式。直接问题默认只输出最简最终答案，例如“1+1=？”只返回“2”；只有输入框明确要求解析、步骤，或者选择“解释重点”时才输出过程。输入框中的题号范围、语言、格式和字数高于默认模式；如果要求冲突，以输入框中的明确要求为准。
- 读取页面时会合并最多八个相关页面框架并优先保留题目、选项区域。页面仍过长时会标记为截取内容，要求 AI 明确说明缺少的信息而不是猜测。
- OCR 题目和 AI 回复会原样保留 LaTeX、JSON、Markdown、表格、上下标、数学符号、换行及指定语言。模型达到输出上限时，界面会显示“回复不完整/可能不完整”，但不会修改回复正文。

配置步骤：

1. 进入“设置 → AI 服务”。
2. 选择 Provider，填写 API Key、Base URL 和 Model。本地模型可以不填 API Key。
3. 先点击“测试”，确认连接成功后再点击“保存”。
4. 需要自动发送 OCR 时，开启“OCR 识别完成后自动发送给 AI”。
5. 回到“AI答题”页面，可以直接读取页面提问；也可以在 OCR 页面点击“发给 AI”。
6. 只想询问一个独立问题时，直接在问题框输入即可，不需要先读取页面。

“AI教学”位于顶部“学习助手”旁。点击后，工具栏弹窗或固定独立窗口会单独放大为 720×600，并使用左右分栏教学界面；点击右上角“返回正常界面”后恢复原有 320×340 页面和导航。视频、问题获取、AI答题、图书等其他界面始终保持原尺寸。

AI教学使用步骤：

1. 选择已经在“设置 → AI 服务”中配置完成的 Provider。
2. 教学方式固定为“公式解析式教学”，不需要选择模式。旧版教学记录会自动迁移，题目和现有进度不会丢失。
3. 输入需要讲解的题目，也可以点击“读取页面”获取当前网页文字。
4. 点击“开始教学”。理科题会先按“本步公式→符号与条件→题目对应→顺带举例→回到原题”展开：指出当前步骤需要的一条公式、定理或规律，解释符号、单位和适用条件，再把原题已知量与未知量逐项对应。没有现成公式时使用定义、定理或规律，不能编造公式。
5. 标准 LaTeX 公式会使用插件内置的 MathJax 渲染为可缩放的 SVG 矢量公式图像，并统一放大、加粗和使用纯黑字形，完整显示上标、下标、分式、根式、三角函数和化学方程式，不需要联网加载公式资源。较长的“公式＋说明文字”会按中文标点和安全长度自动拆成多行，避免为了塞进单行而整体缩小；纯公式不会被随意拆断。这套机制同时用于 AI教学、AI答题主界面和独立 AI 回复窗口；没有公式的普通回复继续按文字显示。AI 随后会顺带给一个使用同一公式但数据或情境不同的小例子，再回到原题提出一个核心问题。用户提交答案和简短依据后，AI 会重点检查公式选择、适用条件、量的对应、单位、正负号和计算，每轮只指出一个关键缺口并只提出一个问题。
6. 暂时没有思路时点击“公式与例题”。同一步中的帮助依次升级为“公式提示→代入示范→完整例题”；完整例题会按“公式选择、条件检查、量的对应、代入计算、结果检验”完整解答另一道同构小题，再回到原题只问一个问题。所有例题均不能代入或解答原题，进入新步骤后帮助等级自动归零。
7. 分步指导内容位于独立滚动区：可使用滚轮、触控板、顶部/底部、上一屏/下一屏或 Home、End、PageUp、PageDown 阅读。阅读百分比会实时更新，新步骤自动平滑回到顶部并突出显示，关闭后会记住当前阅读位置。
8. 原题完成后必须在首次不提供公式提示或示例的情况下继续回答一道同方法变式题。能够独立选择并使用公式或规律且说明依据后，才显示最终答案、公式链或方法链、关键依据、易错点和自检清单；需要练习新题时点击“重新开始”。

AI教学复用现有 Provider 配置，但题目、对话和教学进度单独保存在当前浏览器，不会写入“AI答题”的问题草稿、回复或历史记录。隐私中心清理 AI 数据时会一并删除教学进度。

API Key 只保存在扩展存储中，不开放给网页脚本或 SDK 脚本。

当前安全限制：

- 单次 AI 请求体最大约 `512 KiB`，响应最多读取 `2 MiB`，请求超过 `45` 秒会超时。
- 云端 Provider 的 Base URL 必须使用 HTTPS；本地模型只允许使用 `localhost`、`127.0.0.1` 或 `[::1]` 的 HTTP/HTTPS 地址。
- Base URL 不能包含用户名、密码、查询参数或片段；请求不携带浏览器登录凭据，也不跟随重定向。

### 3.4 图书翻页

功能：

- “图书自动翻阅”只识别普通网页图书阅读器，使用浏览器原生方式点击阅读器翻页按钮。
- “图片自动翻阅”只识别普通网页图片序列，使用浏览器原生滚动切换上一张或下一张。
- 上述两个普通模式不会检测学习通或超星阅读器，也不会申请学习通框架权限。
- “学习通版本”单独识别超星 PDG/JPath 图像书的 `#Readweb`、`.duxiuimg`、`input.Jimg` 等结构，恢复改动前的专用翻页方式：优先调用 `window.readweb.goto`，未生效时切换目标 JPath 节点并同步页码回调。
- 普通图书和图片模式不会调用学习通页面函数或修改 JPath 节点；学习通专用机制只在“学习通版本”中运行。
- 扫描页面中的多层 iframe，锁定评分最高的真实阅读器后再执行操作。
- 在 Edge 的 MAIN 主页面环境中加载图书控制核心。
- 三个模式均支持手动上一页、下一页和按设定间隔自动翻阅。
- 学习通版本按 400、300、250、150、50 秒的递减间隔读取 `#pagejump` 当前选中项，检测到“封底页”后自动停止；最后阶段每 50 秒持续检查。
- 学习通界面的封底页检测状态区会显示“待启动、检测中、已到封底”、当前选项和下次检测倒计时。
- 后台任务状态与失败原因写入运行日志。

使用步骤：

1. 打开扩展并进入“图书”。
2. 普通网页图书选择“图书自动翻阅”，普通网页图片序列选择“图片自动翻阅”，学习通 PDG/JPath 图像书选择“学习通版本”。
3. 点击当前模式中的检测按钮；检测成功后，先测试“上一页/下一页”或“上一张/下一张”。
4. 普通图书和图片模式的自动翻阅间隔设置为 `30` 至 `3600` 秒；学习通版本可设置为 `2` 至 `3600` 秒。
5. 点击启动按钮；不再需要时点击“停止”。

首次控制跨域阅读器时，Edge 可能询问是否允许扩展访问当前网页及阅读器 iframe 来源。只有用户允许后，扩展才能进入跨域阅读器框架。普通图书和图片模式不会申请学习通域名权限；只有“学习通版本”会按需申请超星阅读器框架权限。授权后会在页面加载早期预注入 MAIN 主环境控制核心；当前页面已经打开时则自动运行时补注入。扩展先扫描所有可访问框架，再只向评分最高的阅读器发送一次翻阅指令。

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
- 建立无固定到期时间的授权会话，并调用真实 Video、Page、Book、AI、OCR 和 Storage 服务。

使用步骤：

1. 进入“设置 → 高级设置”。
2. 开启 Developer Mode，并确认高级功能提示。
3. 进入“开发者”，新建、复制或导入 SDK 脚本。
4. 点击“校验”，确认能力声明正确。
5. 脚本声明 `book.read` 或 `book.control` 时，在“SDK 运行会话”中选择脚本要使用的图书授权模式。
6. 点击“授权并启动”，检查当前网站和能力范围。
7. 使用保存按钮或 `Ctrl+S` 保存，然后运行脚本或使用 API 契约测试。
8. 完成后停止会话；关闭 Developer Mode 也会撤销会话和运行令牌。

### 3.7 日志中心

运行日志记录视频、图书、OCR、AI、脚本、权限和主要界面操作，支持：

- 搜索
- 级别筛选
- 刷新
- 复制
- JSON 导出
- 清空
- 鼠标、触控板和键盘滚动

主功能页会分别保存当前滚动位置，再次打开插件或切换回来时恢复。AI回复窗口和脚本工作区会在长内容出现时显示顶部阅读进度，并在向下阅读后显示“回顶/回到顶部”按钮；Home、End、PageUp、PageDown 和方向键均使用浏览器原生滚动。内容较短时不会显示多余控件；系统开启“减少动态效果”后会自动关闭平滑动画。

“更新日志”用于查看当前版本及本轮制作记录。

### 3.8 本地账户、声明与隐私

- 本地账户只存在于当前浏览器，不是云账户。
- 支持注册、登录、退出、修改显示名称、修改密码和删除账户。
- 使用声明更新后需要重新确认。
- 隐私中心可以分类删除截图、问题获取记录、AI 数据、日志、脚本和账户数据；AI 数据包含AI答题历史、工作区及AI教学进度。
- OCR 和 Whisper 语音转写默认完全在本机执行；只有用户主动发送或开启自动发送时，文字才会发送给所选 AI 服务。

### 3.9 独立窗口、捐赠与作者信息

- 顶部固定按钮可以把浏览器弹窗变为持续停留的独立主窗口。
- 插件会统一记住最后停留的主功能页、问题获取标签、图书标签、日志标签、AI教学模式及各主功能页的滚动位置；再次点击插件图标时自动恢复。
- 浏览器弹窗和独立窗口分别保存脚本工作区运行状态，普通浏览器弹窗不会自动恢复独立窗口中的脚本运行界面。
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
| `dom` | 所有普通用户脚本必需的基础权限；读取和修改当前网页 DOM |
| `network` | 在 `dom` 上按需叠加；允许 `fetch`、XHR、WebSocket 等主动联网，仍受 CORS 和浏览器安全规则限制 |
| `automation` | 在 `dom` 上按需叠加；仅解锁兼容工作区中扩展已实现的受控自动翻页或下一条桥接 |

要求：

- 必须声明 `@permission dom`。浏览器的 `USER_SCRIPT` 环境只要注入网页就天然可以访问 DOM，因此不接受只有 `network` 或只有 `automation` 的脚本。
- 只允许 `dom`、`network`、`automation`。
- 执行环境的 `worldId` 按脚本标识、代码和有效权限边界分离。未声明 `network` 时，脚本执行世界使用 `connect-src 'none'`，兼容工作区也会隐藏网络 GM 接口并应用断网 CSP；声明 `network` 后只放行受 CORS 和浏览器安全规则限制的主动网络 API。代码或权限变化时，插件会先配置新环境、再切换注册，并锁定旧环境。
- `automation` 只解锁兼容工作区的受控桥接，不会顺带开放 `network` 或普通脚本消息 API。敏感自动化动作仍需要用户额外确认。
- `network` 只控制脚本直接调用的主动网络 API。拥有 `dom` 的脚本仍可创建图片、链接、表单等页面元素，由网页触发资源加载或导航，也可向网页主环境注入代码后联网；普通脚本因此不是完全断网的强沙箱。
- 升级前已经保存、但没有声明 `dom` 的旧脚本会自动补充该基础声明并撤销旧确认；再次运行前需要重新核对并确认权限。新导入脚本缺少 `dom` 时会直接拒绝。
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
- `GM_notification`
- `GM_registerMenuCommand`、`GM_unregisterMenuCommand`
- 对应的部分 `GM.*` Promise 写法

只有脚本已经声明并确认 `@permission network` 时，工作区才会额外提供 `GM_openInTab`、`GM_xmlhttpRequest` 及对应的 `GM.*` 写法。只有声明并确认 `@permission automation` 时，`parent.postMessage` 兼容调用才会转发到受控自动化桥接。

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
| `video.control` | 倍速、音量、静音、播放、暂停、自动播放、倍速锁和状态重置 |
| `ocr.read` | 最近一次 OCR；交互截图和直接识别目前未接通 |
| `qa.read` | 问题获取中的最新 OCR、网页语音及聚合结果 |
| `ai.read` | 已保存的最新 AI 回复和历史回复；不包含 API Key |
| `ai.request` | AI 提问、总结和翻译 |
| `page.read` | 页面信息、标题、URL 和正文 |
| `book.read` | 只读访问已绑定当前网页中的普通图书、图片序列或学习通图书状态 |
| `book.control` | 在已绑定当前网页中手动翻阅，或启动、停止和调整自动翻阅 |
| `storage` | 当前脚本独立的本地存储空间 |

### 5.3 SDK 规则与限制

- 至少声明一个有效的 `@wsb-capability`。
- 不允许未知能力。
- SDK 脚本不能包含旧 `@permission`，两种模式不能混用。
- 草稿编辑器实际限制为 `200000` 字符，最多保存 20 个草稿。
- 脚本在独立 Worker 中运行，支持顶层 `await`。
- 脚本默认没有固定总执行时长，可以持续调用已授权接口；停止会话会立即终止对应 Worker。
- 运行器保留原生心跳看门狗；Worker 连续 5 次未响应会被终止，避免死循环长期占用浏览器资源。
- 每个运行实例最多允许 64 个未决 RPC，持续请求速率最多 120 次/秒；这些是资源保护，不是会话或接口的连接时限。
- 脚本返回结果必须可序列化，并且不超过 64 KiB。
- 单次 RPC 最多 16 个参数，序列化后不超过 64 KiB。
- 运行令牌和授权会话没有固定分钟数到期，只保存在浏览器会话存储中。
- 停止会话、同草稿替换、脚本删除、关闭 Developer Mode、授权撤销、页面上下文失效或浏览器会话结束时会撤销运行令牌。
- 一次性页面确认仍保留短期有效期，只用于防止确认期间页面、能力或图书模式发生变化。
- 授权绑定脚本代码摘要、能力、当前网站来源和 SDK 版本；代码或能力变化后需要重新授权。

SDK Worker 不开放：

- `window`、`document`、`parent`、`top`
- `chrome`、`browser`
- `fetch`、`fetchLater`、`XMLHttpRequest`、`WebSocket`、`WebSocketStream`、`EventSource`、`WebTransport`
- `navigator`、`sendBeacon`、`Notification`、`cookieStore`
- `Worker`、`SharedWorker`、`importScripts`
- `indexedDB`、`caches`
- `FontFace`、`FontFaceSet`、`fonts`
- `Function`、`eval`

因此，SDK 脚本不能直接操作网页 DOM，也不能自行联网；所有能力必须通过冻结的 `WSB` 对象调用。

### 5.4 SDK Storage 配额

- 扩展声明 `unlimitedStorage`，用于移除 `chrome.storage.local` 的固定总配额，确保多个脚本可分别使用下列隔离配额；该权限不会授予任意磁盘文件读取或网络访问能力。
- 每个脚本最多 100 个键。
- 键名只允许 `A-Z`、`a-z`、`0-9`、点、下划线和短横线，长度 1 至 128。
- 单值最大 64 KiB。
- 单个高级 SDK 脚本的隔离存储总容量最大 5 MiB。
- 值必须可以被 JSON 序列化。

## 6. WSB 公开接口

SDK 中的 `WSB`、各分组和方法均被冻结。除返回取消订阅函数的预留接口 `WSB.event.on()` 外，公开业务方法都返回 Promise；成功时直接得到下表中的返回值，失败时以带 `code` 的 Error 拒绝 Promise。

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
| `WSB.video.rate(rate)` | `rate`：`0.25` 至 `16` | 设置倍速、开启倍速锁后的 `VideoControlResult` |
| `WSB.video.volume(volume)` | `volume`：`0` 至 `1` | 应用后的 `VideoControlResult` |
| `WSB.video.mute(muted = true)` | 布尔值 | 应用后的 `VideoControlResult` |
| `WSB.video.play()` | 无 | 播放后的 `VideoControlResult` |
| `WSB.video.pause()` | 无 | 暂停后的 `VideoControlResult` |
| `WSB.video.auto(enabled = true)` | `enabled`：布尔值 | 开启或关闭自动播放后的 `VideoControlResult` |
| `WSB.video.lock(enabled = true)` | `enabled`：布尔值 | 开启或关闭倍速锁后的 `VideoControlResult` |
| `WSB.video.reset()` | 无 | 重置后的 `VideoControlResult` |

`auto()` 和 `lock()` 不传参数时都表示开启。需要关闭时必须明确传入 `false`：

```javascript
await WSB.video.auto(false);
await WSB.video.lock(false);
```

`WSB.video.rate()` 设置目标倍速时会同时开启倍速锁，不需要再重复调用 `lock(true)`。`WSB.video.lock(false)` 只关闭倍速锁，不会改变自动播放状态。`WSB.video.reset()` 会一次性恢复 1 倍速、0.8 音量和非静音，并关闭倍速锁与自动播放。

控制方法只返回本次操作相关的最小回执，不会借 `video.control` 暴露媒体标题、时长或播放进度：

```javascript
{
  action: "rate",
  applied: 1,
  rate: 2,
  volume: 0.8,
  muted: false,
  autoplay: true,
  rateLocked: true
}
```

需要 `title`、`duration`、`currentTime`、`mediaCount` 等详细状态时，脚本必须另外声明 `video.read`，再调用 `WSB.video.current()` 或 `WSB.video.status()`。

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

读取状态需要 `book.read`，执行翻阅需要 `book.control`。两种能力互不包含：只控制不读取时可以只声明 `book.control`；控制前后还要读取状态时，两项都要声明。

| 方法 | 参数 | 返回值 |
| --- | --- | --- |
| `WSB.book.status(mode?)` | `"book"`、`"image"` 或 `"chaoxing"`；可省略 | 本会话授权模式的 `BookStatus` |
| `WSB.book.prev(mode?)` | 可省略的模式 | 向前翻阅后的 `BookControlResult` |
| `WSB.book.next(mode?)` | 可省略的模式 | 向后翻阅后的 `BookControlResult` |
| `WSB.book.start(options = {})` | `{ mode, intervalSeconds }` | 启动自动翻阅后的 `BookControlResult` |
| `WSB.book.stop()` | 无 | 停止当前脚本自动翻阅后的 `BookControlResult` |
| `WSB.book.interval(seconds, mode?)` | 间隔秒数和可省略的模式 | 修改间隔后的 `BookControlResult` |

三个模式的含义：

| 模式 | 适用内容 | 自动翻阅间隔 |
| --- | --- | --- |
| `"book"` | 普通网页图书阅读器，点击阅读器原生上一页或下一页按钮 | `30` 至 `240` 秒 |
| `"image"` | 普通网页图片序列，使用浏览器原生滚动切换图片 | `30` 至 `240` 秒 |
| `"chaoxing"` | 学习通 PDG/JPath 图像书，使用独立的学习通专用机制 | `2` 至 `240` 秒 |

学习通 `2` 至 `29` 秒间隔由浏览器后台快速定时执行。浏览器休眠、节能或冻结页面时可能延迟，扩展会通过 30 秒 Alarm 唤醒并恢复任务；需要稳定快速翻阅时，应保持阅读器标签页和浏览器处于活动状态。

图书能力启动前必须在“SDK 运行会话”中确认唯一授权模式。下拉框默认选择 `"chaoxing"`，以兼容原有学习通脚本。所有无参图书方法自动使用本会话授权模式；显式模式也必须与本会话一致，不能借用浏览器以前保留的站点权限切换到其他阅读机制，否则返回 `BOOK_MODE_NOT_AUTHORIZED`。

`WSB.book.start()` 默认等同于：

```javascript
await WSB.book.start(); // 使用本会话授权模式；学习通默认 2 秒，其他模式默认 30 秒
```

启动自动翻阅时会立即执行一次翻阅，然后才按设定间隔继续。`WSB.book.start({ mode: "chaoxing" })` 未填写间隔时使用 2 秒；普通图书或图片模式未填写间隔时使用 30 秒。

`WSB.book.interval()` 只修改当前脚本已经启动、且模式相同的自动翻阅任务。例如先以 `"image"` 模式启动，就应调用 `WSB.book.interval(60, "image")`。同一时间只允许一个图书自动翻阅任务；其他页面、其他脚本或插件图书面板已有任务时，新任务会被拒绝，防止互相停止或修改。

自动翻阅没有固定会话到期时间。停止会话、替换或删除脚本、关闭 Developer Mode、清理脚本数据、撤销授权、关闭绑定标签页、跨来源导航或浏览器会话结束时，插件会自动停止该脚本启动的任务。启动和修改间隔只需要满足当前图书模式的间隔范围，不再受会话剩余时间或额外 15 秒余量限制。

`book.read` 和 `book.control` 都必须绑定当前网页。SDK 不会向脚本开放网页 DOM、框架地址或浏览器内部权限。授权后如果网页来源变化，调用会失败并要求重新授权。启动含图书能力的 SDK 会话前，需要在“SDK 运行会话”中选择普通图书、图片序列或学习通图像书；所选模式会同时绑定到一次性确认、运行令牌和后台会话。插件只发现并申请所选模式的阅读器来源，不会申请广告、登录等无关框架。如果阅读器在会话启动后才加载，请先打开插件“图书”页面，选择相同模式并完成一次检测和 Edge 授权，再重新运行脚本。

同一草稿重新启动时会替换旧会话，立即撤销旧令牌并停止该会话启动的图书任务。旧版带到期时间的记录、格式无效记录和已经失去页面上下文的会话会被清理，后台最多同时保存 50 个有效 SDK 会话。

控制方法只返回最小回执，不会借 `book.control` 暴露页码等只读数据：

```javascript
{
  action: "next",
  mode: "book",
  running: false,
  intervalSeconds: 0,
  method: "browser-native-click"
}
```

需要 `page`、`currentOption`、`imageIndex` 等详细阅读状态时，脚本必须另外声明 `book.read`，再调用 `WSB.book.status(mode)`。

`BookStatus` 模型：

```javascript
{
  mode: "book",
  detected: true,
  reader: "检测到的阅读器类型",
  readerEngine: "使用的阅读器引擎",
  page: "12",
  pageType: "",
  pageTypeLabel: "",
  imageIndex: 0,
  imageCount: 0,
  canPrev: true,
  canNext: true,
  method: "本次使用的原生翻阅方式",
  currentOption: {
    detected: false,
    value: "",
    label: ""
  },
  isBackCover: false,
  running: true,
  intervalSeconds: 30,
  monitor: {
    enabled: false,
    reached: false,
    checkIndex: 0,
    nextCheckAt: "",
    nextCheckSeconds: 0,
    sequenceSeconds: [400, 300, 250, 150, 50]
  }
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `mode` | `string` | 本次查询或控制使用的 `book`、`image` 或 `chaoxing` 模式 |
| `detected` | `boolean` | 当前绑定网页是否检测到该模式可用的阅读内容 |
| `reader` | `string` | 已检测阅读器类型；未检测到时为空字符串 |
| `readerEngine` | `string` | 实际使用的阅读器引擎；未知时为空字符串 |
| `page` | `string` | 阅读器报告的当前页码；未知时为空字符串 |
| `pageType` | `string` | 学习通 JPath 页面类型编号；其他模式通常为空字符串 |
| `pageTypeLabel` | `string` | 学习通页面类型名称，例如“正文页”或“封底页” |
| `imageIndex` | `number` | 图片模式当前图片序号；未知时为 `0` |
| `imageCount` | `number` | 图片模式检测到的图片总数；未知时为 `0` |
| `canPrev` | `boolean` | 当前检测结果是否可以向前翻阅 |
| `canNext` | `boolean` | 当前检测结果是否可以向后翻阅 |
| `method` | `string` | 本次检测或操作使用的原生翻阅方式 |
| `currentOption.detected` | `boolean` | 学习通模式是否检测到 `#pagejump` 当前选项 |
| `currentOption.value` | `string` | 学习通当前选中 `option` 的 `value` |
| `currentOption.label` | `string` | 学习通当前选项文字，例如“正文362页”或“封底页” |
| `isBackCover` | `boolean` | 学习通模式本次实时读取是否已处于封底页 |
| `running` | `boolean` | 当前绑定网页和当前模式是否正在运行自动翻阅 |
| `intervalSeconds` | `number` | 当前自动翻阅间隔；未运行时为 `0` |
| `monitor.enabled` | `boolean` | 学习通封底页定时检测是否启用 |
| `monitor.reached` | `boolean` | 后台检测任务是否已经确认到达封底页 |
| `monitor.checkIndex` | `number` | 当前检测间隔在递减序列中的索引 |
| `monitor.nextCheckAt` | `string` | 下次检测的 ISO 8601 时间；没有待检测任务时为空字符串 |
| `monitor.nextCheckSeconds` | `number` | 距离下次检测的剩余秒数 |
| `monitor.sequenceSeconds` | `number[]` | 学习通封底页检测间隔序列，当前为 `[400, 300, 250, 150, 50]` |

`currentOption` 和 `monitor` 主要用于 `"chaoxing"`。普通图书或图片模式没有对应控件时会返回安全的空值，不会向脚本暴露页面节点。`monitor.nextCheckAt` 使用 ISO 8601 时间，没有待执行检测时为空字符串。

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

### 7.1 设置倍速、自动播放和倍速锁

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

需要恢复默认视频状态时，可以单独运行：

```javascript
await WSB.video.reset();
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

const status = await WSB.book.status("chaoxing");
const optionLabel = status.currentOption.label.trim();
const reachedBackCover = status.isBackCover || optionLabel === "封底页";

if (reachedBackCover) {
  console.log("图书已经到达封底页");
} else {
  console.log("当前选项：", optionLabel || "未检测到");
}
```

### 7.5 普通图书自动翻阅

下面的脚本会先立即翻到下一页，然后每 30 秒继续翻一页：

```javascript
// ==UserScript==
// @name 普通图书自动翻阅
// @version 1.0.0
// @wsb-capability book.read
// @wsb-capability book.control
// ==/UserScript==

const before = await WSB.book.status("book");
if (!before.detected) {
  throw new Error("没有检测到普通网页图书，请先在插件图书页面完成检测和授权。");
}

await WSB.book.start({
  mode: "book",
  intervalSeconds: 30
});
```

需要停止时，由同一个脚本调用：

```javascript
await WSB.book.stop();
```

图片序列只需把上例中的两个 `"book"` 都改为 `"image"`。学习通图像书则改为 `"chaoxing"`，并可把间隔设置为 `2` 至 `240` 秒。

### 7.6 读取最新问题和 AI 答案

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
| `BOOK_PAGE_PERMISSION_REQUIRED` | 缺少当前网页或跨域阅读器框架权限；重新启动 SDK 会话完成授权，或在插件图书页面检测并授权 |
| `BOOK_MODE_NOT_AUTHORIZED` | 调用中填写的图书模式不是本次会话确认的唯一模式 |
| `BOOK_TASK_ALREADY_RUNNING` | 当前脚本已经启动了同模式的自动翻阅任务 |
| `BOOK_TASK_CONFLICT` | 其他页面、脚本或插件图书面板已经占用自动翻阅任务 |
| `BOOK_TASK_CANCELLED` | 会话关闭、撤销或任务状态变化，翻阅在实际点击前被取消 |
| `BOOK_TASK_NOT_RUNNING` | 当前脚本尚未启动自动翻阅，不能修改间隔 |
| `BOOK_TASK_MODE_MISMATCH` | 修改间隔时填写的模式与当前任务模式不同 |
| `SDK_QA_READ_FAILED` | OCR 或网页语音问题读取失败 |
| `SDK_AI_READ_FAILED` | 最新 AI 回复或历史读取失败 |
| `SDK_PAYLOAD_TOO_LARGE` | 参数或结果超过大小限制 |
| `SDK_CONTEXT_CHANGED` | 授权后页面来源发生变化 |
| `SDK_SESSION_REVOKED` | 页面、授权或脚本状态已经变化，本次长期会话已被撤销 |
| `SDK_SESSION_STORAGE_FAILED` | 浏览器会话存储暂时读写失败；操作未按空会话继续执行，可稍后重试 |
| `SDK_SESSION_LIMIT_REACHED` | 同时有效的 SDK 会话已达到 50 个；先停止不再使用的会话 |
| `SDK_WORKER_UNRESPONSIVE` | Worker 连续未响应原生心跳，运行器已终止脚本 |
| `SDK_RPC_CONCURRENCY_LIMIT` | 同一运行实例的未决 RPC 达到 64 个 |
| `SDK_RPC_RATE_LIMIT` | 同一运行实例持续超过每秒 120 次 RPC |
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
