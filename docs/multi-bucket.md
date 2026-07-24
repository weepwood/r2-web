# 多 Bucket 使用说明

R2 Web 支持在同一个 Cloudflare R2 账户和同一组 S3 API 凭据下手动管理多个 Bucket。

## 添加 Bucket

1. 先按原有方式配置 Account ID、Access Key ID、Secret Access Key 和第一个 Bucket。
2. 进入文件管理界面后，点击右上角“设置”。
3. 切换到“R2 设置”页签，在“当前 Bucket”区域点击“添加 Bucket”。
4. 填写 Bucket 名称，可选填写显示名称、自定义域名和链接访问方式。
5. 点击“添加并切换”，页面刷新后开始使用新 Bucket。

顶部仍保留 Bucket 快速切换器，但添加、删除、连接测试和 CORS 配置都集中在设置页中。

删除操作只会删除浏览器中的本地配置，不会删除 Cloudflare R2 中的真实 Bucket。

## 界面说明

Bucket 管理复用原设置页的表单、按钮、间距和响应式布局，不再使用独立管理弹窗。

“R2 设置”页中包括：

- 当前 Bucket 选择器；
- 添加和删除 Bucket；
- 当前 Bucket 的名称、显示名称、自定义域名和链接访问方式；
- 连接测试；
- 根据当前网页 Origin 生成的推荐 CORS 配置。

显示名称只影响界面展示，不会修改 Cloudflare 中的真实 Bucket 名称。

## API Token 权限

配置 Bucket CORS 并不等于 API Token 自动拥有该 Bucket 的访问权限。

如果创建 R2 API Token 时选择了“仅指定 Bucket”，后来手动添加的新 Bucket 也必须加入该 Token 的授权范围。否则 R2 会返回 403；当错误响应没有通过 CORS 暴露给浏览器时，控制台可能只显示为跨域或 `Failed to fetch`。

多 Bucket 使用时，请确认当前 Access Key 对每个手动添加的 Bucket 都具备所需的读取或读写权限。

## CORS 配置

“R2 设置”中的“连接与跨域”区域会根据当前网页的 `window.location.origin` 生成推荐规则。Origin 必须精确匹配，例如：

- `https://example.com`
- `http://localhost:5500`

不要填写路径，也不要添加结尾斜杠。

当前版本使用查询参数完成 SigV4 签名，避免在普通 GET 请求中发送 `Authorization`、`x-amz-date` 等认证请求头，从而减少浏览器预检要求。推荐规则如下：

```json
[
  {
    "AllowedOrigins": ["https://example.com"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": [
      "Content-Type",
      "x-amz-copy-source",
      "x-amz-metadata-directive"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Type",
      "Last-Modified"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

注意：

- 自定义域名只用于公开文件链接，文件列表、上传、删除等管理操作仍访问 R2 S3 API 域名。
- CORS 修改可能需要等待片刻生效。
- 浏览器可能缓存旧的预检结果，修改规则后可重新打开浏览器或清除站点数据再测试。
- 若连接测试返回 403，优先检查 API Token 的 Bucket 授权范围，而不是继续放宽 CORS。

## 配置迁移

旧版单 Bucket 配置会在首次启动时自动迁移到 `schemaVersion: 2`，原有账户凭据、Bucket、自定义域名、上传设置和压缩设置都会保留。

## 切换行为

切换 Bucket 后页面会刷新。这是有意设计，用于确保：

- 文件列表和目录状态不会跨 Bucket 复用；
- 上传、预览、复制和删除始终使用新的 Bucket 上下文；
- 旧请求和旧上传管理器不会误操作原 Bucket。

当前版本不提供跨 Bucket 复制或移动。复制和移动仍限定在当前 Bucket 内。

## 分享配置

分享链接不包含 Account ID、Access Key ID 或 Secret Access Key。接收方需要自行配置账户凭据，避免把长期密钥放入 URL、浏览器历史或日志中。
