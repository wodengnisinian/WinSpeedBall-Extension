# WinSpeedBall Extension

面向 Microsoft Edge 和 Chromium 浏览器的学习辅助扩展，提供视频控制、区域截图 OCR、可配置 AI 学习辅助、图书翻页和本地用户脚本功能。

## 主要功能

- 视频倍速、音量、静音和持续播放控制
- 区域截图及本地中英文 OCR
- OCR 完成后按用户设置自动发送给 DeepSeek、OpenAI、Claude 或本地模型
- 自定义 OCR 自动发送提示词，支持 `{{OCR}}` 占位符
- 图书手动翻页和后台自动翻页
- 按“视频、OCR、AI、图书、脚本、其他”分类运行本地脚本
- 详细任务日志和截图、OCR、AI 状态追踪
- 本地用户注册、登录、退出、资料修改、改密和账户删除
- 首次使用声明、禁止用途说明和版本化确认记录
- 顶部固定按钮，可将浏览器原生弹窗打开为持续停留的独立小窗口

## 在 Microsoft Edge 中安装

1. 打开 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `WinSpeedBall-Extension`。
5. 修改代码后，需要在扩展管理页面点击“重新加载”。

## 网站权限

- 视频控制、区域 OCR 和页面总结默认只在用户打开扩展后临时访问当前标签页。
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

当前支持 `dom` 和 `network`。首次运行或权限变化后，扩展会再次请求用户确认。

## OCR 与 AI 使用方法

1. 在设置页面选择 DeepSeek、OpenAI、Claude 或本地模型，并填写对应的 API Key、服务地址和模型；本地模型可以不填 API Key。
2. 如需自动发送，打开“OCR 识别完成后自动发送给 AI”。
3. 自定义提示词可以留空，也可以使用 `{{OCR}}` 插入本次识别结果。
4. 点击区域 OCR，回到网页框选内容。
5. 截图会保存到扩展的 IndexedDB，并由后台隐藏工作页继续识别；弹窗关闭不会中断 OCR。
6. OCR 和 AI 的当前状态、失败原因可以在日志页面查看。

旧版 DeepSeek 配置会自动迁移。升级后请在设置页点击一次“保存”，让浏览器确认当前 AI 服务地址的访问权限。

## 账户与使用声明

- 当前账户为本地账户，只在当前浏览器配置中有效，不支持云同步、订阅结算或在线找回密码。
- 密码使用随机盐和 PBKDF2-SHA-256 摘要保存，不保存明文；登录会话只保存在浏览器临时会话区。
- 用户可以注册、登录、退出、修改显示名称、修改密码和删除本地账户。
- 使用声明会记录版本、内容摘要和确认时间。声明更新后需要重新确认。
- 声明用于解释产品用途、禁止行为、数据处理和使用责任，不是不可篡改的司法存证，也不能替代正式法律意见。
- 完整文档见 [`PRIVACY.md`](PRIVACY.md) 和 [`docs/usage-declaration.md`](docs/usage-declaration.md)。

## 隐私说明

- 截图和 OCR 结果默认保存在本机浏览器扩展存储中。
- Tesseract OCR 在本地运行，不上传截图。
- 只有启用自动发送或手动点击发送时，识别后的文字才会发送到用户配置的 AI 服务。
- API Key 保存在当前浏览器的受信任扩展存储中，不会向网页内容脚本开放，也不会写入日志。
- 日志记录任务编号、状态、耗时和文字数量，不记录完整 OCR 内容或 API Key。
- 本地账户不要求邮箱或手机号；用户名和密码摘要不会上传到项目服务器。

## 项目模块

- `background.js`：扩展生命周期、标签页控制、OCR 和自动翻页编排。
- `background/storage-service.js`：本地存储、后台日志和截图 IndexedDB。
- `background/declaration-service.js`：使用声明内容、版本、摘要和确认记录。
- `background/user-service.js`：本地账户、密码摘要、登录会话和账户生命周期。
- `background/window-service.js`：固定窗口创建、复用、聚焦和关闭状态清理。
- `background/ai-providers.js`：不同 AI 服务的请求协议、响应解析、超时和安全校验。
- `background/ai-service.js`：AI Provider 选择、独立配置、旧数据迁移和 OCR 结果关联。
- `background/ocr-service.js`：离屏 OCR 调度、任务状态、结果处理和自动 AI。
- `background/video-service.js`：多 Frame 视频控制、脚本注入和播放状态聚合。
- `background/message-schema.js`：消息来源与参数校验。
- `background/message-router.js`：消息分发与统一响应。
- `background/user-script-service.js`：浏览器用户脚本注册和执行。
- `popup/popup-utils.js`：弹窗通用格式化和参数规范化。
- `popup/popup-storage.js`：弹窗本地存储访问层。
- `popup/message-client.js`：弹窗后台消息和网站授权客户端。
- `popup/ai-controller.js`：AI 提示词、请求状态和历史记录控制。
- `popup.js`：视频、OCR、设置、脚本和导航界面编排。
- `content/player-adapters.js`：HTML5 播放器控制能力与 YouTube、Bilibili 站点识别。
- `content_script.js`：页面媒体注册表、增量 DOM 扫描、区域截图和页面文字提取。

媒体层首次加载时建立一次索引，之后只扫描新加入的 DOM 节点和 Shadow Root。持续控制每秒只检查已注册的媒体元素，并每 30 秒进行一次完整性校准。

## 验证

项目不需要构建步骤。修改后可以执行：

```powershell
node --check background.js
node --check background/storage-service.js
node --check background/declaration-service.js
node --check background/user-service.js
node --check background/window-service.js
node --check background/ai-providers.js
node --check background/ai-service.js
node --check background/ocr-service.js
node --check background/video-service.js
node --check background/message-schema.js
node --check background/message-router.js
node --check background/user-script-service.js
node --check popup/popup-utils.js
node --check popup/popup-storage.js
node --check popup/message-client.js
node --check popup/ai-controller.js
node --check content/player-adapters.js
node --check content_script.js
node --check popup.js
node --check ocr.js
node --check ocr_worker.js
node --check script_workspace.js
node --check shadow_hook.js
```

AI Provider、旧配置迁移和消息兼容测试：

```powershell
node --test tests/ai-provider.test.js
node --test tests/user-declaration.test.js
node --test tests/window-service.test.js
```

`docs/ocr-runtime-test.html` 用于验证项目内置 Tesseract、WASM 核心和英文语言包能否实际识别测试图片。

`docs/test-video.html`、`docs/test-shadow-video.html` 和 `docs/test-ruffle-detect.html` 分别用于验证标准媒体、Shadow DOM 和特殊播放器识别。

## 注意事项

- 自动翻页使用浏览器 Alarm API，正式环境的最小可靠周期为 30 秒。
- 浏览器内部页面和受保护页面不允许扩展注入脚本或截图。
- 用户脚本具有网页操作能力，只应导入自己信任的脚本。
