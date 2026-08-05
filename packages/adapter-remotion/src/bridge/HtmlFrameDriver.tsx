// HtmlFrameDriver — RFC-08 §3.2 "time-driver injection".
//
// Renders an existing html-video HTML frame (passed inline as `html`) inside a
// Remotion composition via iframe `srcdoc`, and keeps its CSS / GSAP animation
// in sync with Remotion's deterministic frame clock. Without this, Remotion
// freezes its clock at frame N, screenshots, jumps to N+1 — but the iframe's CSS
// keyframes / GSAP run on the browser's own wall-clock, so each screenshot
// catches the animation at a random real-time point → flicker. We pause the
// iframe's clock and seek every animation to Remotion's current time per frame.
//
// Not compiled by the adapter's tsc; it's a static asset handed to Remotion's
// bundle() (webpack understands the JSX).
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';

export type HtmlFrameDriverProps = {
  /** The HTML frame's full source, inlined and rendered via iframe srcdoc. */
  html: string;
  width: number;
  height: number;
};

type GsapTimeline = { pause: () => void; time: (s?: number) => unknown };
type GsapWindow = Window & { gsap?: { globalTimeline?: GsapTimeline } };

/** Read the iframe's content document, or undefined if not reachable yet. */
function frameDoc(iframe: HTMLIFrameElement | null): Document | undefined {
  try {
    return iframe?.contentWindow?.document ?? undefined;
  } catch {
    return undefined; // cross-origin (shouldn't happen for srcdoc)
  }
}

/**
 * The srcdoc document is "ready to seek + screenshot" only when BOTH hold:
 *
 *  1. Content is parsed — `readyState === 'complete'` is NOT enough (an empty
 *     doc reports complete too, and seeking it silently no-ops). We require a
 *     populated body or ≥1 registered animation.
 *
 *  2. Web fonts / external stylesheets have settled — `doc.fonts.status ===
 *     'loaded'`. This is the one that actually caused the all-black render: a
 *     template with `<link href="fonts.googleapis.com/...">` keeps the iframe's
 *     render tree from painting until that external CSS resolves, so Remotion
 *     screenshots a fully black frame even though the DOM (opacity, etc.) is
 *     already correct. Waiting on fonts also kills FOUT (same idea as the
 *     hyperframes-side font-freeze fix). `fonts.status` starts 'loading' while
 *     any face/stylesheet is pending and flips to 'loaded' when all settle; a
 *     doc with no web fonts reports 'loaded' immediately.
 */
function docReady(doc: Document | undefined): boolean {
  if (!doc || !doc.body) return false;
  const hasAnims = (doc.getAnimations?.()?.length ?? 0) > 0;
  const hasBody = doc.body.innerHTML.trim().length > 0;
  if (!hasAnims && !hasBody) return false;
  // doc.fonts may be undefined in exotic engines — treat absence as ready.
  const fontsLoaded = (doc as Document & { fonts?: FontFaceSet }).fonts?.status !== 'loading';
  return fontsLoaded;
}

export const HtmlFrameDriver: React.FC<HtmlFrameDriverProps> = ({ html, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const tMs = (frame / fps) * 1000;

  const seek = useCallback((timeMs: number) => {
    const win = iframeRef.current?.contentWindow as GsapWindow | null | undefined;
    const doc = frameDoc(iframeRef.current);
    if (!win || !doc) return;

    // (A) CSS Animations / Web Animations API — pure CSS @keyframes.
    try {
      const anims = (doc.getAnimations?.() ?? []) as Animation[];
      for (const a of anims) {
        try {
          a.pause();
          a.currentTime = timeMs;
        } catch {
          /* idle/finished animation rejects currentTime — ignore */
        }
      }
    } catch {
      /* getAnimations unsupported — fall through */
    }

    // (B) GSAP global timeline.
    try {
      const tl = win.gsap?.globalTimeline;
      if (tl) {
        tl.pause();
        tl.time(timeMs / 1000);
      }
    } catch {
      /* no gsap — fine */
    }
  }, []);

  // Per-frame delayRender: Remotion captures each frame in its own pass, so the
  // bridge must hold *each* frame open until (1) the srcdoc document has truly
  // loaded its animations and (2) we've seeked them to this frame's time. The
  // earlier single-handle-on-mount version only synced the first frame; every
  // later frame screenshotted before the async re-seek landed → black output.
  //
  // We create a fresh handle for the current `tMs`, poll until the doc is ready,
  // seek, then continueRender. A short rAF settle lets the seeked styles paint
  // before Remotion screenshots. The handle is keyed to tMs so a new frame can't
  // clear a stale one.
  const [handle] = useState(() => delayRender('HTML frame seek @0ms'));
  const firstClearedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // For the very first frame we reuse the mount-time handle; subsequent frames
    // open their own so Remotion waits for each re-seek.
    const h = firstClearedRef.current
      ? delayRender(`HTML frame seek @${Math.round(tMs)}ms`)
      : handle;
    let tries = 0;
    const finish = () => {
      if (cancelled) return;
      seek(tMs);
      // One rAF so the seeked computed styles are committed before screenshot.
      requestAnimationFrame(() => {
        if (cancelled) return;
        firstClearedRef.current = true;
        continueRender(h);
      });
    };
    const tick = () => {
      if (cancelled) return;
      if (docReady(frameDoc(iframeRef.current)) || tries++ >= 200) {
        finish();
      } else {
        setTimeout(tick, 25);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tMs, seek]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      width={width}
      height={height}
      style={{ width, height, border: 'none', display: 'block' }}
      sandbox="allow-same-origin allow-scripts"
    />
  );
};
