# WinSpeedBall 3.6.0 Developer Mode

## 当前状态

Developer Mode 已连接真实 SDK Beta 运行时。普通用户默认看不到“开发者”入口；用户在“设置 → 高级设置”明确确认后才会显示入口。关闭 Developer Mode 会隐藏入口、终止当前窗口 Worker，并由后台撤销所有窗口的 SDK 令牌和会话。

## 已实现功能

- SDK 能力和公开方法文档。
- 最多 20 个本地草稿，支持新建、选择、保存、删除、导入和导出。
- `@wsb-capability` 校验，拒绝未知能力、旧 `@permission` 混用和危险脚本标识。
- 启动前显示能力和具体运行来源，要求用户明确确认。
- 独立 Sandbox Worker、私有 MessagePort、运行超时和手动停止。
- 真实 API 测试，调用必须经过 Message Schema、PermissionService、FeatureGate 和 SdkService。
- 脚本隔离 Storage，以及草稿、授权、令牌和会话的隐私清理。

## 本地数据

- `developerModeSettings`：Developer Mode 开关和 SDK 版本。
- `developerSdkDrafts`：多草稿代码、名称、能力和保存时间。
- `developerActiveDraftId`：当前草稿标识。
- `sdkPermissionGrants`：代码、能力、来源和 SDK 版本绑定的授权记录。
- `sdkScriptStorage`：按脚本隔离的键值数据。
- `sdkRuntimeTokens`、`sdkRuntimeSessions`、`sdkContextIntents`：仅位于浏览器会话存储中的短期运行状态。

项目没有新增服务器、支付或广告。SDK 的 AI 调用复用用户已配置的 Provider；只有脚本声明 `ai.request`、用户确认并实际调用时，文本才会发送到对应服务。

## 使用步骤

1. 在设置页开启 Developer Mode。
2. 新建或导入包含 `@wsb-capability` 的脚本。
3. 点击“校验”，确认声明无误。
4. 点击“授权并启动”，核对能力和网站来源。
5. 会话启动后可运行脚本或使用真实 API 测试。
6. 完成后点击“停止会话”；也可以关闭 Developer Mode 或在隐私中心清理脚本数据。

## 已知 Beta 限制

- `ocr.capture`、`ocr.recognize` 和实时 `event.on` 尚未连接。
- 运行脚本默认 5 秒超时，长时间常驻脚本不属于当前 Beta 范围。
- 旧脚本工作区属于兼容层，不等同于新 SDK；新脚本应使用 `WSB.xxx`。
