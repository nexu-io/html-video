import { SourceEditor } from '@hyperframes/studio';
/**
 * studio-next is a research project, not a production app. See SPIKE-REPORT.md
 * for the full conclusion.
 *
 * Current contents: a two-pane SourceEditor + live srcDoc preview, used to
 * confirm `@hyperframes/studio` imports cleanly in Vite + React 19. The
 * earlier `<Player>` + `useElementPicker` attempt is documented in the
 * report; that path requires a hf-compatible backend we don't have, so
 * the production studio at packages/project-studio (port 3071) stays in
 * charge.
 */
import { useState } from 'react';

const SAMPLE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0f0a2e;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center}
h1{font-size:8vw;letter-spacing:-.02em;text-align:center;padding:0 4vw}
</style></head><body>
<h1 data-hv-text="headline">Open Design</h1>
</body></html>`;

export function App() {
  const [html, setHtml] = useState(SAMPLE_HTML);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        height: '100vh',
        gap: 12,
        padding: 12,
      }}
    >
      <div
        style={{
          background: '#1a1a1f',
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid #2a2a30',
            fontSize: 12,
            color: '#8a8a90',
            flex: '0 0 auto',
          }}
        >
          @hyperframes/studio · SourceEditor
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <SourceEditor value={html} language="html" onChange={setHtml} />
        </div>
      </div>
      <div
        style={{ background: '#000', borderRadius: 8, overflow: 'hidden', position: 'relative' }}
      >
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          style={{ width: '100%', height: '100%', border: 0 }}
        />
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontSize: 11,
            color: 'rgba(255,255,255,.4)',
            fontFamily: 'monospace',
          }}
        >
          live preview
        </div>
      </div>
    </div>
  );
}
