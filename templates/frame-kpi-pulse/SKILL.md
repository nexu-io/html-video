---
name: frame-kpi-pulse
zh_name: "KPI 脉冲帧"
en_name: "KPI Pulse Frame"
description: "Native Remotion single-metric hero — spring scale, count-up, accent ring."
category: video
tags: ["kpi", "remotion", "native", "count-up", "pulse"]
---

【模板: KPI Pulse】
【意图】单一关键指标动效增强（非多系列图表）。挂到 content-graph 的 `data` 节点。

【数据】
```json
{ "title": "Local render", "label": "per-clip fee", "value": 0, "unit": "¢", "caption": "…" }
```
也接受 `{ items: [{ label, value }] }`（取第一项）。

【CLI】
```bash
html-video project-enhance-frame $ID --node stats --native-template frame-kpi-pulse
```
