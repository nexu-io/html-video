# RFC-07：PPT Skill → Hyperframes 模板 转换规范

> **Status**: Draft v0.1
> **Date**: 2026-06-04
> **Depends on**: [RFC-02 Template Metadata](./2026-05-26-spec-02-template-metadata.md)
> **Scope**: 把开源的 PPT / 演示设计 skill（如 huashu-design、frontend-slides）系统化地
> 转成可用的 hyperframes 视频模板的标准流程 —— 覆盖许可、三层署名、命名、转换质量、查重、交付。

---

## 为什么要这套规范

市面上**专门为 hyperframes 做的视频模板极少**，但有大量开源的 **PPT / slides 设计 skill**
（它们本身又是在致敬真实设计工作室的风格）。把这些静态设计 skill 转成动态视频模板，是
html-video 扩充模板库最现实的路径。

但这条路径有真实的诚信风险，2026-06-04 的一次 audit 暴露了三个问题（见
[provenance-audit](../notes/2026-06-04-provenance-audit.md)）：

1. 署名链条缺层 —— 只认了 skill 作者，没认最上游真实工作室；或反过来直接挪用工作室名当模板名。
2. "original / no source copied" 是自我宣称，从未核实。
3. 连示例数据都照搬上游，且新模板与已有模板视觉撞车（漏了查重）。

本规范就是把"PPT skill → 视频模板"这件事**标准化**，让每一次转换都署名清楚、转换到位、不重复。

---

## 转换流程总览（6 步，每步都有硬门槛）

```
①准入&许可闸 → ②三层署名 → ③命名 → ④转换质量 → ⑤查重 → ⑥交付清单
```

任何一步不过，**不入库**。

---

## ① 准入 & 许可闸（License Gate）

- **只收明确开源许可**：MIT / Apache-2.0 / BSD / CC-BY / CC-BY-SA。
  - ❌ 拒收：无 LICENSE 文件、CC-BY-**NC**（禁商用，html-video 要商用）、CC-**ND**（禁演绎）、
    All Rights Reserved、仅"可参考"无许可的。
- **必须拉真实 LICENSE 核实**，不信 yaml / README 的自述：
  ```bash
  git clone --depth 1 <upstream-url> /tmp/upstream-check
  cat /tmp/upstream-check/LICENSE   # 确认许可类型 + 真实版权人姓名
  ```
- 记下 **真实版权人姓名**（不是 repo 名）。例：huashu-design 的版权人是 `alchaincyf（花叔 · 花生）`，
  frontend-slides 是 `Zara Zhang`。

## ② 三层署名标准（强制，本规范的核心）

设计风格往往经过两次转手才到我们手里。署名必须把**每一层都认全**：

| 层 | 是谁 | 例 |
|---|---|---|
| **L1 原始灵感** | 真实设计工作室 / 设计师 | Pentagram（Michael Bierut）/ Build studio / Takram |
| **L2 Skill 层** | 把 L1 提炼成可复用开源资产的作者 | huashu-design（alchaincyf 花叔）/ frontend-slides（Zara Zhang） |
| **L3 我们** | 转成 hyperframes 视频模板 | nexu-io |

> **为什么 L2 必须单独署名**：skill 作者做了"真实工作室 → 可复用 HTML"的一层转化，
> 我们是**从他们那层转过来的**，不是直接从工作室转的。跳过 L2 = 抹掉了我们实际站的肩膀。

**provenance schema（写进 `template.html-video.yaml`）：**

```yaml
provenance:
  # L1 — 原始设计灵感（真实世界）
  origin:
    name: Pentagram (Michael Bierut)
    kind: design-studio
    reference: "pentagram.com / hillary clinton logo system"   # 可查的指引，非必须 URL
  # L2 — 我们实际转化自的开源 skill（必填，许可以这层为准）
  via_skill:
    name: huashu-design
    author: "alchaincyf (花叔 · 花生)"
    url: https://github.com/alchaincyf/huashu-design
    license: MIT
    source_file: assets/showcases/ppt/ppt-pentagram.html   # 具体参照的那个文件
  # L3 — 本模板做了什么转化
  transformation: >
    Static PPT page → animated hyperframes timeline (CSS/SVG @keyframes).
    Re-colored, re-typed, original sample data. No upstream source code copied verbatim.
```

`NOTICE.md` / 根 `ATTRIBUTIONS.md` 汇总所有上游 + 许可（Apache-2.0 NOTICE 要求）。

## ③ 命名规范

- **禁止直接拿真实工作室 / 设计师名当模板 id 或显示名。**
  - ❌ `frame-pentagram-stat`、`Takram Radar`、`Build Minimal`
  - ✅ 用**描述设计特征**的中性名：`frame-editorial-anchor`、`frame-soft-radar`、`frame-luxe-minimal`
- 理由：① 避免暗示"官方授权 / 联名"的误导；② L2 上游 huashu 自己的文档就明确告诫
  *"❌ 不要直接写 in the style of Pentagram → ✅ 用具体设计特征描述"* —— 我们更该遵守。
- 工作室名只出现在 `provenance.origin.name`（事实陈述：受其启发），不出现在面向用户的名字里。

## ④ 转换质量门槛（什么算"转化"，而非"换皮"）

至少满足全部 3 条，才算合格的视频模板转换：

1. **必须新增动效时间线** —— 静态页 → 真实的 CSS/SVG/GSAP `@keyframes` 时间线
   （元素分阶段入场、数字升起、图形绘制等）。这是核心增值，没有动效就不是视频模板。
2. **示例数据必须自有** —— ❌ 不照搬上游的占位数据（如 `95.7 / 73.8 / AIME / SWE-bench`），
   换成 html-video / nexu 语境的自有示例。
3. **可辨识的再设计** —— 配色 / 字体 / 版式至少做一处有意识的再设计，不 100% 像素级照抄。
   （若上游配色就是该工作室的标志性识别色 —— 如 Pentagram 红 —— 可保留，但要在
   `transformation` 里说明"保留标志色"。）

## ⑤ 内部查重（2026-06-04 漏掉的那一步）

新模板入库前，跟**同 L2 来源**的已有模板比对，防止"同一套皮做 N 个变体"：

- 比对维度：字体 / 核心配色 / body 底色 / 输入 schema（`required` 字段）/ 版式骨架。
- 判定：
  - 视觉语言相同 **且** 输入 schema 也几乎相同 → **重复，拒收或合并**。
  - 视觉语言相同 **但** 用途/输入明显不同（如"单数字大字报" vs "三指标对比榜"）→ 可收，
    但必须在描述里写清差异，且**示例数据不得雷同**。
- 快速比对脚本思路（配色 + 字体 + required 字段）见 audit note 里的 Python 片段。

## ⑥ 交付清单（每个模板必交）

```
templates/frame-<descriptive-name>/
├── template.html-video.yaml   # 含 ② 的三层 provenance
├── source/index.html          # 含 ④ 的动效时间线 + 自有示例数据
├── SKILL.md                   # agent 用的填参说明
├── example.md                 # 示例输入
└── preview.png                # 首帧静图（poster）—— studio 之外（README/官网）的展示兜底
```

**关于"默认渲染效果"**：studio 预览弹窗已用 `mode:'iframe'` 实时跑 `source/index.html` 的动画，
**用户在 studio 里能直接看到动效**，无需额外产出 loop 视频。`preview.png` 仅用于 studio 之外
（GitHub README / 官网 / 分享卡片）的静态兜底。schema 预留的 `preview.loop` 字段当前不强制填，
未来若要在 studio 外展示动效再补。

---

## 落地：用本规范回头修现有模板

现有 6 个声明了 provenance 的模板需按本规范整改（见 audit note 清单）：

| 现 id | L1 工作室 | L2 skill | 整改 |
|---|---|---|---|
| ~~frame-pentagram-stat~~ → **`frame-editorial-anchor`** | Pentagram (Bierut) | huashu-design | ✅ 2026-08-05 重命名 + 自有示例 |
| ~~frame-build-minimal~~ → **`frame-luxe-minimal`** | Build studio | huashu-design | ✅ 2026-08-05 重命名 + 自有示例 |
| ~~frame-takram-organic~~ → **`frame-soft-radar`** | Takram | huashu-design | ✅ 2026-08-05 重命名 + 自有示例 |
| frame-bold-signal | — | frontend-slides (Zara Zhang) | ✅ 三层署名（无需改 id） |
| frame-creative-voltage | — | frontend-slides | ✅ 同上 |
| frame-electric-studio | — | frontend-slides | ✅ 同上 |

huashu 三件套重命名已于 2026-08-05 落地；frontend-slides 三件套 id 保持不变。

---

## 附：一句话 checklist（每次转 PPT skill 时对照）

- [ ] 拉了真实 LICENSE，确认可商用 + 演绎
- [ ] provenance 三层都填了（origin / via_skill+真实作者 / transformation）
- [ ] 模板名是设计特征描述，没挪用工作室名
- [ ] 有真实动效时间线
- [ ] 示例数据是自有的，没照搬上游
- [ ] 跟同来源已有模板查过重，不撞车
- [ ] 交付物齐：yaml + source + SKILL.md + example + preview.png
- [ ] 根 ATTRIBUTIONS.md / NOTICE.md 已登记上游
