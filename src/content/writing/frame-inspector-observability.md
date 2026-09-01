---
translationKey: frame-inspector-observability
routeSlug: frame-inspector-observability
locale: zh-CN
title: Frame Inspector：GBuffer、Velocity 与帧级可观察性
description: 把 Render Pass、真实附件、格式、范围、last writer 和 frame index 组织成可查询证据，解释为什么调试视图是渲染系统的正式输出。
module: debugging
moduleOrder: 5
articleOrder: 1
level: intermediate
tags:
  - Frame Debugging
  - GBuffer
  - Velocity
  - Observability
prerequisites:
  - 了解延迟渲染与 Render Target
  - 熟悉深度、法线和屏幕空间速度的基本含义
learningOutcomes:
  - 能为每个帧附件定义格式、范围、writer 和失效条件
  - 能区分真实 GPU attachment、预计算截图与 Canvas 回退
  - 能用 Buffer 切换和冻结帧建立可复现的渲染诊断流程
relatedProjects:
  - engine-systems-explorer
  - real-time-rendering-lab
relatedDemos:
  - frame-inspector
  - render-graph
  - clustered-lighting
  - shadow-aa
relatedArticles:
  - render-graph-lifetime
  - shadow-temporal-aa
  - clustered-deferred-lighting
englishTitle: "Frame Inspector: GBuffer Attachments, Velocity, and Frame-Level Observability"
englishDescription: Treat formats, ranges, last writers, frame indices, and real attachments as first-class rendering evidence rather than decorative debug views.
publishedAt: 2026-08-31
updatedAt: 2026-08-31
draft: false
---

## Final 画面不是足够的调试接口

当最终画面出现黑块、拖影或高光错误时，问题可能来自材质输入、几何空间、资源格式、某个 Pass 没有写入、历史没有 reset，甚至只是 Tone Map 把 HDR 差异压平。只保留 Final 会迫使工程师从一个结果反推整个帧。

Frame Inspector 的目标不是复制 RenderDoc，而是在应用内部保留一组低成本、始终可用的帧级证据：当前附件是什么格式、数值表示什么、谁最后写入、属于哪一帧、能否冻结并与其他附件对照。

```text
Reference Scene
  → GBuffer
      ├─ Albedo + Metalness
      ├─ Normal + Roughness
      ├─ Linear Depth
      └─ Velocity
  → Deferred Lighting / SSAO
  → Temporal Resolve / History
  → Tone Map / Final
          ↓
      Frame Inspector
```

## 先建立 Attachment Contract

每个调试视图都应有结构化描述，而不是只给一张彩色图片。当前 Reference Frame 发布十个附件：

| 视图                | 格式                    | 约定范围                                                       | Last writer                          |
| ------------------- | ----------------------- | -------------------------------------------------------------- | ------------------------------------ |
| Final               | preferred Canvas format | display-referred                                               | Display / Tone Map                   |
| Albedo + Metalness  | `rgba8unorm`            | RGB `[0,1]`，A 为 metalness                                    | GBuffer                              |
| Normal + Roughness  | `rgba16float`           | world normal 编码到 `[0,1]`，A 为 roughness                    | GBuffer                              |
| Linear Depth        | `r32float`              | view distance / 12                                             | GBuffer                              |
| Velocity            | `rg16float`             | screen UV delta                                                | GBuffer                              |
| HDR Lighting        | `rgba16float`           | linear HDR                                                     | Deferred Lighting                    |
| SSAO                | `r8unorm`               | occlusion `[0,1]`                                              | SSAO                                 |
| TAA History         | `rgba16float`           | latest resolved linear HDR                                     | Temporal Resolve                     |
| History Reject      | `r8unorm`               | 1 = no history / UV bounds reject / depth reject; 0 = accepted | Temporal Resolve / Reject Mask       |
| Cluster Light Count | `r8unorm`               | normalized `[0,1]` = local proxy light count `[0,8]` / 8       | ReferenceFrame / Local Cluster Count |

这个表比缩略图更重要。它让 UI、Shader、测试和文章引用同一契约，也能在格式或 Pass 重构后暴露不一致。

## Packed Channel 必须可见

Albedo 的 alpha 存 Metalness，Normal 的 alpha 存 Roughness。如果 Inspector 只显示 RGB，用户会误以为自己已经检查了完整 GBuffer。当前显示 Shader 在右侧增加单通道条带，专门显示 packed alpha。

这是一条通用原则：调试显示不能静默丢弃数据。深度要明确是 device depth、linear depth 还是归一化 view distance；Velocity 要说明单位是像素、NDC 还是 UV；法线要说明存储空间和编码范围。

## Velocity 需要前后两套状态

Velocity 不是物体当前速度的世界空间向量，而是当前表面点在当前/上一帧投影后的屏幕 UV 差。Reference Frame 使用固定程序化相机，把当前与上一帧的世界点分别投影，并把两帧 Halton jitter 纳入同一约定；它没有把物体中心位移乘经验常数冒充像素运动。生产场景若允许相机移动，同样必须保存前一帧 view-projection 和 object transform。

排查 TAA 拖影时，先看 Velocity：

1. 静止相机与静止场景是否接近零；
2. 相机平移时背景方向是否一致；
3. 物体移动边界是否连续；
4. resize、相机切换或 reset 后是否出现一帧无效值；
5. jitter 是否被重复计入。

只有 Velocity 可以解释，History 重投影才值得继续检查。

## History 视图必须读取真实历史资源

一个常见“调试视图”错误是把 History 按钮接回 Final Texture，或把 Final 专用的 SSAO 调制写回历史。线性 HDR 仍需要一个明确的显示变换才能在普通屏幕上观察；关键是区分“被检查的源资源”和“仅用于显示的 visualization transform”。

当前 Inspector 的 History 分支读取 Temporal Resolve 最新写入的 `rgba16float` attachment，显示时执行 ACES 与 sRGB 编码，但不乘 Final 的 SSAO 调制；Last writer 因而仍是 Temporal Resolve，而屏幕上的显示像素由 Display Pass 生成。UI 同时报告 frame index，以及 History 是 `warming` 还是 `valid`。二者与 Final 观感相似，不代表它们是同一个资源。

## Freeze 的语义

Freeze 不应只停止 UI 标签更新，同时让底层 GPU 继续写同一附件；那会得到“看似冻结、实际变化”的证据。理想实现有两种：

- 停止 Reference Frame 的时间推进和提交；
- 把当前附件复制到独立 snapshot resource，再允许实时帧继续。

当前 Demo 采用停止时间推进的教学范围语义。冻结后切换视图，看到的是同一 frame index 的不同附件。生产工具若需要比较跨帧差异，应显式建立 snapshot 和资源预算。

## Pixel Probe 与 64-bin Histogram

当前 Inspector 已实现两项低频的真实 GPU readback。Pixel Probe 对点击位置的非 Final attachment 执行显式 texture-to-buffer copy，并按 attachment 的实际格式解码；Histogram 64 对完整 attachment 做低频 copy，再对采样像素分桶。HDR Lighting 与 TAA History 使用对数线性 HDR 亮度，Velocity 使用缩放后的 UV 幅值，其他 attachment 使用原值或 RGB luminance。

这两个工具不对 Final 或 Canvas fallback 伪造结果。Final 是浏览器显示 surface，Canvas atlas 不是 GPU attachment；两者都没有与 Reference Frame source texture 等价的可读来源。

## Last writer 如何连接 Render Graph

附件名称告诉我们“是什么”，last writer 告诉我们“从哪里来”。当 HDR Lighting 全黑时，可直接定位 Deferred Lighting；当 History 不更新时，定位 Temporal Resolve；当 Roughness 条带不对，定位 GBuffer。

在完整 Render Graph 中，last writer 应来自编译结果而不是手写字符串：每次资源写入创建版本，版本记录 producer，Inspector 选择附件时显示对应 Pass、生命周期和 usage。当前项目分别实现了 RenderGraphCore 与 Reference Frame，公开标签已经按同一命名约定对齐，但还没有把 GPU 资源句柄直接绑定到通用图编译器。这是明确的下一步，而不是已经完成的集成声明。

Cluster Heatmap 也遵守同一真实性边界：它仍只由独立的 Clustered / Deferred Lighting renderer 生成。Frame Inspector 的 Reference Frame 没有共享该 renderer 的 GPU device、texture 或 frame state。当前新增的 Cluster Light Count 是另一条明确的数据路径：Reference Frame 在 G-Buffer 后使用同一相机和 depth contract，把局部视锥量化为 8×5×8 Cluster，统计八个解析代理光源的相交数量并写入自身的 `r8unorm` texture。Pixel Probe 和 Histogram 64 读取该 texture；它不应被描述为独立 Clustered renderer 的输出。

## Fallback 必须诚实

无 WebGPU 时，Frame Inspector 使用确定性 Canvas attachment atlas。它保留视图名称、格式说明和交互，但不包含从 GPU 读取的真实生产 Buffer。页面必须明确标记 fallback，不能把预计算图集描述成实时 GBuffer。

同样，项目运行截图会记录浏览器、backend、尺寸和哈希。截图是一次运行的证据，不是当前访客设备的实时结果。

## 常见失败模式

- **格式与 Shader 声明不一致。** 例如把 `rg16float` 当成四通道读取，未定义通道被误用。
- **数值范围没有标准化。** Linear Depth 直接按米显示，远景全部白色。
- **packed alpha 被忽略。** Roughness/Metalness 错误无法在 Inspector 中出现。
- **last writer 手写后过期。** Pass 重命名或合并，UI 仍指向旧名称。
- **History 与 Final 共用显示分支。** 调试按钮存在，但资源来源错误。
- **freeze 只冻结文字。** frame index 不变，Texture 内容仍被覆盖。
- **device lost 后复用原 Canvas 的 2D context。** 已取得 WebGPU context 的 Canvas 不能安全切换类型，应挂载独立 fallback surface。

## 可复现实验

1. 打开 Frame Inspector，记录十个附件的格式、范围和 last writer，并在 Cluster Light Count 上确认归一化计数解释；
2. Freeze 后逐个切换，确认 frame index 不变；
3. 在 Normal 视图检查方向编码，在右侧条带检查 Roughness；
4. 移动相机，观察 Velocity 方向，再回到静止状态；
5. 切换 TAA 并 Reset，比较 HDR Lighting、History、History Reject 和 Final；
6. 在非 Final attachment 上启用 Pixel Probe，记录格式解码后的数值；
7. 运行 Histogram 64，确认其报告采样数与分桶解释；
8. 修改窗口尺寸，确认 History 失效并重建；
9. 在无 WebGPU 环境验证独立 Canvas fallback，原 WebGPU Canvas 被隐藏并在释放后恢复。

这些步骤不要求读取 GPU 到 CPU 的 sentinel 值。当前版本也没有把某个像素 readback 描述成已完成证据；若未来加入，应记录像素坐标、格式转换、提交序号和容差。

## 当前边界

Inspector 尚未提供 GPU capture 导出、跨帧 diff、通用 Render Graph 资源枚举或远程调试。Final 的实际格式来自运行时 `getPreferredCanvasFormat()`，而不是跨平台写死为 `bgra8unorm`。它证明的是更基础的能力：真实附件可被选择，格式与来源可见，History 不冒充 Final，History Reject 可被检查，packed channel 不被隐藏，fallback 不冒充 GPU 捕获。

## 参考资料

- [WebGPU Specification](https://www.w3.org/TR/webgpu/)
- [RenderDoc Documentation](https://renderdoc.org/docs/)
- [Temporal AA in Unreal Engine 4](https://advances.realtimerendering.com/s2014/epic/TemporalAA_small-5971869.pdf)
