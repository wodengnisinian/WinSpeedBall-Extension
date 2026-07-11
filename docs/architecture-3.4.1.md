# WinSpeedBall 3.4.1 架构基线

## 当前调用链

```text
popup
  -> message-client
  -> message-schema / message-router
  -> background composition root
       -> UserProvider -> LocalUserProvider
       -> SubscriptionService -> FeatureGate
       -> PrivacyService
       -> DeclarationService
       -> WindowService -> session id / persistent bounds
       -> AIService -> AIProviders
       -> OCRService
       -> VideoService -> content_script -> player-adapters
       -> UserScriptService
       -> StorageService / IndexedDB / chrome.storage.session
```

## UserProvider 契约

所有 Provider 必须实现：

```text
login(request)
logout()
getUser()
updateProfile(request)
```

LocalUserProvider 继续使用 3.4.0 的 `localUserAccounts` 和 `localUserSession` 数据结构。CloudUserProvider 只保留注册入口，不包含服务器实现。

## FeatureGate

3.4.1 登记能力：

- `video.basic`
- `ocr.basic`
- `ai.basic`
- `ai.summary`
- `sdk.developer`
- `cloud.sync`

稳定性阶段所有已登记能力均放行；未知能力默认拒绝。SubscriptionService 只返回计划和非强制额度，不处理支付或真实订阅。

## Privacy Center

PrivacyService 统一统计和清理截图、OCR、AI 历史、日志、用户脚本与本地账户数据。服务只访问本机存储，不上传数据；AI 配置、界面设置和使用声明不属于本批清理范围。

## WindowService

固定窗口编号保存在会话存储，位置、大小和开关状态保存在本地持久存储。服务工作线程重启后会扫描并找回已打开的固定窗口；用户关闭后再次打开时恢复上次位置和大小。

## 3.4.1 后续批次

1. 视频生命周期：区分一次应用与持续锁定，增加 `STOP_LOCK` 并清理定时器。
2. PermissionService：集中管理网站、AI 服务和用户脚本权限。
3. 拆分 `popup.js` 与 `content_script.js`，为 3.5.0 SDK Beta 降低耦合。
