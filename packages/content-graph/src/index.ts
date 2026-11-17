/**
 * @html-video/content-graph — RFC-06.
 *
 * Structured intermediate representation produced by the agent's first round,
 * consumed by the second round to render HTML frame sequences.
 *
 * See research/2026-05-28-understand-anything-takeaways.md (#1 content-graph,
 * #4 graph-then-sort) for the design rationale.
 */

export type NodeKind = 'entity' | 'data' | 'text' | 'footage';

export interface BaseNode {
  /** Stable id; agent picks readable strings like "intro_logo", "stat_users". */
  id: string;
  kind: NodeKind;
  /**
   * Short label for UI (graph view). Optional — falls back to id.
   */
  label?: string;
  /**
   * Optional intent hint for the frame composer:
   *   "intro" / "data-bar" / "image-pan" / "quote" / "outro" / "list" / ...
   * Free-form; the frame-composer agent maps it to template choice.
   */
  frameIntent?: string;
  /**
   * Suggested duration in seconds for this frame. Defaults to 3s if absent.
   */
  durationSec?: number;
}

export interface EntityNode extends BaseNode {
  kind: 'entity';
  /**
   * Free-form props for branding entities (logo path, brand color, etc).
   * The frame-composer reads these to seed the HTML.
   */
  props: Record<string, unknown>;
}

export interface DataNode extends BaseNode {
  kind: 'data';
  /**
   * Concrete data points to visualise: numbers, percentages, time series.
   * Schema is permissive — any JSON the composer can render.
   */
  data: unknown;
}

export interface TextNode extends BaseNode {
  kind: 'text';
  /**
   * Headline / quote / caption / paragraph copy.
   */
  text: string;
}

/**
 * RFC-11: a segment cut from real footage. Unlike entity/data/text nodes (which
 * are *synthesised* into HTML frames), a footage node points at a take in the
 * project's assets and an in/out range to cut from it. A content-graph may mix
 * footage and synthesised nodes — that is how "talking-head + data overlay"
 * edits are expressed in a single timeline.
 *
 * The footage node is also the unit of the EDL ("edit decision list"): it
 * carries the takes that were *considered* and the written reasoning for the
 * pick, so the edit stays diffable text the agent can read and re-decide.
 */
export interface FootageNode extends BaseNode {
  kind: 'footage';
  /** asset.id of the chosen take (type 'video'). */
  clipAssetId: string;
  /** Frame-accurate in/out points in the source clip, seconds. */
  in: number;
  out: number;
  /** First few spoken words of the kept segment — human-readable sanity check. */
  firstWords?: string;
  /** asset.ids of the other takes considered for this scene (the EDL trail). */
  candidateClipAssetIds?: string[];
  /** Why this take was picked over the others — the "edit is text" rationale. */
  selectionRationale?: string;
}

export type Node = EntityNode | DataNode | TextNode | FootageNode;

export type EdgeKind = 'sequence' | 'contrast' | 'dependency';

export interface Edge {
  /** Source node id */
  from: string;
  /** Target node id */
  to: string;
  kind: EdgeKind;
  /**
   * Optional human-readable reason ("contrasts before/after", "depends on
   * concept introduced in B"). Helps the frame-composer pick layout cues.
   */
  reason?: string;
}

export interface ContentGraph {
  /** Schema version. v1 = this RFC-06 draft. */
  schemaVersion: 1;
  /**
   * High-level intent classification. Steers the frame-composer:
   *   - "single-frame": short brand/title card; collapse to one frame.
   *   - "explainer":   teach a concept; honour dependency edges.
   *   - "data-viz":    walk through numbers; sequence edges drive order.
   *   - "promo":       pacy social-cut style.
   *   - "comparison":  before/after; contrast edges drive layout.
   */
  intent:
    | 'single-frame'
    | 'explainer'
    | 'data-viz'
    | 'promo'
    | 'comparison'
    | 'other';
  /**
   * One-line synopsis the agent writes for itself / the user. Shown in
   * studio's graph view as the "what is this video about?" header.
   */
  synopsis?: string;
  nodes: Node[];
  edges: Edge[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface GraphValidationError {
  code:
    | 'duplicate-node-id'
    | 'edge-from-unknown-node'
    | 'edge-to-unknown-node'
    | 'self-edge'
    | 'cycle'
    | 'empty-graph'
    | 'invalid-kind'
    | 'invalid-footage';
  message: string;
  /** Offending node or edge for UI highlighting. */
  ref?: string;
}

export interface GraphValidationResult {
  ok: boolean;
  errors: GraphValidationError[];
  warnings: GraphValidationError[];
}

/**
 * Validate a ContentGraph. Stops at the first cycle (reports it) but collects
 * all other errors so the agent gets one round-trip of feedback.
 */
export function validate(graph: ContentGraph): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const warnings: GraphValidationError[] = [];

  if (!graph.nodes || graph.nodes.length === 0) {
    errors.push({ code: 'empty-graph', message: 'Graph has no nodes' });
    return { ok: false, errors, warnings };
  }

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) {
      errors.push({
        code: 'duplicate-node-id',
        message: `Duplicate node id "${n.id}"`,
        ref: n.id,
      });
    }
    ids.add(n.id);
    const kind = (n as { kind: string }).kind;
    if (kind !== 'entity' && kind !== 'data' && kind !== 'text' && kind !== 'footage') {
      errors.push({
        code: 'invalid-kind',
        message: `Node "${(n as { id: string }).id}" has unknown kind "${kind}"`,
        ref: (n as { id: string }).id,
      });
    }
    if (kind === 'footage') {
      const f = n as FootageNode;
      if (!f.clipAssetId) {
        errors.push({
          code: 'invalid-footage',
          message: `Footage node "${f.id}" is missing clipAssetId`,
          ref: f.id,
        });
      }
      if (!(f.out > f.in) || f.in < 0) {
        errors.push({
          code: 'invalid-footage',
          message: `Footage node "${f.id}" has an invalid in/out range (${f.in} → ${f.out})`,
          ref: f.id,
        });
      }
    }
  }

  for (const e of graph.edges) {
    if (e.from === e.to) {
      errors.push({
        code: 'self-edge',
        message: `Edge ${e.from} → ${e.to} is a self-edge`,
        ref: `${e.from}->${e.to}`,
      });
    }
    if (!ids.has(e.from)) {
      errors.push({
        code: 'edge-from-unknown-node',
        message: `Edge from unknown node "${e.from}"`,
        ref: `${e.from}->${e.to}`,
      });
    }
    if (!ids.has(e.to)) {
      errors.push({
        code: 'edge-to-unknown-node',
        message: `Edge to unknown node "${e.to}"`,
        ref: `${e.from}->${e.to}`,
      });
    }
  }

  // Cycle detection on dependency edges (the only kind that constrains order).
  const cycleNode = findDependencyCycle(graph);
  if (cycleNode) {
    errors.push({
      code: 'cycle',
      message: `Dependency cycle detected involving node "${cycleNode}"`,
      ref: cycleNode,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Topo sort
// ---------------------------------------------------------------------------

/**
 * Linearise the graph into a frame play order.
 *
 * Algorithm:
 *   1. Build dependency adjacency (only "dependency" edges constrain order).
 *   2. Kahn topological sort; ties broken by sequence-edge order, else by
 *      original node array order.
 *
 * Returns node ids in playback order. Throws on cycle (callers should validate
 * first; this is a defensive throw).
 */
export function topoSort(graph: ContentGraph): string[] {
  const indeg = new Map<string, number>();
  const deps = new Map<string, string[]>(); // from -> to (unblocks)
  const nodeOrder = new Map<string, number>();
  graph.nodes.forEach((n, i) => {
    indeg.set(n.id, 0);
    deps.set(n.id, []);
    nodeOrder.set(n.id, i);
  });
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') continue;
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    deps.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  // Sequence edges as a soft preference: if A->B (sequence) and both indeg=0,
  // prefer A before B.
  const seqAfter = new Map<string, Set<string>>(); // node -> nodes that should come after
  for (const e of graph.edges) {
    if (e.kind !== 'sequence') continue;
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    if (!seqAfter.has(e.from)) seqAfter.set(e.from, new Set());
    seqAfter.get(e.from)!.add(e.to);
  }

  const ready: string[] = [];
  for (const [id, d] of indeg) if (d === 0) ready.push(id);
  // Stable sort by original node order so output is deterministic
  ready.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));

  const out: string[] = [];
  while (ready.length > 0) {
    // Pick the ready node that:
    //   1. is NOT a "sequence successor" of any other ready node, and
    //   2. earliest in original order among the survivors.
    let pickIdx = 0;
    for (let i = 0; i < ready.length; i++) {
      const cand = ready[i]!;
      const blockedBySequence = ready.some(
        (other) => other !== cand && seqAfter.get(other)?.has(cand),
      );
      if (!blockedBySequence) {
        pickIdx = i;
        break;
      }
    }
    const next = ready.splice(pickIdx, 1)[0]!;
    out.push(next);
    for (const succ of deps.get(next) ?? []) {
      indeg.set(succ, (indeg.get(succ) ?? 1) - 1);
      if (indeg.get(succ) === 0) {
        // Insert maintaining original-order stability
        const ord = nodeOrder.get(succ) ?? 0;
        let insertAt = ready.length;
        for (let i = 0; i < ready.length; i++) {
          if ((nodeOrder.get(ready[i]!) ?? 0) > ord) {
            insertAt = i;
            break;
          }
        }
        ready.splice(insertAt, 0, succ);
      }
    }
  }

  if (out.length !== graph.nodes.length) {
    throw new Error(
      `topoSort: cycle detected (sorted ${out.length} of ${graph.nodes.length} nodes)`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findDependencyCycle(graph: ContentGraph): string | null {
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') continue;
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  const stack: { id: string; iter: Iterator<string> }[] = [];
  for (const start of adj.keys()) {
    if (color.get(start) !== WHITE) continue;
    color.set(start, GRAY);
    stack.push({ id: start, iter: adj.get(start)![Symbol.iterator]() });
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const next = top.iter.next();
      if (next.done) {
        color.set(top.id, BLACK);
        stack.pop();
      } else {
        const c = color.get(next.value);
        if (c === GRAY) return next.value;
        if (c === WHITE) {
          color.set(next.value, GRAY);
          stack.push({ id: next.value, iter: adj.get(next.value)![Symbol.iterator]() });
        }
      }
    }
  }
  return null;
}

/**
 * Look up a node by id. Returns undefined if missing — callers handle.
 */
export function getNode(graph: ContentGraph, id: string): Node | undefined {
  return graph.nodes.find((n) => n.id === id);
}

/**
 * Default per-frame duration when a node doesn't set one.
 */
export const DEFAULT_FRAME_DURATION_SEC = 3;

/**
 * Compute total video duration by summing per-frame durations along the
 * topo-sorted play order.
 */
export function totalDurationSec(graph: ContentGraph): number {
  const order = topoSort(graph);
  let total = 0;
  for (const id of order) {
    const n = getNode(graph, id);
    if (n?.kind === 'footage') {
      // A footage node plays for its cut length; durationSec, if set, overrides.
      total += n.durationSec ?? (n as FootageNode).out - (n as FootageNode).in;
    } else {
      total += n?.durationSec ?? DEFAULT_FRAME_DURATION_SEC;
    }
  }
  return total;
}
