/**
 * Native Remotion data-frame helpers (RFC-08 Phase 2).
 *
 * Content-graph data nodes use a free-form `data` blob. Native templates expect
 * slightly different shapes (items / points / axes). These helpers coerce the
 * common planner shape `{ items:[{label,value}] }` into whatever the chosen
 * native template needs — so the studio picker can offer all five templates
 * without re-planning the storyboard.
 */

import { HtmlVideoError } from './errors.js';

/** Default when the user opts into Remotion without picking a chart type. */
export const DEFAULT_NATIVE_TEMPLATE_ID = 'frame-data-rollup';

export type NativeSeriesPoint = { label: string; value: number };

export type NativeChartData = {
  title?: string;
  unit?: string;
  items?: NativeSeriesPoint[];
  points?: NativeSeriesPoint[];
  axes?: NativeSeriesPoint[];
  [key: string]: unknown;
};

/**
 * Pull a numeric series out of free-form node data. Accepts:
 *  - `{ items: [...] }` / `{ points: [...] }` / `{ axes: [...] }`
 *  - a bare `[{label,value}, ...]` array
 * Label aliases: `name`. Value aliases: `y`, `count`.
 */
export function extractNativeSeries(raw: unknown): {
  title?: string;
  unit?: string;
  series: NativeSeriesPoint[];
} {
  const asSeries = (arr: unknown): NativeSeriesPoint[] => {
    if (!Array.isArray(arr)) {
      throw new HtmlVideoError(
        'invalid-input',
        'Data frame has no series to animate; expected {items|points|axes:[{label,value}]}',
      );
    }
    const series = arr
      .map((it) => {
        const o = (it ?? {}) as Record<string, unknown>;
        const label = String(o.label ?? o.name ?? '');
        const value = Number(o.value ?? o.y ?? o.count);
        return { label, value };
      })
      .filter((it) => it.label !== '' && Number.isFinite(it.value));
    if (series.length === 0) {
      throw new HtmlVideoError(
        'invalid-input',
        'Data frame series had no usable {label, numeric value} pairs',
      );
    }
    return series;
  };

  if (Array.isArray(raw)) return { series: asSeries(raw) };
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = o.items ?? o.points ?? o.axes;
  const out: { title?: string; unit?: string; series: NativeSeriesPoint[] } = {
    series: asSeries(arr),
  };
  if (typeof o.title === 'string') out.title = o.title;
  if (typeof o.unit === 'string') out.unit = o.unit;
  return out;
}

/**
 * Coerce free-form data into the shape expected by a native Remotion template.
 * Shared fields (title/unit) are preserved; the series key matches the template.
 */
export function normalizeNativeData(raw: unknown, nativeTemplateId: string): NativeChartData {
  const { title, unit, series } = extractNativeSeries(raw);
  const base: NativeChartData = {};
  if (title !== undefined) base.title = title;
  if (unit !== undefined) base.unit = unit;

  switch (nativeTemplateId) {
    case 'frame-data-line':
      if (series.length < 2) {
        throw new HtmlVideoError(
          'invalid-input',
          `frame-data-line needs at least 2 points; got ${series.length}`,
        );
      }
      return { ...base, points: series };
    case 'frame-data-radar':
      return { ...base, axes: series };
    case 'frame-data-rollup':
    case 'frame-data-donut':
    case 'frame-data-hbars':
      return { ...base, items: series };
    default:
      // Unknown native id — keep items shape (most templates use it).
      return { ...base, items: series };
  }
}

/** True when a template id is one of the shipped native Remotion data charts. */
export function isKnownNativeTemplateId(id: string): boolean {
  return (
    id === 'frame-data-rollup' ||
    id === 'frame-data-donut' ||
    id === 'frame-data-hbars' ||
    id === 'frame-data-line' ||
    id === 'frame-data-radar'
  );
}
