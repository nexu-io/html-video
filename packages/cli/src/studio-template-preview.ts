/**
 * Studio template gallery preview helpers (iframe + composition player injection).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplateMetadata } from '@html-video/core';

/**
 * Decide how the gallery should preview a template. Both self-contained
 * entries and multi-composition entries now render live in an iframe: the
 * latter get an injected composition player (see injectCompositionPlayer) that
 * assembles the sub-comps and plays their timelines, so 'iframe' is the right
 * mode for everything that has a readable entry.
 *
 * `posterUrl` is still surfaced (when the poster file exists) so the frontend
 * can fall back to a static poster if the live iframe ever fails to render.
 */
export function templatePreviewMode(t: TemplateMetadata): {
  mode: 'iframe' | 'poster';
  posterUrl: string | null;
} {
  const posterRel = t.preview?.poster;
  const posterPath = posterRel && t.__dir ? join(t.__dir, posterRel) : null;
  const posterUrl =
    posterPath && existsSync(posterPath) ? `/template-asset/${t.id}/${posterRel}` : null;
  return { mode: 'iframe', posterUrl };
}

/**
 * Inject a minimal client-side composition player into a multi-comp entry
 * HTML so the studio preview shows live motion instead of a blank iframe.
 *
 * Hyperframes templates declare their scenes as `<div data-composition-src=
 * "compositions/x.html">` placeholders; each composition file is a `<template>`
 * wrapping markup + <style> + a <script> that registers a paused GSAP timeline
 * on `window.__timelines[name]`. The real (v0.9) renderer assembles these for
 * frame-accurate export; this player is a lightweight stand-in that just makes
 * the preview move:
 *   1. swap the two known placeholders so nothing 404s / NaNs,
 *   2. fetch each composition (relative to /template-asset/<id>/), graft its
 *      <template>.content into the placeholder div, and re-run its scripts
 *      (cloned <script> nodes never execute on their own),
 *   3. once every timeline has registered, play them all on a loop.
 * Templates on disk are untouched — this is a serve-time transform only.
 */
export function injectCompositionPlayer(html: string): string {
  // 15s is a sane default duration for the preview loop; __VIDEO_SRC__ has no
  // real asset in-repo, so point it at an empty data URI to avoid a 404 fetch.
  let out = html
    .replace(/__VIDEO_DURATION__/g, '15')
    .replace(/__VIDEO_SRC__/g, 'data:video/mp4;base64,');

  // The entry's own inline scripts assign window.__timelines["background"]
  // etc. before the entry ever initialises the registry — in the real HF
  // runtime the player defines it first. Mirror that: seed the registry in
  // <head> so those early assignments don't throw on an undefined object.
  const seed = '<script>window.__timelines = window.__timelines || {};</script>';
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${seed}`);
  } else {
    out = `${seed}\n${out}`;
  }

  const player = `
<script>
(function () {
  function reexec(root) {
    // Cloned/innerHTML'd <script> nodes don't run — recreate them so each
    // composition's timeline-registration IIFE actually executes. Skip the
    // external gsap CDN tag: the entry already loaded gsap synchronously, and
    // re-adding it would race (async load) ahead of the inline IIFE that calls
    // gsap.timeline() right after it.
    root.querySelectorAll('script').forEach(function (old) {
      if (old.src) { old.parentNode.removeChild(old); return; }
      var s = document.createElement('script');
      // Each composition's inline script declares top-level \`const tl = ...\`.
      // Re-injecting several into the shared global scope collides ("tl has
      // already been declared"). Wrap each in its own block so those locals
      // stay private; window.__timelines assignments still escape the block.
      s.textContent = '{\\n' + old.textContent + '\\n}';
      old.parentNode.replaceChild(s, old);
    });
  }
  async function mountOne(host) {
    var src = host.getAttribute('data-composition-src');
    if (!src) return;
    try {
      var res = await fetch(src);
      if (!res.ok) return;
      var text = await res.text();
      var holder = document.createElement('div');
      holder.innerHTML = text;
      var tpl = holder.querySelector('template');
      var frag = tpl ? tpl.content.cloneNode(true) : holder;
      host.appendChild(frag);
      reexec(host);
    } catch (e) { /* a missing comp shouldn't blank the whole preview */ }
  }
  async function boot() {
    window.__timelines = window.__timelines || {};
    var hosts = Array.prototype.slice.call(
      document.querySelectorAll('[data-composition-src]'));
    await Promise.all(hosts.map(mountOne));
    // Give the just-injected <script> tags a tick to register timelines.
    setTimeout(function () {
      var tls = window.__timelines || {};
      Object.keys(tls).forEach(function (k) {
        var tl = tls[k];
        if (tl && typeof tl.play === 'function') {
          try { tl.repeat(-1); } catch (e) {}
          tl.play(0);
        }
      });
    }, 120);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
</script>`;

  if (out.includes('</body>')) return out.replace('</body>', `${player}\n</body>`);
  return out + player;
}
