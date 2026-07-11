# WinSpeedBall 3.5.0 SDK Beta 设计与实现

## 当前状态

SDK Beta 已接入 Manifest V3、Developer Mode、后台权限服务和真实运行沙箱。用户代码在扩展沙箱页创建的独立 Worker 中运行，只能通过冻结的 `WSB` 对象发起版本化请求，不能直接访问 `chrome.*`、内部 Service 或扩展存储。

已连接真实服务的方法：

- `WSB.video`：`getAll`、`current`、`getStatus`、`setRate`、`setVolume`、`mute`、`play`、`pause`。
- `WSB.page`：`info`、`text`、`title`、`url`。
- `WSB.ai`：`ask`、`summary`、`translate`。
- `WSB.ocr.latest`。
- `WSB.storage.get`、`WSB.storage.set`。

仍处于契约预留状态：`ocr.capture`、`ocr.recognize` 和实时 `event.on`。这些方法会返回明确的 `SDK_DEPENDENCY_NOT_READY`，不会静默伪造结果。

## 安全边界

```text
用户脚本
  -> 冻结的 WSB API
  -> 独立 Sandbox Worker
  -> 私有 MessagePort
  -> Popup Session Controller
  -> Message Schema
  -> PermissionService + FeatureGate
  -> SdkService
  -> Video / OCR / AI / Page / Storage
```

- 每次运行使用独立 Worker，默认超时 5 秒，最长不超过 30 秒。
- 脚本代码最大 256 KiB；RPC 参数和运行结果最大 64 KiB。
- 沙箱页禁止外部连接，Worker 启动前同时关闭常见网络、Worker 和跨上下文通信全局。
- 后台不信任沙箱自报的能力、来源或标签页。能力由方法映射推导，来源由一次性上下文确认记录决定。
- 上下文确认绑定 `tabId + origin + capabilities`，确认后页面换站、权限撤销、能力变化或重复使用 nonce 都会被拒绝。
- 运行令牌只保存在 `chrome.storage.session`，默认 5 分钟有效，并绑定代码摘要、能力、来源范围、SDK 版本和授权指纹。
- 关闭 Developer Mode、隐私清理、窗口关闭或用户停止会话时撤销令牌并终止本窗口 Worker。

## 能力声明

```js
// ==UserScript==
// @name 视频学习助手
// @version 1.0.0
// @wsb-capability video.read
// @wsb-capability video.control
// @wsb-capability storage
// ==/UserScript==
```

Beta 能力：

| 能力 | 允许访问 |
| --- | --- |
| `video.read` | 媒体列表和播放状态，不包含网页标题、URL 或正文 |
| `video.control` | 倍速、音量、静音、播放和暂停 |
| `ocr.read` | 最近 OCR；交互截图与直接识别暂未连接 |
| `ai.request` | AI 提问、总结和翻译 |
| `page.read` | 页面标题、地址、语言和正文 |
| `storage` | 当前脚本的隔离存储空间 |

旧 `@permission` 只用于兼容旧脚本工作区，不能与 `@wsb-capability` 混用。旧工作区的自动翻页桥接还要求显式确认 `@permission automation`。

## 存储和配额

- 每个 SDK 脚本独立命名空间。
- 每个脚本最多 100 个键、256 KiB。
- 单值最大 64 KiB。
- 配额按 UTF-8 字节计算。
- 删除全部脚本数据会同时清理草稿、SDK Storage、授权、运行令牌和会话。

## 错误码

主要稳定错误码包括：

- `SDK_PROTOCOL_MISMATCH`
- `SDK_CAPABILITY_REQUIRED`
- `SDK_METHOD_NOT_ALLOWED`
- `SDK_INVALID_ARGUMENT`
- `SDK_PAYLOAD_TOO_LARGE`
- `SDK_CONTEXT_CHANGED`
- `SDK_CONTEXT_NONCE_EXPIRED`
- `SDK_TOKEN_EXPIRED`
- `SDK_QUOTA_EXCEEDED`
- `SDK_DEPENDENCY_NOT_READY`

## 后续任务

1. 接入可取消的 `ocr.capture` 与 `ocr.recognize`。
2. 建立不依赖永久后台定时器的 Event API 生命周期。
3. 对 Chrome 和 Edge 增加持续的恶意脚本、权限撤销和 Worker 重启回归。
