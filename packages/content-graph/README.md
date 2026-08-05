# @html-video/content-graph

Structured intermediate representation produced by the agent's first round and consumed by the second round to render HTML frame sequences.

See [RFC-06](../../research/2026-05-28-spec-06-content-graph.md) for the full spec, and
`research/2026-05-28-understand-anything-takeaways.md` (#1 content-graph, #4 graph-then-sort)
for the design rationale.

## Schema

```ts
interface ContentGraph {
  schemaVersion: 1;
  intent: 'single-frame' | 'explainer' | 'data-viz' | 'promo' | 'comparison' | 'other';
  synopsis?: string;
  nodes: Array<EntityNode | DataNode | TextNode>;
  edges: Array<{ from: string; to: string; kind: 'sequence' | 'contrast' | 'dependency'; reason?: string }>;
}
```

- **dependency edges** are hard constraints (topo sort).
- **sequence edges** are soft preferences (tie-break order between independent nodes).
- **contrast edges** carry semantics for the frame composer (does not affect order).

## API

```ts
import { validate, topoSort, totalDurationSec } from '@html-video/content-graph';

const result = validate(graph);
if (!result.ok) throw new Error(result.errors[0].message);

const playOrder = topoSort(graph); // string[] of node ids
const totalSec = totalDurationSec(graph);
```
