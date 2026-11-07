# R2 Web 第一阶段基础改造 — 安全、可靠性与图片资源服务

> 本阶段在 PR #7 内实施。目标是降低下一阶段开发私有缩略图、全局索引和大文件传输时的技术风险，不将尚未实现的能力描述为已完成。

## 1. 配置分享安全

- 配置分享导出通过 `src/js/shared-config.js` 的显式字段白名单序列化，不再使用整个配置对象展开。
- 排除 R2 `accountId`、`accessKeyId`、`secretAccessKey`、自定义 S3 `endpoint`、Tinify `tinifyKey`，以及未来新增的未知字段。
- 同一个白名单应用于 **新旧分享链接导入**，不信任输入声称的 `shareType`；不会恢复链接携带的密钥。
- 导入时保留当前设备已有的 R2 凭据与 Tinify Key；没有本地凭据的新设备需重新输入才能连接。
- 清理地址栏中的 `config` 参数，即使导入失败也会清理；网页添加 `referrer=no-referrer` 限制浏览器导航时泄漏当前地址。
- 四语言分享提示改为：链接不包含凭据，但含 Bucket 名和自定义域名，仍需谨慎分享。

**残余风险与后续**：个人直连模式中，用户主动保存的 R2 长期凭据目前仍存放在浏览器 `localStorage`，没有变成端到端安全的多用户认证系统。本轮无法撤销**过去已经被分享或记录过的旧链接**。若旧链接曾含敏感密钥，应到对应服务轮换这些密钥。公网多人使用应升级为有身份验证的 Worker 代理和服务端受限凭据，不能仅靠客户端隐藏字段。

## 2. 文件操作可靠性

- `src/js/file-operation-guards.js` 对复制/移动单个或批量文件夹进行源路径、同路径和子目录冲突检查。
- 递归操作不再把 `CommonPrefixes` 当作一定存在的 R2 对象。客户端返回 `hasFolderMarker`，仅当 `Contents/Key` 与前缀一致时才复制/删除目录标记对象。
- `CopyObject` 响应除 HTTP 状态外，还检查 XML 是否包含嵌入的 S3 `Error/Code`，有异常时抛错，避免报告成功并继续删除源文件。
- 移动依然遵循 **复制成功后再删除源文件**，且 R2 不提供跨多对象原子事务。网络中断后的部分成功可能需要人工处理，本轮没有假称实现完整自动回滚。
- 回归覆盖自复制、相似但不同的目录名、虚拟目录标记和嵌入式复制错误。

## 3. 图片加载架构统一

`src/js/image-asset-service.js` 现在承担：

- `thumbnailPlan(key, width, dpr)`：返回统一的 CDN 小图计划、严格模式和原图回退许可；不直接请求私有原图。
- `originalUrl(key)`：明确触发完整原图 URL 的解析接口，供主动预览和允许原图回退时使用。

`FileExplorer`、`PosterWall` 和 `FilePreview` 共同使用这一服务，缩略图宽度分档和安全策略仍由 `thumbnail-utils.js` 负责。

本轮**未**接入私有 Bucket Worker 图片代理，也**未**替换原有预览 UX 为中图模式；这需要后续独立实现身份授权、变体缓存与原图回退设计。

## 4. 真正的浏览器测试

- `tests/browser-smoke.mjs` 使用 Node 标准模块启动临时静态服务器和 Chromium，通过 Chrome DevTools Protocol 操作真实页面。
- 测试预置虚构的本地 R2 配置，在页面运行前 Mock S3 `ListObjectsV2`/HEAD，不读取真实 R2 凭据或对象。
- 验证：登录态连接 → 文件列表 → PosterWall 打开 → 缩放 → 磁贴展开 → 原图预览 → 退出。
- CI 在已有 Node 单测和 TypeScript/JSDoc 检查之外新增独立 `browser` Job：`browser-actions/setup-chrome@v2`。
- 本机可用 `CHROME_PATH=/usr/bin/chromium pnpm test:browser` 运行。测试需要浏览器正常加载项目原有的外部 ESM 资源；CI 网络策略仍需留意。

## 5. 下一阶段及验收门槛

需要独立迭代和明确部署权限的功能：

1. 支持私有 R2 的 Worker + Images binding 缩略图服务、用户级身份授权和缓存隔离。
2. 带大小阈值、分级预览和原图 100% 操作的完整媒体资源管线。
3. S3 Multipart Upload、取消、重试、恢复和真实传输字节统计。
4. R2 对象元数据索引（D1/Queues）与跨目录搜索；索引与 R2 对象必须具备重建和对账能力。
5. 图片相册、收藏、标签、重复文件检测与 PosterWall 场景保存。

这些功能不应依赖真实密钥写入 GitHub CI 或测试代码。用户现有的 R2 Bucket 不需要为这次 P0 改动进行迁移。
