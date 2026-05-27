// html-video studio v0.4 — chat-driven HTML + template gallery + text-node editor

const API = {
  projects: () => fetch('/api/projects').then(r => r.json()),
  createProject: b => fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  getProject: id => fetch(`/api/projects/${id}`).then(r => r.json()),
  templates: () => fetch('/api/templates').then(r => r.json()),
  agents: () => fetch('/api/agents').then(r => r.json()),
  setTemplate: (id, tid) => fetch(`/api/projects/${id}/template`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template_id: tid }) }).then(r => r.json()),
  setAgent: (id, aid) => fetch(`/api/projects/${id}/agent`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent_id: aid }) }).then(r => r.json()),
  exportMp4: id => fetch(`/api/projects/${id}/export`, { method: 'POST' }).then(r => r.json()),
  getMessages: id => fetch(`/api/projects/${id}/messages`).then(r => r.json()),
  rawHtml: id => fetch(`/api/projects/${id}/raw-html`).then(r => r.ok ? r.text() : null),
  putRawHtml: (id, html) => fetch(`/api/projects/${id}/raw-html`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html }) }).then(r => r.json()),
};

const state = {
  projects: [],
  templates: [],
  agents: [],
  selectedId: null,
  selected: null,
  messages: [],
  composing: false,
  textFields: [],          // [{key, original, current}]
  textSaveTimer: null,
  pendingAttachments: [],  // [{file, dataUrl?, name, kind, size}] before send
};

// ============== boot ==============
async function init() {
  await Promise.all([refreshTemplates(), refreshAgents(), refreshProjects()]);
  renderToolbar();
  wireToolbar();
  wireModals();
}
async function refreshTemplates() {
  const r = await API.templates();
  state.templates = r.templates ?? [];
}
async function refreshAgents() {
  try { state.agents = (await API.agents()).agents ?? []; }
  catch { state.agents = []; }
}
async function refreshProjects() {
  state.projects = (await API.projects()).projects ?? [];
  renderSidebar();
}

async function selectProject(id) {
  state.selectedId = id;
  state.selected = (await API.getProject(id)).project;
  try { state.messages = (await API.getMessages(id)).messages ?? []; }
  catch { state.messages = []; }
  renderSidebar();
  renderToolbar();   // <-- bug fix: toolbar buttons (template / agent / export) must
                     //     be re-enabled after a project is selected
  renderMain();
  await refreshTextFields();
}

// ============== sidebar ==============
function renderSidebar() {
  const list = document.getElementById('project-list');
  if (!state.projects.length) {
    list.innerHTML = '<div class="empty-list">no projects yet</div>';
    return;
  }
  list.innerHTML = '';
  for (const p of state.projects) {
    const div = document.createElement('div');
    div.className = 'project-row' + (p.id === state.selectedId ? ' active' : '');
    div.innerHTML = `<div class="name">${esc(p.name)}</div>
      <div class="meta">${p.template_id ? esc(p.template_id) : 'no template'} · ${p.status}</div>`;
    div.onclick = () => selectProject(p.id);
    list.appendChild(div);
  }
}

// ============== toolbar ==============
function renderToolbar() {
  const p = state.selected;
  const nameInput = document.getElementById('proj-name');
  const pickBtn = document.getElementById('btn-pick-template');
  const agentSel = document.getElementById('agent-select');
  const agentStatus = document.getElementById('agent-status');
  const exportBtn = document.getElementById('btn-export');

  nameInput.disabled = !p;
  nameInput.placeholder = p ? '' : '(no project)';
  nameInput.value = p?.name ?? '';

  pickBtn.disabled = !p;
  if (p && p.templateId) {
    const t = state.templates.find(x => x.id === p.templateId);
    pickBtn.classList.remove('empty');
    pickBtn.querySelector('.label').textContent = t ? t.name : p.templateId;
  } else {
    pickBtn.classList.add('empty');
    pickBtn.querySelector('.label').textContent = '— choose —';
  }

  const availableAgents = state.agents.filter(a => a.available);
  agentSel.disabled = !p || availableAgents.length === 0;
  agentSel.innerHTML = availableAgents.length === 0
    ? '<option value="">— none detected —</option>'
    : availableAgents.map(a => {
        const sel = (p && p.agentId === a.id) || (p && !p.agentId && a.id === availableAgents[0].id);
        const ver = a.version ? ` · ${esc(a.version.split(' ')[0])}` : '';
        return `<option value="${a.id}" ${sel ? 'selected' : ''}>${esc(a.name)}${ver}</option>`;
      }).join('');

  if (availableAgents.length > 0) {
    agentStatus.className = 'agent-status connected';
    agentStatus.textContent = '● ready';
  } else {
    agentStatus.className = 'agent-status missing';
    agentStatus.textContent = '○ install';
  }

  exportBtn.disabled = !p || !p.templateId;
  // Re-wire on every render so handlers always match the current DOM.
  wireToolbar();
}

// Wire toolbar elements — re-bind on every renderToolbar() so any DOM
// reuse / re-render can't strand stale event handlers. (Joey reported
// template + agent picks not responding in v0.6.2.)
function wireToolbar() {
  const pickBtn = document.getElementById('btn-pick-template');
  if (pickBtn) {
    pickBtn.onclick = (e) => {
      e.preventDefault();
      if (!state.selected) {
        toast('Pick a project first', 'error');
        return;
      }
      openGallery();
    };
  }
  const agentSel = document.getElementById('agent-select');
  if (agentSel) {
    agentSel.onchange = async (e) => {
      if (!state.selected) return;
      await API.setAgent(state.selected.id, e.target.value || null);
      state.selected = (await API.getProject(state.selected.id)).project;
      renderToolbar();
    };
  }
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.onclick = async () => {
      if (!state.selected) return;
      if (!confirm(`Export "${state.selected.name}" to MP4?\n\n(Real Hyperframes wiring lands in v0.7.)`)) return;
      const r = await API.exportMp4(state.selected.id);
      if (r.error) { toast('Export failed: ' + r.error, 'error'); return; }
      state.selected = r.project;
      toast('Exported → ' + r.output_path, 'success');
      renderToolbar();
      refreshProjects();
    };
  }
  const nameInput = document.getElementById('proj-name');
  if (nameInput) {
    nameInput.onblur = () => {
      if (state.selected) nameInput.value = state.selected.name;
    };
  }
  const sidebarToggle = document.getElementById('btn-sidebar-toggle');
  if (sidebarToggle) {
    sidebarToggle.onclick = () => {
      document.body.classList.toggle('sidebar-collapsed');
    };
  }
}

// ============== main: 4-column body ==============
function renderMain() {
  const body = document.getElementById('body');
  body.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-head">
        <h2>Projects</h2>
        <button class="new-project" id="btn-new">+ New</button>
        <button class="sidebar-toggle" id="btn-sidebar-toggle" title="Collapse sidebar">‹</button>
      </div>
      <div class="project-list" id="project-list"></div>
    </aside>

    ${state.selected
      ? `
        <section class="chat-pane">
          <div class="chat-log" id="chat-log"></div>
          <div class="composer">
            <div class="composer-shell" id="composer-shell">
              <div class="attachments" id="attachments"></div>
              <textarea id="composer-input" placeholder="..." rows="2"></textarea>
              <div class="actions">
                <button class="icon-btn" id="btn-attach" title="Attach file">📎</button>
                <input type="file" id="file-input" multiple style="display:none" />
                <span class="hint">Cmd / Ctrl + Enter · drag / paste files</span>
                <button class="send-btn" id="btn-send" disabled>Send</button>
              </div>
            </div>
          </div>
        </section>

        <section class="text-pane">
          <div class="text-pane-head">
            <h2>Frame text</h2>
            <span class="save-state" id="text-save-state">—</span>
          </div>
          <div class="text-fields" id="text-fields">
            <div class="text-empty">Pick a template to see editable text fields here.</div>
          </div>
        </section>

        <section class="right-pane">
          <div class="preview-stage" id="preview-stage">
            <div class="preview-placeholder"><div><div class="ico">🎞️</div>Pick a template above to preview.</div></div>
          </div>
          <div class="right-footer">
            <span class="status" id="footer-status">no project</span>
            <span class="grow"></span>
            <button class="reload-btn" id="btn-reload">↻ Reload preview</button>
          </div>
        </section>
      `
      : `<div class="empty-state"><div><div class="ico">🎬</div>
          <h2>Pick or create a project</h2>
          <p>Each project = one HTML video.</p></div></div>`}
  `;
  // Re-attach sidebar handlers (renderMain rebuilt the DOM)
  renderSidebar();
  document.getElementById('btn-new').onclick = openNewModal;
  const togBtn = document.getElementById('btn-sidebar-toggle');
  if (togBtn) togBtn.onclick = () => document.body.classList.toggle('sidebar-collapsed');
  if (state.selected) {
    renderChatLog();
    renderComposer();
    renderPreview();
    renderFooter();
    document.getElementById('btn-send').onclick = sendMessage;
    document.getElementById('composer-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendMessage();
      }
    });
    document.getElementById('btn-attach').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = (e) => addAttachments([...e.target.files]);
    wireDragAndPaste();
    document.getElementById('btn-reload').onclick = () => { reloadPreview(); refreshTextFields(); };
  }
}

// ============== composer attachments ==============
function attachmentKind(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/json' || t === 'text/csv' || /\.(csv|tsv|json)$/i.test(file.name)) return 'data';
  if (t.startsWith('text/')) return 'text';
  return 'reference-link';
}
function iconForKind(k) {
  return { image: '🖼', video: '🎬', audio: '🎵', data: '📊', text: '📝' }[k] ?? '📎';
}

function addAttachments(files) {
  for (const f of files) {
    const kind = attachmentKind(f);
    const att = { file: f, name: f.name, kind, size: f.size };
    state.pendingAttachments.push(att);
    if (kind === 'image') {
      const r = new FileReader();
      r.onload = (e) => { att.dataUrl = e.target.result; renderAttachments(); };
      r.readAsDataURL(f);
    }
  }
  renderAttachments();
}

function removeAttachment(i) {
  state.pendingAttachments.splice(i, 1);
  renderAttachments();
}

function renderAttachments() {
  const wrap = document.getElementById('attachments');
  if (!wrap) return;
  wrap.innerHTML = state.pendingAttachments.map((a, i) => {
    const thumb = a.dataUrl ? `<img src="${a.dataUrl}" alt="" />` : `<span class="ico">${iconForKind(a.kind)}</span>`;
    return `<span class="att-chip">
      ${thumb}
      <span class="name" title="${esc(a.name)}">${esc(a.name)}</span>
      <button data-i="${i}" title="Remove">×</button>
    </span>`;
  }).join('');
  wrap.querySelectorAll('button[data-i]').forEach(btn => {
    btn.onclick = () => removeAttachment(Number(btn.dataset.i));
  });
}

function wireDragAndPaste() {
  const shell = document.getElementById('composer-shell');
  const ta = document.getElementById('composer-input');
  if (!shell) return;
  shell.addEventListener('dragover', (e) => {
    e.preventDefault();
    shell.classList.add('dragging');
  });
  shell.addEventListener('dragleave', () => shell.classList.remove('dragging'));
  shell.addEventListener('drop', (e) => {
    e.preventDefault();
    shell.classList.remove('dragging');
    if (e.dataTransfer?.files?.length) addAttachments([...e.dataTransfer.files]);
  });
  ta.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addAttachments(files);
    }
  });
}

function renderComposer() {
  const p = state.selected;
  const ta = document.getElementById('composer-input');
  const sendBtn = document.getElementById('btn-send');
  if (!ta) return;
  const availableAgents = state.agents.filter(a => a.available);
  const ready = !!(p && p.templateId && availableAgents.length > 0);
  ta.disabled = !ready || state.composing;
  sendBtn.disabled = !ready || state.composing;
  ta.placeholder = !p ? 'Pick a project first…'
    : !p.templateId ? 'Pick a template up top first…'
    : availableAgents.length === 0 ? 'Install Claude Code (claude CLI) to enable chat…'
    : 'Describe the video — content, names, data, mood…';
}

function renderFooter() {
  const p = state.selected;
  const fs = document.getElementById('footer-status');
  if (!fs) return;
  if (p) {
    fs.innerHTML = `<b>${esc(p.name)}</b> · ${p.templateId ? `template <b>${esc(p.templateId)}</b>` : 'no template'} · ${p.status}`;
  } else {
    fs.textContent = 'no project';
  }
}

// ============== chat log ==============
function renderChatLog() {
  const log = document.getElementById('chat-log');
  if (!log) return;
  if (!state.messages.length) {
    log.innerHTML = `<div class="chat-empty"><div><div class="ico">💬</div>
      Tell the agent what to make.<br>The HTML preview on the right updates with each turn.
      <div class="examples">
        <b>"Brand outro for Open Design with tagline 'Design that evolves itself'"</b>
        <b>"Bar chart of OD plugins: Templates 231, Skills 15, Systems 150, Craft 11"</b>
        <b>"Glitch title saying SYSTEM ONLINE in cyan/magenta"</b>
      </div>
    </div></div>`;
    return;
  }
  log.innerHTML = state.messages.map((m, i) => renderMessage(m, i)).join('');
  log.querySelectorAll('button.opt[data-opt-msg]').forEach((btn) => {
    btn.onclick = () => {
      const msgIdx = Number(btn.dataset.optMsg);
      const optI = Number(btn.dataset.optI);
      const m = state.messages[msgIdx];
      if (!m || m.pickedOption) return;
      const { options } = parseHvOptions(m.content ?? '');
      if (!options) return;
      const picked = options.options[optI];
      const label = picked?.label ?? '';
      m.pickedOption = label;
      // Fire as a new user turn
      pickAndSend(label);
    };
  });
  log.scrollTop = log.scrollHeight;
}

async function pickAndSend(label) {
  // Stuff the textarea with the chosen label and send it as a normal turn
  const ta = document.getElementById('composer-input');
  if (ta) ta.value = label;
  renderChatLog(); // shows the picked highlight on the previous message
  await sendMessage();
}

function renderMessage(m, idx) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
  if (m.role === 'system') return `<div class="msg system">${esc(m.content)}</div>`;
  if (m.role === 'preview-event') return `<div class="msg preview-event">${esc(m.content)}</div>`;
  if (m.role === 'thinking') return `<div class="msg thinking">${esc(m.content || 'thinking')}</div>`;
  // assistant: split out the hv-options block (if any), markdown the rest
  const { prose, options } = parseHvOptions(m.content ?? '');
  const optionsHtml = options ? renderOptionCard(options, m.pickedOption, idx) : '';
  return `<div class="msg assistant">
    <div class="role">${esc(m.agent ?? 'agent')}</div>
    <div class="body">${md(prose)}${optionsHtml}</div>
  </div>`;
}

// === Markdown rendering ===
// Uses `marked` from CDN for proper headings/lists/bold/links/code,
// then DOMPurify to sanitize, so user prompts can't inject script tags
// even if the agent echos them back.
function md(text) {
  if (!text) return '';
  let html;
  if (typeof window.marked !== 'undefined') {
    try {
      html = window.marked.parse(String(text), { breaks: true, gfm: true });
    } catch {
      html = esc(text);
    }
  } else {
    // Fallback: render bare with line breaks if CDN failed to load
    html = esc(text).replace(/\n/g, '<br>');
  }
  if (typeof window.DOMPurify !== 'undefined') {
    return window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'hr', 'span'],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    });
  }
  return html;
}

// === hv-options block parsing ===
// Splits assistant text into prose + an optional ```hv-options``` block.
function parseHvOptions(text) {
  const m = /```hv-options\s*\n([\s\S]*?)```/i.exec(text);
  if (!m) return { prose: text, options: null };
  const prose = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let parsed;
  try { parsed = JSON.parse(m[1].trim()); }
  catch { return { prose: text, options: null }; }
  if (!parsed || !Array.isArray(parsed.options) || !parsed.question) {
    return { prose: text, options: null };
  }
  return { prose, options: parsed };
}

function renderOptionCard(opts, picked, msgIdx) {
  const allowFreeform = opts.allow_freeform !== false;
  const optsHtml = (opts.options || []).map((o, i) => {
    const label = o.label ?? String(o);
    const hint = o.hint ?? '';
    const isPicked = picked === label;
    const cls = 'opt' + (isPicked ? ' picked' : '');
    const disabled = picked && !isPicked ? 'disabled' : '';
    return `<button class="${cls}" data-opt-msg="${msgIdx}" data-opt-i="${i}" ${disabled}>
      <span class="label">${esc(label)}</span>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </button>`;
  }).join('');
  return `<div class="opt-card">
    <div class="question">${esc(opts.question)}</div>
    <div class="opts">${optsHtml}</div>
    ${allowFreeform && !picked ? '<div class="freeform-hint">…or type your own answer below.</div>' : ''}
  </div>`;
}

// ============== preview ==============
function renderPreview() {
  const stage = document.getElementById('preview-stage');
  if (!stage) return;
  const p = state.selected;
  if (!p || !p.templateId) {
    stage.innerHTML = `<div class="preview-placeholder"><div><div class="ico">🎞️</div>
      ${p ? 'Pick a template up top to preview.' : 'Pick a project first.'}</div></div>`;
    return;
  }
  stage.innerHTML = `<div class="preview-frame">
    <iframe id="preview-iframe" sandbox="allow-scripts" src="/preview/${p.id}?t=${Date.now()}"></iframe>
    <div class="stamp">${esc(p.templateId)}</div>
  </div>`;
}

function reloadPreview() {
  const iframe = document.getElementById('preview-iframe');
  if (iframe && state.selected) iframe.src = `/preview/${state.selected.id}?t=${Date.now()}`;
}

// ============== text fields (data-hv-text editor) ==============
async function refreshTextFields() {
  if (!state.selected || !state.selected.templateId) {
    state.textFields = [];
    renderTextFields();
    return;
  }
  const html = await API.rawHtml(state.selected.id);
  if (!html) {
    state.textFields = [];
    renderTextFields();
    return;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = doc.querySelectorAll('[data-hv-text]');
  const seen = new Set();
  const fields = [];
  for (const el of nodes) {
    const key = el.getAttribute('data-hv-text');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const text = el.textContent ?? '';
    fields.push({ key, original: text, current: text });
  }
  state.textFields = fields;
  renderTextFields();
}

function renderTextFields() {
  const wrap = document.getElementById('text-fields');
  if (!wrap) return;
  if (!state.selected) {
    wrap.innerHTML = '<div class="text-empty">No project.</div>';
    return;
  }
  if (!state.selected.templateId) {
    wrap.innerHTML = '<div class="text-empty">Pick a template up top to see editable fields.</div>';
    return;
  }
  if (state.textFields.length === 0) {
    wrap.innerHTML = `<div class="text-empty">No editable text yet.<br>Send a chat to generate the first version of the HTML, then per-frame text fields appear here.</div>`;
    return;
  }
  // Always render as textarea — agent decides text length, no hard cap.
  wrap.innerHTML = state.textFields.map((f, i) => {
    const labelKey = humanizeKey(f.key);
    return `<div class="text-field">
      <div class="key">${esc(labelKey)}<span class="badge">${esc(f.key)}</span></div>
      <textarea data-i="${i}" rows="1" placeholder="(empty)">${esc(f.current)}</textarea>
    </div>`;
  }).join('');
  wrap.querySelectorAll('textarea[data-i]').forEach((el) => {
    autoResize(el);
    el.addEventListener('input', (e) => {
      const i = Number(e.target.dataset.i);
      state.textFields[i].current = e.target.value;
      autoResize(el);
      scheduleTextSave();
    });
  });
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 320) + 'px';
}

function humanizeKey(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scheduleTextSave() {
  clearTimeout(state.textSaveTimer);
  setSaveState('typing…');
  state.textSaveTimer = setTimeout(commitTextEdits, 500);
}

function setSaveState(text, kind = '') {
  const el = document.getElementById('text-save-state');
  if (el) {
    el.textContent = text;
    el.className = 'save-state ' + kind;
  }
}

async function commitTextEdits() {
  if (!state.selected) return;
  const dirty = state.textFields.filter((f) => f.current !== f.original);
  if (dirty.length === 0) {
    setSaveState('—');
    return;
  }
  setSaveState('saving…', 'saving');
  // Fetch current preview HTML, replace each data-hv-text node's textContent
  const html = await API.rawHtml(state.selected.id);
  if (!html) { setSaveState('error', 'error'); return; }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const f of state.textFields) {
    const nodes = doc.querySelectorAll(`[data-hv-text="${cssEscape(f.key)}"]`);
    nodes.forEach((n) => { n.textContent = f.current; });
    f.original = f.current;
  }
  // Serialize back: include doctype because DOMParser drops it
  const serialized = '<!doctype html>\n' + doc.documentElement.outerHTML;
  const r = await API.putRawHtml(state.selected.id, serialized);
  if (r.error) {
    setSaveState('error: ' + r.error, 'error');
    return;
  }
  state.selected = r.project;
  setSaveState('saved', 'saved');
  reloadPreview();
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// ============== send message ==============
async function sendMessage() {
  if (state.composing || !state.selected) return;
  const ta = document.getElementById('composer-input');
  const text = ta.value.trim();
  const hasAttachments = state.pendingAttachments.length > 0;
  if (!text && !hasAttachments) return;
  ta.value = '';
  state.composing = true;
  renderComposer();

  // User message includes attachment summary
  const attSummary = hasAttachments
    ? `\n\n📎 ${state.pendingAttachments.length} attachment(s): ${state.pendingAttachments.map(a => a.name).join(', ')}`
    : '';
  state.messages.push({ role: 'user', content: text + attSummary, ts: Date.now() });
  state.messages.push({ role: 'thinking', content: 'agent thinking', ts: Date.now() });
  const thinkingIdx = state.messages.length - 1;
  renderChatLog();

  let assistantIdx = -1;

  try {
    let res;
    if (hasAttachments) {
      const fd = new FormData();
      fd.append('content', text);
      for (const a of state.pendingAttachments) fd.append('file', a.file, a.name);
      // Clear UI attachments before request so user sees them disappear
      state.pendingAttachments = [];
      renderAttachments();
      res = await fetch(`/api/projects/${state.selected.id}/messages`, {
        method: 'POST',
        body: fd,
      });
    } else {
      res = await fetch(`/api/projects/${state.selected.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
    }
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      state.messages[thinkingIdx] = { role: 'system', content: '⚠️ ' + (err.error ?? 'agent failed'), ts: Date.now() };
      renderChatLog();
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'text') {
            if (assistantIdx === -1) {
              // Replace thinking with assistant message
              state.messages[thinkingIdx] = { role: 'assistant', agent: state.selected.agentId ?? 'claude', content: '', ts: Date.now() };
              assistantIdx = thinkingIdx;
            }
            state.messages[assistantIdx].content += ev.chunk;
            renderChatLog();
          } else if (ev.type === 'preview_ready') {
            if (assistantIdx === -1) {
              state.messages[thinkingIdx] = { role: 'assistant', agent: state.selected.agentId ?? 'claude', content: '✓ HTML preview updated', ts: Date.now() };
              assistantIdx = thinkingIdx;
            } else {
              state.messages[assistantIdx].content = '✓ HTML preview updated';
            }
            state.messages.push({ role: 'preview-event', content: '🎞 preview reloaded', ts: Date.now() });
            renderChatLog();
            reloadPreview();
            await refreshTextFields();
            const pr = await API.getProject(state.selected.id);
            state.selected = pr.project;
            renderToolbar();
            renderFooter();
          } else if (ev.type === 'warning') {
            if (assistantIdx === -1) {
              state.messages[thinkingIdx] = { role: 'assistant', agent: state.selected.agentId ?? 'claude', content: '', ts: Date.now() };
              assistantIdx = thinkingIdx;
            }
            state.messages[assistantIdx].content += '\n\n⚠️ ' + ev.message;
            renderChatLog();
          } else if (ev.type === 'error') {
            if (assistantIdx === -1) {
              state.messages[thinkingIdx] = { role: 'system', content: '⚠️ ' + ev.message, ts: Date.now() };
            } else {
              state.messages[assistantIdx].content += '\n\n⚠️ ' + ev.message;
            }
            renderChatLog();
          }
        }
      }
    }
  } catch (e) {
    state.messages[thinkingIdx] = { role: 'system', content: '⚠️ ' + (e.message ?? e), ts: Date.now() };
    renderChatLog();
  }
  state.composing = false;
  renderComposer();
}

// ============== gallery modal ==============
function openGallery() {
  if (!state.selected) return;
  document.getElementById('gallery-modal').classList.add('show');
  const grid = document.getElementById('gallery');
  grid.innerHTML = state.templates.map(t => {
    const sel = state.selected?.templateId === t.id ? ' selected' : '';
    const tags = (t.tags || []).slice(0, 4).map((tg) => `<span class="tag">${esc(tg)}</span>`).join('');
    return `<div class="gallery-card${sel}" data-id="${t.id}">
      <div class="preview"><iframe sandbox="allow-scripts" src="/template-asset/${t.id}/source/index.html"></iframe></div>
      <div class="meta">
        <div class="name">${esc(t.name)}</div>
        <div class="desc">${esc(t.description)}</div>
        <div class="tags">${tags}</div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.gallery-card').forEach(card => {
    card.onclick = async () => {
      const tid = card.dataset.id;
      await API.setTemplate(state.selected.id, tid);
      closeGallery();
      await selectProject(state.selected.id); // re-fetch + re-render incl. text fields
      toast(`Template: ${tid}`, 'success');
    };
  });
}

function closeGallery() {
  document.getElementById('gallery-modal').classList.remove('show');
}

// ============== new-project modal ==============
function openNewModal() {
  document.getElementById('new-modal').classList.add('show');
  document.getElementById('new-name').focus();
}
function closeNewModal() {
  document.getElementById('new-modal').classList.remove('show');
  document.getElementById('new-name').value = '';
  document.getElementById('new-intent').value = '';
}

function wireModals() {
  document.getElementById('new-cancel').onclick = closeNewModal;
  document.getElementById('new-ok').onclick = async () => {
    const name = document.getElementById('new-name').value.trim();
    const intent = document.getElementById('new-intent').value.trim();
    if (!name) { toast('Name is required', 'error'); return; }
    const r = await API.createProject({ name, ...(intent && { intent }) });
    closeNewModal();
    await refreshProjects();
    await selectProject(r.project.id);
    toast(`Created "${name}"`, 'success');
  };
  document.getElementById('new-modal').addEventListener('click', e => {
    if (e.target.id === 'new-modal') closeNewModal();
  });
  document.getElementById('gallery-close').onclick = closeGallery;
  document.getElementById('gallery-modal').addEventListener('click', e => {
    if (e.target.id === 'gallery-modal') closeGallery();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeNewModal();
      closeGallery();
    }
  });
}

// ============== utils ==============
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  setTimeout(() => t.classList.remove('show'), 2500);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

init();
