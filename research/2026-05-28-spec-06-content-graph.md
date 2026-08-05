# RFC-06：Content Graph（多帧故事板中间表示）

> **Status**: Accepted v1（与 `@html-video/content-graph` `schemaVersion: 1` 对齐）
> **Date**: 2026-05-28（起草）· 2026-08-05（收拢为正式稿）
> **Depends on**: [RFC-05 Project-centric](./2026-05-27-spec-05-project-centric.md)（若存在）/ [RFC-02 Template Metadata](./2026-05-26-spec-02-template-metadata.md)
> **Rationale source**: [Understand-Anything takeaways](./2026-05-28-understand-anything-takeaways.md)（#1 中间 JSON、#4 图先再 sort）
> **Implementation**: `packages/content-graph` · CLI `project-set-graph` / `project-write-frame` · Studio agent 双块协议

---

## 0. 为什么需要 Content Graph

多帧视频若直接让 agent「一次吐 N 段 HTML」，会有三类问题：

1. **顺序不可解释** — 教学/对比/因果关系埋在散文里，换风格就要重聊。
2. **局部改动成本高** — 改一个数据点容易误伤其它帧（见 Studio #23 迭代修复）。
3. **引擎无关性弱** — HTML 已绑死某一渲染路径，无法先定「讲什么」再定「怎么画」。

Content Graph 把「讲什么」落成可校验、可 topo-sort、可 diff 的 JSON。**渲染层（HTML / Remotion native）与内容层解耦**：同一 graph 可换模板、可按帧 `enhanceFrameNative`，也可只改 `durationSec`（`--preserve-frames`）。

单帧 fast path **不强制**建 graph；Studio / CLI 在多场景（explainer / promo / comparison）时走本 RFC。

---

## 1. Schema（v1）

```ts
interface ContentGraph {
  schemaVersion: 1;
  intent: 'single-frame' | 'explainer' | 'data-viz' | 'promo' | 'comparison' | 'other';
  synopsis?: string;
  nodes: Array<EntityNode | DataNode | TextNode>;
  edges: Array<{
    from: string;
    to: string;
    kind: 'sequence' | 'contrast' | 'dependency';
    reason?: string;
  }>;
}
```

### 1.1 Nodes

| `kind` | 必填字段 | 用途 |
|---|---|---|
| `text` | `text: string` | 标题 / 金句 / 段落 |
| `data` | `data: unknown` | 结构化数据；native Remotion 增强要求可归一的 series（见 §5） |
| `entity` | `props: Record<string, unknown>` | 品牌 / logo / 实体属性 |

公共可选字段（`BaseNode`）：

- `id` — 稳定、可读（如 `intro`、`stat_users`）；HTML 块标签与此对齐
- `label` — UI 短名；缺省回落 `id`
- `frameIntent` — 自由提示（`intro` / `data-bar` / `outro` / …），供 composer 选模板
- `durationSec` — 帧时长；缺省 **3s**（`DEFAULT_FRAME_DURATION_SEC`）

### 1.2 Edges（语义分层）

| `kind` | 排序作用 | 给 composer 的含义 |
|---|---|---|
| `dependency` | **硬约束** — 参与拓扑排序；环则 `validate` 失败 | B 依赖 A 先建立的概念 |
| `sequence` | **软偏好** — 同 indegree 时优先 A 在 B 前 | 叙事递进 / 时间线 |
| `contrast` | **不参与排序** | 前后对比、左右分屏等布局线索 |

---

## 2. 校验与播放顺序

### 2.1 `validate(graph)`

收集（尽量一轮反馈）错误码：

| code | 含义 |
|---|---|
| `empty-graph` | 无节点 |
| `duplicate-node-id` | id 重复 |
| `invalid-kind` | kind 非 entity/data/text |
| `self-edge` | from === to |
| `edge-from-unknown-node` / `edge-to-unknown-node` | 边端点不存在 |
| `cycle` | **dependency** 边成环 |

实现：`packages/content-graph/src/index.ts`。

### 2.2 `topoSort(graph)`

1. 仅用 `dependency` 建邻接与入度（Kahn）。
2. 就绪集内用 `sequence` 打破平局（避免选「sequence 后继」）。
3. 再平局则按 **nodes 数组原始顺序**（确定性）。
4. 若输出长度 ≠ 节点数 → 防御性抛错（调用方应先 `validate`）。

### 2.3 `totalDurationSec(graph)`

沿 `topoSort` 顺序累加 `durationSec ?? 3`。导出 MP4 时 core 以帧记录时长为准；多帧 hyperframes 路径使用 `durationMode: 'explicit'`，避免探测动画无限延长（见 PR #25）。

---

## 3. Agent / Studio 双块协议

与 CLI 生命周期等价；Studio 在一轮回复里解析：

```
```json#content-graph
{ "schemaVersion": 1, "intent": "explainer", "synopsis": "…", "nodes": […], "edges": […] }
```

```html#<nodeId>
<!doctype html>…</html>
```
```

规则：

1. **恰好一个** `json#content-graph` 块。
2. **每个 node 一个** `html#<nodeId>` 块；`nodeId` 必须 ∈ `nodes[].id`。
3. 块之间无散文要求（Studio 仍会剥除多余 prose）。
4. 无 graph 块 → 回落单帧 / 旧 preview.html 路径（v0.7 兼容）。

Server 侧：`writeContentGraph` + 按 id `writeFrameHtml`。  
CLI 侧：

```bash
html-video project-set-graph $ID --graph-file storyboard.json
html-video project-write-frame $ID --node <id> --html-file frames/<id>.html
html-video project-set-graph $ID --graph-file updated.json --preserve-frames  # 只改节奏/边，保留 HTML
```

权威 agent 入口：根目录 [`SKILL.md`](../SKILL.md)。

---

## 4. 与 Project / 导出的关系

- Project 持有 `contentGraphPath` + `frames[]`（每帧 `htmlPath`、可选 `engine` / `nativeTemplateId` / `data`）。
- 播放顺序 = `topoSort(graph)`（或与 frames 记录对齐的已物化顺序）。
- **混引擎 concat**：异引擎段必须用 ffmpeg **concat filter**（重建 PTS），禁止 concat demuxer + 重编码（见 RFC-08 / CLAUDE 会话笔记）。同引擎可 `-c copy` demuxer。

---

## 5. Data 节点与 Remotion native 增强

`kind: 'data'` 的 `data` 在 v1 **故意宽松**（任意 JSON）。挂 native 模板时，core 会归一，例如 rollup：

```json
{ "title": "…", "unit": "K", "items": [{ "label": "A", "value": 10 }] }
```

别名 `points` / `axes` 由 CLI/core 映射到目标模板。  
仅 data 帧可 `project-enhance-frame`；`unenhance` 清引擎字段、**不删** `htmlPath`（非破坏）。

原生模板列表：`html-video list-native-templates`（当前：rollup / donut / hbars / line / radar）。

---

## 6. 非目标（v1 不做）

- Studio graph **可视化编辑**（拖节点 / 加边）— viewer 只读；改 pacing 走 CLI 或后续 RFC。
- 强制多 agent pipeline（intent-parser / structure-builder 等）— 仍可单模型双块输出。
- Audience-adaptive 二次渲染（Understand-Anything #5）— 保留为后续。

---

## 7. 一致性检查清单（改协议时）

- [ ] `packages/content-graph` 类型 + `validate` / `topoSort` / 测试
- [ ] `packages/content-graph/README.md` 摘要与本 RFC 同步
- [ ] Studio prompt（`studio-server.ts` 多帧骨架）与 CLI `SKILL.md`
- [ ] Smoke / `project-frames` 测试覆盖 set-graph + write-frame
- [ ] 本文 `schemaVersion` 与代码字面量一致；破坏性变更升 `schemaVersion` 并写迁移

---

## 8. 参考

- Package API：`@html-video/content-graph`
- Remotion 按帧增强：RFC-08 / RFC-09
- 模板署名与命名：RFC-07
