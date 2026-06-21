# RFC-11：Footage Pipeline（吃真实素材 → 剪辑 + 字幕 + 动效浮层 + 合成 → 成片；把"剪辑即文本"做成一等能力）

> **Status**: Draft v0.2（v0.1 只覆盖 footage-edit；v0.2 升级为**完整管线北极星图**。Phase-0 已实现+验证，见 §6 + poc-findings）
> **Date**: 2026-06-11
> **Scope**: 给 html-video 增加**第二条入口管线**——从原始录像出发，把它**剪成片，并把 html-video 本来就会生成的 HTML/Remotion 动效图形 + 字幕，按转录时间戳合成进真实画面**。全程剪辑决策以文本/JSON/代码存在，agent 可读、可 diff、可重渲。
> **设计参照**: Thariq Shihipar（Anthropic Claude Code 团队）的公开案例 deck *"How Fable Edited Its Own Launch Video"*（https://thariqs.github.io/cc-video-editing-deck/，2026-06）。本 RFC 把那套手搓 repo 流程**产品化**成 html-video 的一等能力。
> **依赖**: RFC-01（Engine Adapter）/ RFC-02（Template metadata）/ RFC-06（Content Graph）/ RFC-08（Remotion adapter）/ RFC-09（multi-engine UX）
> **决策**: Joey 2026-06-11 拍板"**把 deck 这一整套能力（剪辑/字幕/动效配置/把动效融入视频）融入 html-video**"。Phase-0 已做；本文先把整套蓝图锁定，再逐阶段实现。

---

## 0. 为什么是现在做（动机）

html-video 当前命题是 **"video as code"**：agent 选 engine + 模板，把 prompt / 文章 / repo **合成**为多帧动画视频（**Synthesis 路径**，已端到端跑通）。

但真实世界里另一半、更高频的视频工作是"**把已有素材剪成片，并叠上动效图形和字幕**"——口播、demo 录屏、采访、发布会。Thariq 的 deck 证明了三件对 html-video 极关键的事：

1. **"剪辑即文本"是真命题、有高可信背书。** 整个剪辑 = 一个 repo：`transcripts/*.json`（逐词时间戳）+ `final-edit.json`（EDL，含每个选择的书面理由）+ `luts/*.cube`（调色）+ Remotion 组件（图形）+ `anim.tsx`（全局动效旋钮）+ `FinalEdit.tsx`（字幕/浮层按词定时的 cue sheet）。"the edit is text, so Claude can read it, diff it, and re-render it." —— 跟 html-video 内核是同一句话。
2. **deck 的后半段就是 html-video 的现成强项。** PNG→参数化 JSX 组件 = 我们的原生 Remotion 模板；全局 timing 旋钮 = 模板 inputProps；按词定时的字幕/浮层 = transcript 驱动的 cue。**html-video 本来就会"生成 HTML/Remotion 动效画面"——deck 的"动效+字幕"层我们已经有引擎，缺的只是把它接到真实素材上的"合成 + 定时"那层胶水。**
3. **它今天是一次性手搓 repo，没有产品。** 没有可复用的 EDL/cue schema、没有 ingest/转录抽象、没有跨引擎浮层合成、没有 studio UI。这正是 meta-layer 该填的空位。

**一句话动机**：html-video = "合成动效画面"的引擎；本 RFC 把它升级成 **"造 + 剪 + 把动效/字幕合成进真实视频" 的完整管线**——底层=你的真实录像，上层=html-video 本来就会生成的 HTML/Remotion 动效与字幕，**转录把两者对齐，ffmpeg 合成成片**。

---

## 1. deck 完整管线（12 步）与"两个半场"

| # | deck 步骤 | 半场 |
|---|---|---|
| 1 | 转录所有 take（Whisper，逐词时间戳） | 前半：吃素材 |
| 2 | 每场 subagent 选最佳 take + verifier | 前半 |
| 3 | EDL（final-edit.json）：候选/in-out/书面理由 | 前半 |
| 4 | ffmpeg 帧精确切 + 拼 → 粗剪 | 前半 |
| 5 | 重新转录成片自检（"zero ums"） | 前半 |
| 6 | **字幕 / lower-third / 图形：PNG → 参数化 Remotion 组件** | **后半：动效（html-video 已有引擎）** |
| 7 | **全局动效配置：anim.tsx 6 个 timing 旋钮** | 后半 |
| 8 | **cue sheet：浮层/字幕按转录词时间戳出现（FinalEdit.tsx）** | 后半 |
| 9 | **把浮层合成进真实画面（alpha overlay）** | 后半（新胶水） |
| 10 | 调色：手写 .cube LUT，ffmpeg 套用 | 后半 |
| 11 | Figma MCP 往返 design review | 后半（可选） |
| 12 | `npx remotion render` + 截图自检 | 后半 |

**前半 = 全新**（html-video 此前完全没有素材入口）；**后半 = 大部分已有**（html-video 的动效引擎），缺"合成 + 字幕定时 + 全局配置面"的胶水。

---

## 2. 整套能力 → html-video 现状映射（reuse vs build）

| deck 能力 | html-video 现状 | 工作量 |
|---|---|---|
| 一句 prompt 启动 + `/goal 不出片不停` | studio agent 编排 + runtime agent defs | ♻️ 复用 |
| 转录（逐词时间戳） | —— | ✅ **Phase-0 已建**：`SourceAdapter` + `adapter-whisper`(whisper.cpp 本机) |
| 选 take + 书面理由 | —— | ✅ **Phase-0 已建**：`core.selectTake`/`buildFootageGraph` |
| EDL（候选/in-out/理由） | content-graph 泛化承载 | ✅ **Phase-0 已建**：`footage` NodeKind |
| 帧精确切 + 拼 | core concat-filter | ✅ **Phase-0 已建**：`core.cutClip`/`concatClips` |
| 重转录自检 | —— | ✅ **Phase-0 已建**：CLI `footage-edit` verify 段 |
| **字幕**（按词出现） | `EngineCapabilities.subtitles` 字段早留好 | 🆕 转录→字幕块→cue（burn-in / sidecar / 渲成动效字幕组件） |
| **HTML/动效图形浮层** | 🟡 **已有引擎**：`adapter-remotion` + 原生模板（`frame-data-rollup`） | 🆕 让它出 **alpha** + 当"浮层"用 |
| **全局动效配置**（anim 旋钮） | 🟡 已有：模板 inputProps | 🆕 统一 `MotionConfig`，跨浮层共享 |
| **cue sheet**（浮层卡在某词上） | 转录已有词时间戳 | 🆕 `Cue`：把浮层节点绑到时间线某时刻 |
| **把图形/字幕融入视频**（合成） | `OutputFormat:'webm-alpha'` 已支持 | 🆕 `core.compositeOverlay`（ffmpeg overlay 滤镜） |
| 调色 .cube | —— | 🆕 `core.applyLut`（ffmpeg lut3d） |
| Figma 往返 | OD 生态有 Figma MCP 经验 | 🆕 Phase-3（可选） |
| headless 渲染 + 截图自检 | adapter render + 量像素 | ♻️ 复用 |

**结论**：12 步里 **5 步 Phase-0 已落**、**3 步复用现有引擎**、**4 步新建胶水**（字幕定时 / alpha 浮层 / 合成 / 调色）。新建集中、互相高内聚。

---

## 3. 北极星架构：分层时间线（Layered Timeline）

Synthesis 与 Footage 在"**时间线上一串有序 segment**"上同构。要叠动效/字幕，再加一层"**覆盖层**"概念。

### 3.1 底层时间线（base track）—— 已有 / Phase-0
一串有序节点，每个 segment 来源二选一：
- **合成节点**（entity/data/text）→ engine 渲染模板帧（Synthesis，已有）
- **footage 节点**（RFC-11）→ ffmpeg 从真实素材切一段（Phase-0 已建）

`sequence` 边 + topoSort 排播放顺序。**一条 graph 可混含两类节点** → 天然支持"真人口播段 + 纯动效转场"混剪。

### 3.2 覆盖层（overlay layer）—— 新建（Phase-1/2）
字幕、lower-third、数据浮层**不进 base 顺序**，而是**绑到 base 时间线的某个时间窗**，叠在画面上层。模型 = **Cue**（对齐 deck 的 `FinalEdit.tsx` CUES 数组）：

```ts
export interface Cue {
  /** 要叠的覆盖节点 id（一个 text/data 节点，由现有引擎渲成 alpha 浮层） */
  overlayNodeId: string;
  /** 出现时刻：绝对秒，或锚到某 base 段 + 段内偏移（cut 后仍稳） */
  at: number | { baseNodeId: string; offsetSec: number };
  /** 持续秒 */
  durSec: number;
  /** 叠放轨道 / 层级（多个浮层共存时定 z 序与避让） */
  track?: number;
  /** 锚定来源：转录里哪个词触发的（可追溯，对齐 deck "grep 词时间戳定位"） */
  anchorWord?: { clipAssetId: string; wordIndex: number };
}
```

**定时来源 = 转录词时间戳**：agent/工具在转录里 grep 到目标短语 → 取其 start → 设 `at`。这就是 deck "no timeline scrubbing, Claude greps the word timestamps" 的产品化。

### 3.3 字幕（subtitles）—— 新建（Phase-1）
转录 → 按行长/停顿切成字幕块 → 三种出口（capability 已留 `subtitles: ('none'|'burn-in'|'sidecar')[]`）：
- **sidecar**：导出 `.srt`/`.vtt`（最简，零依赖）
- **渲成动效字幕组件**（推荐、最 on-brand）：每块字幕 = 一个 text 覆盖节点 + cue，由现有引擎渲成 alpha 浮层合成 → 字幕本身就是"HTML 动效"，天然带入场动画、可换样式
- **burn-in**：ffmpeg 烧字（注意 §7 风险：brew ffmpeg 无 `drawtext`/`libass` 时此路不通，故推荐走动效字幕组件）

### 3.4 合成（compositing）—— 新建（Phase-1）
core 新原语（与 `concatClips` 同层）：

```
core/src/footage.ts （扩展）
  compositeOverlay(basePath, overlays: {path,atSec,durSec,x,y,track}[], outPath)
    // ffmpeg overlay 滤镜链：每个 alpha 浮层在其 [at, at+dur] 窗口叠到 base 上
  applyLut(basePath, cubePath, outPath)   // ffmpeg lut3d（Phase-2）
```

覆盖节点渲成 **alpha**：`adapter-remotion` 出 `webm-alpha`（vp9 alpha）/ prores4444；`adapter-hyperframes` 走 Playwright `omitBackground` 截透明。两引擎都能产 alpha 浮层。

### 3.5 全局动效配置（MotionConfig）—— 新建（Phase-2）
对齐 deck `anim.tsx`："6 个数字驱动全片动效，'做快一点'=改一行"。项目级共享配置，作为 inputProps 注入所有覆盖模板：

```ts
export interface MotionConfig {
  revealFrames?: number;     // 元素入场
  staggerFrames?: number;    // 同级间隔
  overlayInFrames?: number;  // 浮层滑入
  overlayOutFrames?: number; // 淡出
  easing?: string;           // 如 'cubic-bezier(0.16,1,0.3,1)'
  fps?: number;
}
```

### 3.6 SourceAdapter —— 已有 / Phase-0
ingest 侧与 `EngineAdapter` 对称：把原始 take 转成时间编码的转录。默认 `whisper-local`（本机、免费）；云 ASR adapter 暴露 `licensing` 供 agent 在"免费/隐私"场景避开。

### 3.7 EDL = content-graph 投影
不另造文件格式：EDL = "footage 节点 + sequence 边 + rationale + cues" 的 content-graph。复用 topoSort，混剪/覆盖统一在一棵图里。

---

## 4. 端到端目标管线

```
takes/*.mov ─ingest→ assets[](video)
        │
   SourceAdapter.transcribe (whisper-local, 词时间戳)   ←✅Phase-0
        ▼
   transcripts/<clip>.json
        │
   take-selection（每场 subagent 选 + 写 rationale）    ←✅Phase-0
        ▼
   content-graph.json  ── base: footage 节点 + sequence 边           可读可diff
        │                  └ overlays: text/data 节点 + cues（绑词时间戳） ←🆕P1/2
        │
   core.cutClip×N + concatClips ──▶ 粗剪 baseCut.mp4    ←✅Phase-0
        │
   SourceAdapter.transcribe(baseCut) → 比对脚本自检       ←✅Phase-0
        │
   ┌────┴───────── 覆盖层（🆕P1/2）─────────┐
   │ 字幕块/数据浮层 = 覆盖节点              │
   │  → 现有引擎渲成 webm-alpha 浮层（MotionConfig 注入）│
   │  → core.compositeOverlay 按 cue 叠到 baseCut 上    │
   └────┬───────────────────────────────────┘
        │  [🆕P2] core.applyLut 调色
        ▼
   final.mp4 (+ soundtrack 复用 RFC-09 音频 mux)
```

---

## 5. 关键 schema 增量

- ✅ `FootageNode`（已建）：clipAssetId / in / out / firstWords / candidateClipAssetIds / selectionRationale
- ✅ `Transcript` / `TranscriptWord` / `SourceAdapter`（已建）
- 🆕 `Cue`（§3.2）：覆盖节点 → 时间窗，锚到词时间戳
- 🆕 `ContentGraph.cues?: Cue[]`：图上挂一组覆盖 cue（base 节点走 sequence，覆盖节点走 cues，互不入序）
- 🆕 `MotionConfig`（§3.5）：项目级全局动效旋钮
- 🆕 `SubtitleChunk`：{ startSec, endSec, text }（转录切块产物，可转 sidecar 或覆盖节点）

---

## 6. 分阶段交付

> 原则：每个 phase 独立可发布；Phase-0 单独已讲完"剪辑即文本"故事。

### ✅ Phase 0 — 素材 → 转录 → 选片 → EDL → 粗剪 → 自检（已实现）
落地：`content-graph` 加 `footage` 节点；`core` 加 `SourceAdapter`/`SourceRegistry`/`footage.ts`(选片+cut+concat)；新包 `adapter-whisper`（whisper.cpp 本机）；CLI `footage-edit`；6 单测；合成素材端到端 `clean:true`。详见 `2026-06-11-spec-11-poc-findings.md`。
**遗留待补**（findings 暴露）：① ASR 语言/模型选择（auto 可能误判致幻觉，需显式 language + 幻觉短语 warning + 中文用 ≥small 模型）；② **单文件内按句切**（transcript-span 级，单 take 场景需要，Phase-0 以整文件为 take）。

### Phase 1 — 字幕 + 浮层合成（接通"把动效融进真实视频"的核心卖点）
- 转录 → `SubtitleChunk[]` → 渲成 alpha 动效字幕浮层（+ sidecar 导出兜底）。
- `Cue` 模型 + 覆盖节点渲 alpha（adapter-remotion `webm-alpha` / hyperframes omitBackground）。
- `core.compositeOverlay`（ffmpeg overlay）把字幕/一个数据浮层按 cue 叠到 baseCut。
- **验收**：真人口播片段上，字幕逐句精确卡在口播词上 + 一个 lower-third 浮层在指定词出现。**这一步让"真实素材 × 我们的动效引擎"1+1>2。**

### Phase 2 — 完整 cue sheet + 全局动效配置 + 段内切 + 调色
- 多浮层 cue sheet（按词定时、轨道避让）；`MotionConfig` 全局旋钮注入所有浮层。
- 单文件内 transcript-span 级切（补 Phase-0 遗留②）。
- `core.applyLut`（lut3d）应用 `.cube`；可选 agent 生成 grade 候选。
- 选片正式化：每场 subagent + verifier 双层。

### Phase 3 —（可选）studio UI + Figma 往返
- studio 加 Footage 项目类型：传 takes → 看转录 → 调 EDL/cue（拖 in/out、移浮层）→ 看合成预览。
- Figma MCP 导出浮层组件做 design review，改完导回（deck step 6-8）。优先级最低。

---

## 7. 事实核对（2026-06-11）

| 假设 | 核对 |
|---|---|
| 本机逐词转录、免费 | ✅ whisper.cpp 本地跑，word timestamps；**但语言/模型要选对**——base 在中文上会幻觉成英文（findings 实测），中文用 ≥small + 显式 `-l zh` |
| ffmpeg 帧精确切 + 重建时间轴拼 | ✅ Phase-0 已实测，混流必须 concat-filter |
| 覆盖浮层可带 alpha 合成 | ✅ `webm-alpha` 已在 OutputFormat；Remotion 出 vp9-alpha/prores4444；hyperframes 走 Playwright `omitBackground`；ffmpeg `overlay` 按时间窗叠 |
| 浮层组件可参数化、按帧定时 | ✅ 原生模板范式（`frame-data-rollup`，inputProps 驱动 interpolate/spring） |
| 字幕烧录 | ⚠️ ffmpeg `drawtext`/`subtitles(libass)` **brew 版可能没链**（本机实测 `drawtext` 不可用）→ **推荐走"动效字幕组件"路径**，sidecar `.srt/.vtt` 作兜底，burn-in 仅在 ffmpeg 带 libass 时 |
| .cube LUT | ✅ ffmpeg `lut3d` 滤镜 |
| content-graph 承载分层时间线 | ✅ base 走 sequence+topoSort，overlay 走 cues 不入序，加节点种类 + cues 字段即可 |

来源：deck https://thariqs.github.io/cc-video-editing-deck/ · whisper.cpp https://github.com/ggml-org/whisper.cpp · ffmpeg filters（overlay/concat/lut3d/subtitles）https://ffmpeg.org/ffmpeg-filters.html · 本项目混流 concat + drawtext 缺失 + 中文幻觉教训见 poc-findings + CLAUDE.md

---

## 8. 风险与边界

- **转录质量决定一切下游**（选片/字幕/cue 全靠时间戳）。语言/模型误判会整段幻觉（findings 实测）。缓解：显式 language + 重转录自检兜底 + 适配模型档位。
- **大文件**：原片不进 git/.md，assets 只存路径 + metadata。
- **字幕烧录依赖 ffmpeg 构建**：brew 版常缺 drawtext/libass → 默认走动效字幕组件，不赌 ffmpeg 字体能力。
- **调色（P2）是深水区**：先做"应用用户给的 .cube"，"生成 LUT"作加分项不作承诺。
- **范围蔓延**：用分阶段划清；Phase-0 已是单独可发布最小集。
- **studio 交互不要污染 Synthesis**：Footage 是新项目类型，复用后端但 UI 独立入口（6/6 教训）。

---

## 9. 对外叙事价值

- README/launch 强叙事：**"Not just generate video — edit your real footage, and weave your animated HTML graphics + captions right into it, all timed to what's said."** 配 deck 同款可信度（"0 video editors opened"）。
- 四件套一致：本机 whisper + 本机 ffmpeg + 开源引擎 = 零云依赖剪辑/合成。
- 拉开 vs Hyperframes：HF 是"HTML→视频"单一合成；html-video 变成"造 + 剪 + 把动效合成进真实视频"的完整 meta-layer。

---

## 10. 需 Joey 拍板的开放问题

1. **Phase-1 优先级确认**：字幕 + 浮层合成是"融入"最可见的一步，建议作为 Phase-0 之后的下一刀。
2. **字幕默认走"动效字幕组件"**（而非赌 ffmpeg burn-in）——确认这个方向？
3. **Cue 定时锚**：默认锚到"base 段 + 段内偏移"（cut 后仍稳）而非绝对秒——确认？
4. **Phase-0 代码何时开 PR**：已验证完整，可先合进 main 再叠 Phase-1（避免一个超大 PR）。
5. 本 RFC 仍是 research/ 草稿，未 commit。

---

> Draft v0.2 · research/ 草稿，未 commit。Phase-0 代码在 `feat/footage-edit` 分支（未提交）。
