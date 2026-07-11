# WinSpeedBall SDK Beta

此目录保存 WinSpeedBall SDK 的公开契约和沙箱运行时。3.6.0 Developer Beta 已接入扩展后台桥接，用户脚本只允许通过冻结的 `WSB` 对象访问已确认能力。

```js
// ==UserScript==
// @name 学习进度记录
// @version 1.0.0
// @wsb-capability video.read
// @wsb-capability storage
// ==/UserScript==

const video = await WSB.video.current();
await WSB.storage.set("lastProgress", video.progress);
```

`runtime.js` 组合六组公开 API，调用只会进入受控的 `invoke/subscribe` 传输层。SDK 不向用户脚本开放浏览器扩展 API、内部 Service、网络接口或全局存储。

当前 Beta 尚未连接 `ocr.capture`、`ocr.recognize` 和实时 `event.on`，调用时会返回 `SDK_DEPENDENCY_NOT_READY`。完整设计和能力说明见 `docs/sdk-design-3.5.0.md`。
