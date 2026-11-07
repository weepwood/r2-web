# R2 Web 图片加载与 UI 方案（2026-11）

## 现有流程（改动前）

- `listObjects()`：通过 R2 的 S3 ListObjectsV2 获取目录列表，`PAGE_SIZE=300`；`FileExplorer` 将页面缓存于内存 5 分钟。
- `IntersectionObserver(rootMargin='120px')`：卡片接近可视区时才赋值图片 `src`，并设置原生 `loading='lazy'`。
- `getPublicUrl()`：公开 Bucket 走自定义域名；私有桶走 `getPresignedUrl()` 的 S3 GET。两者此前均指向**原始对象字节**。
- 用户点击预览时再调用 `headObject()`，并加载原图或对应媒体；并不使用图像缩小 API。
- 图片是否被浏览器缓存取决于响应 HTTP 缓存头、URL 和浏览器策略；原有项目没有独立的持久化缩略图库。

## 本次实现

### 三档策略（设置 → 偏好设置 → 图片加载策略）

| 模式 | 列表公开图片 | 列表私有图片 | 点击预览 |
|---|---|---|---|
| 智能小图（默认） | 优先 Cloudflare `/cdn-cgi/image/` 缩放；失败后回退原图 | 仍然使用原图的预签名 GET | 原图 |
| 严格省流量 | **仅请求** CDN 小图；失败显示占位图，绝不回退原图 | 显示占位图，**不请求原图** | 原图 |
| 兼容模式 | 原图 | 原图 | 原图 |

注意：严格模式不能给私有 Bucket 自动生成缩略图。若希望私有存储桶也走真正的小图，必须部署受保护的图片服务（见下一节），**不能简单把 S3 预签名 URL 转成公开缩略图 URL**。

### 公开 Bucket 需要的 Cloudflare 配置

1. R2 Bucket 绑定你拥有、已接入 Cloudflare 的自定义域名。
2. Cloudflare 控制台：`Images → Transformations`，在对应 Zone **启用图片转换**；检查需要的计费和配额。
3. R2 Web Bucket 配置选择“公开”，正确填写自定义域名。
4. 列表会请求形如：
   `https://img.example.com/cdn-cgi/image/width=480,quality=72,fit=scale-down,format=auto/path/photo.jpg`
5. Chrome DevTools → Network → Img：检查请求确实落在 `/cdn-cgi/image/`，其 `Content-Length`、`Content-Type`、`cf-cache-status` 和主图的大小。不同浏览器和接受格式的响应可能不同。
6. `format=auto` 根据浏览器支持交付 WebP/AVIF 等；为避免 CDN 变体爆炸，前端采用 160/320/480/640px 四档宽度（质量 72）。

**自动模式不是强保证。** 如果 Zone 未启用 Transformations，Cloudflare 小图可能失败，页面为了兼容会回退原图。若网络带宽是硬约束，请使用**严格模式**。

### 私有 Bucket 的后续正确架构

```text
浏览器 R2 Web
  ↓ 用户身份 / 授权后的缩略图请求
受保护 Cloudflare Worker
  ↓ 通过 R2 binding 读取原对象
Cloudflare Images binding
  ↓ 限制 width/quality/format，转换为 WebP/AVIF
Worker/Cloudflare Cache（仅在符合安全策略时缓存）
  ↓ 返回轻量缩略图
浏览器点击预览 → 单独请求有权限的原图
```

**访问控制是强制前提：** Worker 必须验证请求者是否有权访问指定 Bucket/key（例如 Cloudflare Access + 服务端用户资源授权），不能仅凭 URL 中的 `key` 公开返回私有内容，也不能把包含 API Secret 的 URL 交给 Worker。私有资产绝不能跨用户错误共享缓存。只有建立完备鉴权后，才应让私有图片从该 Worker 加载。

参考官方文档：
- [Cloudflare Images — image transformations](https://developers.cloudflare.com/images/optimization/transformations/overview/)
- [Cloudflare R2 + Image Resizing 架构](https://developers.cloudflare.com/reference-architecture/diagrams/content-delivery/optimizing-image-delivery-with-cloudflare-image-resizing-and-r2/)
- [Images binding 用于 R2 私有对象](https://developers.cloudflare.com/images/optimization/binding/)
- [Cloudflare R2 公共 Bucket 与自定义域名缓存](https://developers.cloudflare.com/r2/buckets/public-buckets/)

## 缓存与性能

- **元数据：** 原有 5 分钟内存缓存，依旧只缓存 `ListObjects` 结果。
- **图片：** Cloudflare Images 负责边缘变体缓存；浏览器 HTTP 缓存仍由服务器响应策略决定。
- **预签名 URL：** 同一个 `R2Client` 实例内存中缓存最多 300 个、3 分钟内复用，重建客户端或修改对象时清理相关 URL，不持久化到磁盘。
- **请求调度：** 仅可视区附近的图片排队；同时最多 4 个图片加载任务；界面导航、排序和刷新会丢弃上一轮待加载任务。
- **原图：** 预览保持原有按需加载机制。原图依然可能很大；若需要“预览先加载中图，点击 100% 再取原图”，可以再扩展第二级预览尺寸。
- **隐私：** 本次**不**把私有图像字节默认放入 IndexedDB/CacheStorage。浏览器可能按原有 HTTP 头写入自身缓存，这是浏览器行为，与本项目的显式持久化缓存不同。

## UI 参考与落地

| 产品 | 值得参考的交互 | R2 Web 实施策略 |
|---|---|---|
| [Immich](https://github.com/immich-app/immich) | 小图与预览资源分级；图片画廊优先 | 不把 150px 卡片替换成完整 10MB 原图 |
| [Filestash](https://github.com/mickael-kerjean/filestash) | 专业文件管理器的轻量操作区、可替换的图片后端 | 设置中显式选择图片加载后端策略 |
| [Cloudreve](https://github.com/cloudreve/Cloudreve) | 文件预览、传输任务的清晰状态反馈 | 每张缩略图有稳定占位和错误反馈 |

当前 UI 在上一轮已经重构过导航、工作台、文件卡片、设置与上传面板；本轮重点补上**图片获取的真实传输优化**，并增加小图模式状态提示、柔和加载占位。没有直接复刻这些项目的受版权保护素材或代码。

## 验收清单

- 公共 R2 + 已开启 Transformations：列表请求 `/cdn-cgi/image`，点击预览再请求原图。
- 公共 R2 + 未开启 Transformations：智能模式可回退原图；严格模式显示错误占位，不额外加载原图。
- 私有 R2：智能/兼容模式仍通过预签名 GET；严格模式列表不下载原图，但点击预览可正常加载。
- 含空格、中文和嵌套目录的 key 正确编码。
- 320px / 768px / 桌面，网格、列表、深浅色、不同紧凑度。
- 快速切换文件夹、搜索过滤、刷新、排序，图片不会使用上一个视图的失效队列。
- 改变 Bucket 或凭据时不会复用旧签名 URL；重命名/删除/替换后不会复用旧的对应签名 URL。
- 保留 R2 上传、下载、移动、删除、预览语义。

本次没有凭据进行真实 R2 图片网络链路和跨浏览器端到端验证，需使用真实 Cloudflare Zone 检查响应大小和缓存头。

- **取消失效请求：** 目录切换、刷新、排序与筛选变化时取消尚未完成的图片请求并释放槽位，避免旧页面慢请求阻塞新页面。
