# WinSpeedBall Extension

面向 Microsoft Edge 和 Chromium 浏览器的学习辅助扩展，提供视频控制、区域截图 OCR、DeepSeek 学习辅助、图书翻页和本地用户脚本功能。

## 主要功能

- 视频倍速、音量、静音和持续播放控制
- 区域截图及本地中英文 OCR
- OCR 完成后按用户设置自动发送给 DeepSeek
- 自定义 OCR 自动发送提示词，支持 `{{OCR}}` 占位符
- 图书手动翻页和后台自动翻页
- 按“视频、OCR、AI、图书、脚本、其他”分类运行本地脚本
- 详细任务日志和截图、OCR、AI 状态追踪

## 在 Microsoft Edge 中安装

1. 打开 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本目录 `WinSpeedBall-Extension`。
5. 修改代码后，需要在扩展管理页面点击“重新加载”。

## OCR 与 AI 使用方法

1. 在设置页面填写 DeepSeek API Key、服务地址和模型。
2. 如需自动发送，打开“OCR 识别完成后自动发送给 AI”。
3. 自定义提示词可以留空，也可以使用 `{{OCR}}` 插入本次识别结果。
4. 点击区域 OCR，回到网页框选内容。
5. 截图会保存到扩展的 IndexedDB，并由后台隐藏工作页继续识别；弹窗关闭不会中断 OCR。
6. OCR 和 AI 的当前状态、失败原因可以在日志页面查看。

## 隐私说明

- 截图和 OCR 结果默认保存在本机浏览器扩展存储中。
- Tesseract OCR 在本地运行，不上传截图。
- 只有启用自动发送或手动点击发送时，识别后的文字才会发送到用户配置的 AI 服务。
- API Key 保存在当前浏览器的本地扩展存储中，不会写入日志。
- 日志记录任务编号、状态、耗时和文字数量，不记录完整 OCR 内容或 API Key。

## 验证

项目不需要构建步骤。修改后可以执行：

```powershell
node --check background.js
node --check content_script.js
node --check popup.js
node --check ocr.js
node --check ocr_worker.js
node --check script_workspace.js
node --check shadow_hook.js
```

`docs/ocr-runtime-test.html` 用于验证项目内置 Tesseract、WASM 核心和英文语言包能否实际识别测试图片。

## 注意事项

- 自动翻页使用浏览器 Alarm API，正式环境的最小可靠周期为 30 秒。
- 浏览器内部页面和受保护页面不允许扩展注入脚本或截图。
- 用户脚本具有网页操作能力，只应导入自己信任的脚本。
