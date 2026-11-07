# PosterWall 2.0：画布卡顿与交互动效重构

## 设计依据

对照 Folia 的 PosterWall 和独立 wall 引擎：
- https://github.com/chthollyphile/folia-major/blob/main/src/components/app/lattice/PosterWall.tsx
- https://github.com/chthollyphile/folia-major/tree/main/src/components/wall

参考其相机快速路径、可见实例上限、块内重排、镜头移动和海报入场波次的设计原则，独立实现代码；没有复制 AGPL-3.0 预生成的重排表或相关实现。这里不是一比一源码复刻。

## 卡顿根因与修复

原有相机帧需要扫描完整文件列表、更新磁贴 DOM、排序图片任务及计算状态；选中海报使用全局碰撞避让，计算量随文件数量增长很快。

本轮将相机渲染与结构更新拆开：逐帧只改变父画布 transform 与少量 HUD；只有视口逼近预留边界才触发结构重建。380px 预留裁剪区、110px 安全触发距离，减少重复裁剪。使用几何块索引直接查询邻近磁贴；同时最多挂载 180 个 tile。

点击海报时，只重新拼合当前 6×4 单元宏块。展开主海报占 4×3 单元，本块其余图片以确定性矩形分割填充剩余区域；块外图片保持原位，所有格子保留 6px 缝隙。FLIP 仅测量被影响的 7–8 张海报，镜头以 420ms 将焦点移向屏幕中心。原有可中断和 Reduced Motion 路径保留。

## 动效与操作

- 首屏加入一次性、左上至右下的海报落位波次；最多 48 张参与，其他图片直接显示。
- 去除永久 will-change 图层与逐卡 CSS filter，改用静态低对比背景及简单遮罩。
- 背景图保留空间关系；焦点海报更明显，操作入口展开后轻量出现。
- 普通滚轮平移，Ctrl/Alt + 滚轮以光标位置缩放；触控板连续小增量直接跟手。
- 鼠标拖拽、双指缩放、键盘和减少动态效果模式继续支持。

## 实测与限制

在 GitHub Actions 的模拟 R2/Chromium 场景中，240 张图片、连续 48 帧滚轮事件触发了 3 次完整 DOM 重排，最终挂载 98 个图片磁贴。额外使用 12,000/14,000 图片的纯计算测试检查局部重排与空间查询。浏览器 CI 的验收上限是 180 个可见磁贴、48 帧滚动少于 18 次结构重排。

这些是浏览器 DOM/几何层的指标，不代表真实图片解码、GPU FPS、Safari 表现或与 Folia 的直接性能比较；公开/私有 R2 的实际请求仍需手动测试。

## 代码与回归

- src/js/poster-wall-layout.js：独立的局部拼合算法
- src/js/poster-wall-visibility.js：空间索引、视口裁剪和数量上限
- src/js/poster-wall.js：相机、聚焦、渲染和任务更新分离
- src/css/poster-wall.css：波次入场、轻量聚焦暗化及静态空间光晕
- tests/poster-wall-perf.test.js：万级图片及局部无重叠测试
- tests/browser-smoke.mjs：240 图片 48 帧滚动性能模拟

## 待真实验收

真实 Bucket 大目录下，使用 Chrome Performance 记录滚动和焦点动效的长任务、FPS 与 GPU 内存；检查 4K 图像解码、低端 Windows 显卡、macOS Safari、移动触控和严格省流量模式。需要以真实数据继续迭代，不能把 CI 模拟测试等同于全部场景已流畅。