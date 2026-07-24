# 多 Bucket 使用说明

R2 Web 支持在同一个 Cloudflare R2 账户和同一组 S3 API 凭据下管理多个 Bucket。

## 添加 Bucket

1. 先按原有方式配置 Account ID、Access Key ID、Secret Access Key 和第一个 Bucket。
2. 进入文件管理界面后，点击顶部 Bucket 选择器右侧的“…”按钮。
3. 输入 Bucket 名称，可选填写显示名称、自定义域名和公开/私有状态。
4. 保存后可在顶部选择器中切换。

删除操作只会删除浏览器中的本地配置，不会删除 Cloudflare R2 中的真实 Bucket。

## 自动同步

“同步账户 Bucket”会调用 R2 的 ListBuckets API，自动添加当前密钥可见但尚未配置的 Bucket。

如果 API 返回 403，说明当前 Token 没有列出 Bucket 的权限。此时仍可手动添加已经授权的 Bucket，不影响文件管理功能。

## 配置迁移

旧版单 Bucket 配置会在首次启动时自动迁移到 `schemaVersion: 2`，原有账户凭据、Bucket、自定义域名、上传设置和压缩设置都会保留。

## 切换行为

切换 Bucket 后页面会刷新。这是有意设计，用于确保：

- 文件列表和目录状态不会跨 Bucket 复用；
- 上传、预览、复制和删除始终使用新的 Bucket 上下文；
- 旧请求和旧上传管理器不会误操作原 Bucket。

第一版不提供跨 Bucket 复制或移动。复制和移动仍限定在当前 Bucket 内。

## 分享配置

分享链接不再包含 Account ID、Access Key ID 或 Secret Access Key。接收方需要自行配置账户凭据，避免把长期密钥放入 URL、浏览器历史或日志中。
