/**
 * Studio pacing helpers — reorder frames and set per-frame durations without
 * wiping rendered HTML. Pure so unit tests don't need a ProjectStore.
 *
 * Play order for export is `FrameRecord.order`. The content-graph is kept in
 * sync so the next writeFrameHtml / topoSort agrees with the strip.
 */

import type { ContentGraph, Edge } from '@html-video/content-graph';
import type { FrameRecord } from './types/index.js';

export const FRAME_DURATION_MIN_SEC = 0.5;
export const FRAME_DURATION_MAX_SEC = 60;

export function clampFrameDurationSec(raw: number): number {
  if (!Number.isFinite(raw)) return FRAME_DURATION_MIN_SEC;
  const rounded = Math.round(raw * 10) / 10; // 0.1s steps
  return Math.min(FRAME_DURATION_MAX_SEC, Math.max(FRAME_DURATION_MIN_SEC, rounded));
}

/**
 * Rebuild the graph so topoSort / node array order match `orderedIds`.
 * Keeps contrast edges; replaces sequence with a linear chain; drops
 * dependency edges (they would fight a user-chosen play order).
 */
export function reorderContentGraph(graph: ContentGraph, orderedIds: string[]): ContentGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (orderedIds.length !== graph.nodes.length) {
    throw new Error(
      `order length ${orderedIds.length} does not match node count ${graph.nodes.length}`,
    );
  }
  for (const id of orderedIds) {
    if (!byId.has(id)) throw new Error(`unknown node id "${id}"`);
  }
  const seen = new Set(orderedIds);
  if (seen.size !== orderedIds.length) {
    throw new Error('order contains duplicate node ids');
  }

  const nodes = orderedIds.map((id) => {
    const n = byId.get(id);
    if (!n) throw new Error(`unknown node id "${id}"`);
    return n;
  });
  const sequence: Edge[] = [];
  for (let i = 0; i < orderedIds.length - 1; i++) {
    const from = orderedIds[i];
    const to = orderedIds[i + 1];
    if (!from || !to) continue;
    sequence.push({ from, to, kind: 'sequence' });
  }
  const contrast = graph.edges.filter((e) => e.kind === 'contrast');
  return { ...graph, nodes, edges: [...sequence, ...contrast] };
}

/** Apply a new play order onto existing FrameRecords (HTML paths untouched). */
export function reorderFrameRecords(frames: FrameRecord[], orderedIds: string[]): FrameRecord[] {
  const byId = new Map(frames.map((f) => [f.graphNodeId, f]));
  if (orderedIds.length !== frames.length) {
    throw new Error(
      `order length ${orderedIds.length} does not match frame count ${frames.length}`,
    );
  }
  const out: FrameRecord[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!id) continue;
    const f = byId.get(id);
    if (!f) throw new Error(`unknown frame id "${id}"`);
    out.push({ ...f, order: i });
  }
  return out;
}

export function applyFrameDuration(
  graph: ContentGraph,
  frames: FrameRecord[],
  graphNodeId: string,
  durationSec: number,
): { graph: ContentGraph; frames: FrameRecord[]; durationSec: number } {
  const clamped = clampFrameDurationSec(durationSec);
  const nodeIdx = graph.nodes.findIndex((n) => n.id === graphNodeId);
  if (nodeIdx === -1) throw new Error(`unknown node id "${graphNodeId}"`);
  const frameIdx = frames.findIndex((f) => f.graphNodeId === graphNodeId);
  if (frameIdx === -1) throw new Error(`unknown frame id "${graphNodeId}"`);

  const nodes = graph.nodes.map((n, i) => (i === nodeIdx ? { ...n, durationSec: clamped } : n));
  const nextFrames = frames.map((f, i) => (i === frameIdx ? { ...f, durationSec: clamped } : f));
  return { graph: { ...graph, nodes }, frames: nextFrames, durationSec: clamped };
}
