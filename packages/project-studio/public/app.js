// html-video studio v0.4 — chat-driven HTML + template gallery + text-node editor

const API = {
  projects: () => fetch('/api/projects').then(r => r.json()),
  createProject: b => fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  getProject: id => fetch(`/api/projects/${id}`).then(r => r.json()),
  patchProject: (id, b) => fetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  deleteProject: id => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(r => r.json()),
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
  // v0.8: multi-frame timeline state
  activeFrameId: null,     // graphNodeId currently shown in iframe
  lastGraph: null,         // last fetched ContentGraph (for download)
};

// ============== boot ==============
async function init() {
  // Kick off agent detection in the background — `which` + `<bin> --version`
  // can take ~400ms+ cold and there's no point holding the whole UI for it.
  // Composer renders disabled-but-visible; we re-render it once agents land.
  const agentsPromise = refreshAgents().then(() => {
    renderToolbar();
    if (state.selected) renderComposer();
  });
  await Promise.all([refreshTemplates(), refreshProjects()]);
  renderToolbar();
  wireToolbar();
  wireModals();
  // Don't block — but surface failures in the console.
  agentsPromise.catch((e) => console.warn('agent detection failed:', e));

  // Empty list → spin up a default project so the user lands inside one
  // instead of an empty gallery.
  if (state.projects.length === 0) {
    const r = await API.createProject({ name: defaultProjectName(0) });
    if (r && r.project) {
      await refreshProjects();
      await selectProject(r.project.id);
      return;
    }
  }
  // First load with existing projects → open the most recently updated one.
  if (!state.selected && state.projects.length > 0) {
    await selectProject(state.projects[0].id);
  }
}

function defaultProjectName(seed) {
  const n = (state.projects?.length ?? 0) + (seed ?? 0) + 1;
  return `Untitled ${String(n).padStart(2, '0')}`;
}

async function createDefaultProject() {
  const r = await API.createProject({ name: defaultProjectName(0) });
  if (!r?.project) {
    toast('Failed to create project', 'error');
    return;
  }
  await refreshProjects();
  await selectProject(r.project.id);
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
  state.activeFrameId = null;  // reset frame selection on project switch
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
    div.innerHTML = `
      <div class="name">${esc(p.name)}</div>
      <div class="meta">${p.template_id ? esc(p.template_id) : 'no template'} · ${p.status}</div>
      <button class="row-menu-btn" title="More" data-pid="${esc(p.id)}">⋯</button>
    `;
    div.onclick = (e) => {
      // Ignore clicks that started inside the menu button.
      if (e.target.closest('.row-menu-btn') || e.target.closest('.row-menu')) return;
      selectProject(p.id);
    };
    list.appendChild(div);
  }
  list.querySelectorAll('.row-menu-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openProjectMenu(btn);
    };
  });
}

function openProjectMenu(anchor) {
  // Close any existing menu.
  document.querySelectorAll('.row-menu').forEach((m) => m.remove());
  const pid = anchor.dataset.pid;
  const proj = state.projects.find((p) => p.id === pid);
  if (!proj) return;
  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.innerHTML = `
    <button data-act="rename">✎ 重命名</button>
    <button data-act="delete">🗑 删除</button>
  `;
  // Position below the button.
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${r.right - 140}px`;
  document.body.appendChild(menu);
  menu.querySelector('[data-act="rename"]').onclick = async () => {
    menu.remove();
    const next = prompt('新项目名', proj.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === proj.name) return;
    await API.patchProject(proj.id, { name: trimmed });
    await refreshProjects();
    if (state.selectedId === proj.id) {
      state.selected = (await API.getProject(proj.id)).project;
      renderToolbar();
      renderFooter();
    }
  };
  menu.querySelector('[data-act="delete"]').onclick = async () => {
    menu.remove();
    if (!confirm(`删除 "${proj.name}"？此操作不可撤销。`)) return;
    await API.deleteProject(proj.id);
    await refreshProjects();
    if (state.selectedId === proj.id) {
      state.selectedId = null;
      state.selected = null;
      state.messages = [];
      // Pick the next available project, or build a fresh default.
      if (state.projects.length > 0) {
        await selectProject(state.projects[0].id);
      } else {
        const r = await API.createProject({ name: defaultProjectName(0) });
        await refreshProjects();
        if (r?.project) await selectProject(r.project.id);
      }
    }
  };
  // Close on outside click / Escape.
  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close);
    document.removeEventListener('keydown', escClose);
  };
  const escClose = (e) => {
    if (e.key === 'Escape') {
      menu.remove();
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escClose);
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escClose);
  }, 0);
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
    // Template is optional — label hints at quick-start, not required step
    pickBtn.querySelector('.label').textContent = 'Optional · Pick template';
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

        <section class="right-pane">
          <div class="preview-stage" id="preview-stage">
            <div class="preview-placeholder"><div><div class="ico">🎞️</div>Pick a template above to preview.</div></div>
          </div>
          <div class="frames-strip" id="frames-strip"></div>
          <div class="right-footer">
            <span class="status" id="footer-status">no project</span>
            <span class="grow"></span>
            <button class="reload-btn" id="btn-reload">↻ Reload preview</button>
          </div>
        </section>

        <section class="text-pane">
          <div class="text-pane-head">
            <h2>Frame text</h2>
            <span class="save-state" id="text-save-state">—</span>
            <button class="textfields-toggle" id="btn-textfields-toggle" title="Collapse panel">›</button>
          </div>
          <div class="text-fields" id="text-fields">
            <div class="text-empty">Pick a template to see editable text fields here.</div>
          </div>
        </section>
        <div class="graph-modal" id="graph-modal">
          <div class="panel">
            <header>
              <h3>Content graph</h3>
              <span class="grow"></span>
              <button class="download-btn" id="graph-download">⬇ Download JSON</button>
              <button class="close-btn" id="graph-close">✕</button>
            </header>
            <pre id="graph-json"></pre>
          </div>
        </div>
      `
      : `<div class="empty-state"><div><div class="ico">🎬</div>
          <h2>Pick or create a project</h2>
          <p>Each project = one HTML video.</p></div></div>`}
  `;
  // Re-attach sidebar handlers (renderMain rebuilt the DOM)
  renderSidebar();
  document.getElementById('btn-new').onclick = createDefaultProject;
  const togBtn = document.getElementById('btn-sidebar-toggle');
  if (togBtn) togBtn.onclick = () => document.body.classList.toggle('sidebar-collapsed');
  const tfTog = document.getElementById('btn-textfields-toggle');
  if (tfTog) tfTog.onclick = () => document.body.classList.toggle('textfields-collapsed');
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
  const agentsKnown = state.agents.length > 0;
  // Composer is ready as soon as there's a project + an agent. Template is OPTIONAL
  // — agent can synthesize HTML from scratch from the user's prompt + attachments.
  // While agent detection is still in flight (state.agents empty), allow typing
  // optimistically so the user doesn't have to wait — the send button stays
  // disabled until we confirm an agent is available.
  const canType = !!p && !state.composing;
  const canSend = !!(p && availableAgents.length > 0 && !state.composing);
  ta.disabled = !canType;
  sendBtn.disabled = !canSend;
  ta.placeholder = !p ? 'Pick a project first…'
    : !agentsKnown ? 'Describe the video while we check for agents…'
    : availableAgents.length === 0 ? 'Install Claude Code (claude CLI) to enable chat…'
    : !p.templateId
      ? 'Describe a video — style, content, mood. Or pick a template above for a quick start.'
      : 'Describe the video — content, names, data, mood…';
}

function renderFooter() {
  const p = state.selected;
  const fs = document.getElementById('footer-status');
  if (!fs) return;
  if (p) {
    fs.innerHTML = `<b>${esc(p.name)}</b> · ${p.templateId ? `template <b>${esc(p.templateId)}</b>` : '<i>no template</i>'} · ${p.status}`;
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
      Tell the agent what to make. Drop in style references, paste links, attach a logo —
      whatever helps.<br>The HTML preview on the right updates with each turn.
      <div class="examples">
        <b>"Warm-grain magazine outro: Open Design — design that evolves itself"</b>
        <b>"Cyberpunk glitch title saying SYSTEM ONLINE, neon cyan/magenta"</b>
        <b>"Swiss-grid data card: Templates 231, Skills 15, Systems 150, Craft 11"</b>
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
  // Inline freeform input on each hv-options card
  log.querySelectorAll('textarea[data-freeform-msg]').forEach((ta) => {
    const msgIdx = Number(ta.dataset.freeformMsg);
    const sendBtn = log.querySelector(`button.freeform-send[data-freeform-msg="${msgIdx}"]`);
    const submit = () => {
      const text = ta.value.trim();
      if (!text) return;
      const m = state.messages[msgIdx];
      if (!m || m.pickedOption) return;
      m.pickedOption = text;  // mark answered so options collapse
      pickAndSend(text);
    };
    const autoResize = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight + 2, 160) + 'px';
    };
    ta.addEventListener('input', () => {
      if (sendBtn) sendBtn.disabled = ta.value.trim().length === 0;
      autoResize();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    if (sendBtn) sendBtn.onclick = submit;
  });
  // hv-form: collect field values + optional file attachments, submit as
  // [hv-form:submit]\n<json>. Files go through the existing pendingAttachments
  // path so the server multipart handler treats them like normal uploads.
  // Segmented buttons: click writes to the hidden input + flips .selected.
  log.querySelectorAll('.form-seg-btn[data-form-msg]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      const seg = btn.closest('.form-seg');
      if (!seg) return;
      seg.querySelectorAll('.form-seg-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      const hidden = seg.querySelector('input[type="hidden"]');
      if (hidden) hidden.value = btn.dataset.val ?? '';
    };
  });
  log.querySelectorAll('button.form-submit[data-form-msg]').forEach((btn) => {
    btn.onclick = async () => {
      const msgIdx = Number(btn.dataset.formMsg);
      const m = state.messages[msgIdx];
      if (!m || m.formSubmitted) return;
      const card = btn.closest('.form-card');
      if (!card) return;
      const collected = {};
      let missing = null;
      // Only grab inputs / textareas / selects — buttons share the data-form-key
      // attribute but their .value is empty, would clobber the real one.
      card.querySelectorAll(
        'input[data-form-key], textarea[data-form-key], select[data-form-key]',
      ).forEach((el) => {
        const key = el.dataset.formKey;
        const val = (el.value || '').trim();
        if (!val && card.querySelector(`label .req`) &&
            card.querySelector(`[data-form-key="${CSS.escape(key)}"]`).closest('.form-field')
              ?.querySelector('label .req')) {
          // Required field that's empty
          missing = key;
        }
        collected[key] = val;
      });
      if (missing) {
        toast(`请填写 ${missing}`, 'warn');
        return;
      }
      m.formSubmitted = collected;
      // Files: read from the existing form-att-<msgIdx> tray and route them
      // through state.pendingAttachments so sendMessage's multipart path picks
      // them up.
      const submitText = `[hv-form:submit]\n${JSON.stringify(collected, null, 2)}`;
      const ta = document.getElementById('composer-input');
      if (ta) ta.value = submitText;
      await sendMessage();
    };
  });
  // hv-form attach button — same flow as composer's 📎 button, scoped to the card.
  log.querySelectorAll('button.form-attach-btn[data-form-msg]').forEach((btn) => {
    btn.onclick = () => {
      const msgIdx = Number(btn.dataset.formMsg);
      const fi = document.getElementById(`form-file-${msgIdx}`);
      if (fi) fi.click();
    };
  });
  log.querySelectorAll('input[type="file"][id^="form-file-"]').forEach((fi) => {
    fi.onchange = (e) => addAttachments([...e.target.files]);
  });
  // hv-confirm: generate / edit buttons
  log.querySelectorAll('[data-confirm-msg]').forEach((btn) => {
    btn.onclick = async () => {
      const msgIdx = Number(btn.dataset.confirmMsg);
      const action = btn.dataset.action;
      const m = state.messages[msgIdx];
      if (!m) return;
      // In-flight guard only — don't permanently mark resolved here. Whether
      // the card stays locked is recomputed from history each render
      // (renderMessage inspects whether the click actually produced output).
      if (m.confirmInFlight) return;
      m.confirmInFlight = true;
      try {
        const ta = document.getElementById('composer-input');
        if (ta) ta.value = action === 'generate' ? '[hv-confirm:generate]' : '[hv-confirm:edit]';
        await sendMessage();
      } finally {
        m.confirmInFlight = false;
      }
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
  if (m.role === 'user') {
    // User-side form-submission marker carries hidden JSON the user can't read;
    // show a friendlier label instead of a wall of "topic=foo\nheadline=bar…".
    const formMatch = /^\[hv-form:submit\]\n([\s\S]*)$/.exec(m.content ?? '');
    if (formMatch) {
      return `<div class="msg user">📋 提交了表单</div>`;
    }
    if ((m.content ?? '').trim() === '[hv-confirm:generate]') {
      return `<div class="msg user">✓ 确认生成</div>`;
    }
    if ((m.content ?? '').trim() === '[hv-confirm:edit]') {
      return `<div class="msg user">✏️ 改一下</div>`;
    }
    return `<div class="msg user">${esc(m.content)}</div>`;
  }
  if (m.role === 'system') return `<div class="msg system">${esc(m.content)}</div>`;
  if (m.role === 'preview-event') return `<div class="msg preview-event">${esc(m.content)}</div>`;
  if (m.role === 'thinking') return `<div class="msg thinking">${esc(m.content || 'thinking')}</div>`;
  // assistant: try each card protocol in turn
  const raw = m.content ?? '';
  const formP = parseHvForm(raw);
  if (formP.form) {
    // Resolve "submitted" from history: any user turn after this card with
    // [hv-form:submit] marker counts as the answer.
    let submitted = m.formSubmitted;
    if (!submitted) {
      const nextUser = state.messages.slice(idx + 1).find((x) => x.role === 'user');
      if (nextUser) {
        const fm = /^\[hv-form:submit\]\n([\s\S]*)$/.exec(nextUser.content ?? '');
        if (fm && fm[1]) {
          try { submitted = JSON.parse(fm[1]); } catch { submitted = null; }
        }
      }
    }
    const formHtml = renderFormCard(formP.form, submitted, idx);
    return `<div class="msg assistant">
      <div class="role">${esc(m.agent ?? 'agent')}</div>
      <div class="body">${md(formP.prose)}${formHtml}</div>
    </div>`;
  }
  const confirmP = parseHvConfirm(raw);
  if (confirmP.confirm) {
    // Only lock the card when the click actually led somewhere:
    //   - "✏️ 改一下" → next assistant turn re-emitted hv-form (the edit landed)
    //   - "✓ 开始生成" → next assistant turn produced real output
    //                   (preview-event / ✓ HTML preview / storyboard summary)
    // If the click triggered an empty reply or generate failed, treat the
    // card as live so the user can press the button again.
    let resolved = m.confirmResolved;
    if (!resolved) {
      const after = state.messages.slice(idx + 1);
      const nextUser = after.find((x) => x.role === 'user');
      if (nextUser) {
        const t = (nextUser.content ?? '').trim();
        if (t === '[hv-confirm:generate]') {
          // Did anything productive happen between this user click and the
          // next user turn?
          const userIdx = after.indexOf(nextUser);
          const between = after.slice(userIdx + 1);
          const sawSuccess = between.some((x) => {
            if (x.role === 'preview-event') return true;
            if (x.role === 'assistant') {
              const c = (x.content ?? '').trim();
              if (!c) return false;
              if (/^⚠️/.test(c)) return false;
              if (/^✓\s/.test(c)) return true;
              if (/storyboard generated|HTML preview updated/i.test(c)) return true;
            }
            return false;
          });
          if (sawSuccess) resolved = '✓ 开始生成';
        } else if (t === '[hv-confirm:edit]') {
          resolved = '✏️ 改一下';
        }
      }
    }
    const confirmHtml = renderConfirmCard(confirmP.confirm, resolved, idx);
    return `<div class="msg assistant">
      <div class="role">${esc(m.agent ?? 'agent')}</div>
      <div class="body">${md(confirmP.prose)}${confirmHtml}</div>
    </div>`;
  }
  // Default: hv-options + prose
  const { prose, options } = parseHvOptions(raw);
  // m.pickedOption is in-memory only — wiped on reload. Recover it from
  // history: any user turn AFTER this card is implicitly the answer.
  let picked = m.pickedOption;
  if (options && !picked) {
    const nextUser = state.messages.slice(idx + 1).find((x) => x.role === 'user');
    if (nextUser) picked = nextUser.content;
  }
  const optionsHtml = options ? renderOptionCard(options, picked, idx) : '';
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

// === hv-form block parsing ===
// Multi-field input card. Schema:
//   ```hv-form
//   {
//     "title": "讲一下你想做的视频…",
//     "fields": [
//       { "key": "topic",     "label": "主题 / who-what",   "kind": "text",     "required": true },
//       { "key": "headline",  "label": "Headline",          "kind": "text",     "required": true },
//       { "key": "data",      "label": "关键数字 / 数据",   "kind": "textarea" },
//       { "key": "aspect",    "label": "尺寸",              "kind": "select",   "options": ["16:9","9:16","1:1","4:5"], "default": "16:9" },
//       { "key": "duration",  "label": "时长(秒)",          "kind": "select",   "options": ["3","5","10","15","30"], "default": "5" },
//       { "key": "frame_count","label": "帧数 / 画面数",    "kind": "text",     "default": "1" },
//       { "key": "style",     "label": "风格描述",          "kind": "textarea" }
//     ],
//     "allow_attachments": true
//   }
function parseHvForm(text) {
  const m = /```hv-form\s*\n([\s\S]*?)```/i.exec(text);
  if (!m) return { prose: text, form: null };
  const prose = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let parsed;
  try { parsed = JSON.parse(m[1].trim()); }
  catch { return { prose: text, form: null }; }
  if (!parsed || !Array.isArray(parsed.fields) || parsed.fields.length === 0) {
    return { prose: text, form: null };
  }
  return { prose, form: parsed };
}

// === hv-confirm block parsing ===
//   ```hv-confirm
//   {
//     "title": "按这些信息开始生成？",
//     "summary": [{ "label": "主题", "value": "nexu-io" }, ...],
//     "actions": ["generate","edit"]   // optional, defaults to both
//   }
function parseHvConfirm(text) {
  const m = /```hv-confirm\s*\n([\s\S]*?)```/i.exec(text);
  if (!m) return { prose: text, confirm: null };
  const prose = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let parsed;
  try { parsed = JSON.parse(m[1].trim()); }
  catch { return { prose: text, confirm: null }; }
  if (!parsed || !Array.isArray(parsed.summary)) {
    return { prose: text, confirm: null };
  }
  return { prose, confirm: parsed };
}

// === hv-form render ===
function renderFormCard(form, submitted, msgIdx) {
  const title = form.title || 'Tell me a bit more…';
  const fields = form.fields || [];
  const allowAttachments = form.allow_attachments !== false;
  const fieldsHtml = fields.map((f, i) => {
    const key = f.key || `field_${i}`;
    const label = f.label || key;
    const ph = f.placeholder || '';
    const required = f.required ? '<span class="req">*</span>' : '';
    const def = (submitted && submitted[key] !== undefined ? submitted[key] : (f.default ?? ''));
    const dis = submitted ? 'disabled' : '';
    let control;
    if (f.kind === 'textarea') {
      control = `<textarea data-form-msg="${msgIdx}" data-form-key="${esc(key)}" rows="2" placeholder="${esc(ph)}" ${dis}>${esc(def)}</textarea>`;
    } else if (f.kind === 'select') {
      const opts = (f.options || []).map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const lbl = typeof o === 'string' ? o : (o.label || o.value);
        const sel = String(v) === String(def) ? 'selected' : '';
        return `<option value="${esc(v)}" ${sel}>${esc(lbl)}</option>`;
      }).join('');
      control = `<select data-form-msg="${msgIdx}" data-form-key="${esc(key)}" ${dis}>${opts}</select>`;
    } else if (f.kind === 'buttons') {
      // Segmented control: a hidden input carries the value, visible buttons
      // toggle. Wired up in renderChatLog.
      const optsHtml = (f.options || []).map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const lbl = typeof o === 'string' ? o : (o.label || o.value);
        const sel = String(v) === String(def) ? 'selected' : '';
        return `<button type="button" class="form-seg-btn ${sel}" data-form-msg="${msgIdx}" data-form-key="${esc(key)}" data-val="${esc(v)}" ${dis}>${esc(lbl)}</button>`;
      }).join('');
      control = `<div class="form-seg" data-form-key="${esc(key)}">
        <input type="hidden" data-form-msg="${msgIdx}" data-form-key="${esc(key)}" value="${esc(def)}" />
        ${optsHtml}
      </div>`;
    } else {
      control = `<input type="text" data-form-msg="${msgIdx}" data-form-key="${esc(key)}" placeholder="${esc(ph)}" value="${esc(def)}" ${dis} />`;
    }
    return `<div class="form-field">
      <label>${esc(label)}${required}</label>
      ${control}
    </div>`;
  }).join('');
  const dropHtml = allowAttachments && !submitted ? `
    <div class="form-attachments" data-form-msg="${msgIdx}">
      <div class="form-drop-hint">📎 拖拽 / 粘贴 / 选择文件作为素材（logo、截图、数据 CSV…可选）</div>
      <div class="form-attachment-list" id="form-att-${msgIdx}"></div>
      <input type="file" id="form-file-${msgIdx}" multiple style="display:none" />
      <button type="button" class="form-attach-btn" data-form-msg="${msgIdx}">+ 添加文件</button>
    </div>` : '';
  const actionsHtml = submitted ? '' : `
    <div class="form-actions">
      <button class="form-submit" data-form-msg="${msgIdx}">提交 ↵</button>
    </div>`;
  return `<div class="form-card${submitted ? ' submitted' : ''}">
    <div class="form-title">${esc(title)}</div>
    <div class="form-fields">${fieldsHtml}</div>
    ${dropHtml}
    ${actionsHtml}
  </div>`;
}

// === hv-confirm render ===
function renderConfirmCard(confirm, resolved, msgIdx) {
  const title = confirm.title || 'Looks right?';
  const summary = confirm.summary || [];
  const actions = confirm.actions || ['generate', 'edit'];
  const summaryHtml = summary.map((s) => {
    const label = s.label || s.key || '';
    const value = s.value !== undefined ? String(s.value) : '';
    return `<div class="confirm-row">
      <div class="confirm-label">${esc(label)}</div>
      <div class="confirm-value">${esc(value) || '<span class="muted">—</span>'}</div>
    </div>`;
  }).join('');
  const actionsHtml = resolved ? '' : `
    <div class="confirm-actions">
      ${actions.includes('generate') ? `<button class="confirm-go" data-confirm-msg="${msgIdx}" data-action="generate">✓ 开始生成</button>` : ''}
      ${actions.includes('edit') ? `<button class="confirm-edit" data-confirm-msg="${msgIdx}" data-action="edit">✏️ 修改</button>` : ''}
    </div>`;
  return `<div class="confirm-card${resolved ? ' resolved' : ''}">
    <div class="confirm-title">${esc(title)}</div>
    <div class="confirm-summary">${summaryHtml}</div>
    ${actionsHtml}
    ${resolved ? `<div class="confirm-resolved-mark">${esc(resolved)}</div>` : ''}
  </div>`;
}

function renderOptionCard(opts, picked, msgIdx) {
  const allowFreeform = opts.allow_freeform !== false;
  const optsHtml = (opts.options || []).map((o, i) => {
    const label = o.label ?? String(o);
    const hint = o.hint ?? '';
    const isPicked = picked === label;
    const cls = 'opt' + (isPicked ? ' picked' : '');
    // Once the user has picked anything on this card, ALL buttons lock —
    // including the picked one, so the same option can't fire twice.
    const disabled = picked ? 'disabled' : '';
    return `<button class="${cls}" data-opt-msg="${msgIdx}" data-opt-i="${i}" ${disabled}>
      <span class="label">${esc(label)}</span>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    </button>`;
  }).join('');
  // Inline freeform input — saves a trip to the bottom composer when the
  // user just wants to type a custom answer to this card's question.
  const freeformHtml = allowFreeform && !picked ? `
    <div class="freeform-input">
      <textarea data-freeform-msg="${msgIdx}" rows="1"
        placeholder="…or type your own answer"></textarea>
      <button class="freeform-send" data-freeform-msg="${msgIdx}" disabled>↵ Send</button>
    </div>` : '';
  return `<div class="opt-card">
    <div class="question">${esc(opts.question)}</div>
    <div class="opts">${optsHtml}</div>
    ${freeformHtml}
  </div>`;
}

// ============== preview ==============
function renderPreview() {
  const stage = document.getElementById('preview-stage');
  if (!stage) return;
  const p = state.selected;
  if (!p) {
    stage.innerHTML = `<div class="preview-placeholder"><div><div class="ico">🎞️</div>
      Pick a project first.</div></div>`;
    renderFramesStrip();
    return;
  }
  // No template + no prior preview → show "send a chat first" placeholder
  if (!p.templateId && !p.lastPreviewHtmlPath) {
    stage.innerHTML = `<div class="preview-placeholder"><div><div class="ico">🎞️</div>
      Send a chat to generate the first HTML.<br>
      Or pick a template up top for a quick start.</div></div>`;
    renderFramesStrip();
    return;
  }
  // v0.8: if multi-frame, default-iframe shows the active frame (first by default).
  const frames = Array.isArray(p.frames) ? p.frames : [];
  const sortedFrames = [...frames].sort((a, b) => a.order - b.order);
  if (sortedFrames.length > 0 && !state.activeFrameId) {
    state.activeFrameId = sortedFrames[0].graphNodeId;
  }
  if (sortedFrames.length > 0 && state.activeFrameId
      && !sortedFrames.find((f) => f.graphNodeId === state.activeFrameId)) {
    state.activeFrameId = sortedFrames[0].graphNodeId;
  }
  const iframeSrc = sortedFrames.length > 0 && state.activeFrameId
    ? `/preview/${p.id}/frame/${encodeURIComponent(state.activeFrameId)}?t=${Date.now()}`
    : `/preview/${p.id}?t=${Date.now()}`;
  const stamp = sortedFrames.length > 0 && state.activeFrameId
    ? state.activeFrameId
    : (p.templateId || '');
  stage.innerHTML = `<div class="preview-frame">
    <iframe id="preview-iframe" sandbox="allow-scripts" src="${iframeSrc}"></iframe>
    ${stamp ? `<div class="stamp">${esc(stamp)}</div>` : ''}
  </div>`;
  renderFramesStrip();
}

function reloadPreview() {
  const iframe = document.getElementById('preview-iframe');
  if (!iframe || !state.selected) return;
  const p = state.selected;
  const frames = Array.isArray(p.frames) ? p.frames : [];
  if (frames.length > 0 && state.activeFrameId) {
    iframe.src = `/preview/${p.id}/frame/${encodeURIComponent(state.activeFrameId)}?t=${Date.now()}`;
  } else {
    iframe.src = `/preview/${p.id}?t=${Date.now()}`;
  }
}

// ============== v0.8: frames timeline + graph modal ==============
function renderFramesStrip() {
  const strip = document.getElementById('frames-strip');
  if (!strip) return;
  const p = state.selected;
  const frames = p && Array.isArray(p.frames) ? [...p.frames].sort((a, b) => a.order - b.order) : [];
  if (frames.length === 0) {
    strip.classList.remove('has-frames');
    strip.innerHTML = '';
    return;
  }
  strip.classList.add('has-frames');
  // Each chip = label + mini iframe of the frame's actual HTML, transform-
  // scaled so the 1920×1080 page fits in a ~180×100 thumb. sandbox blocks
  // navigation; allow-scripts so any opening animation runs.
  // Bust cache when frame content changes (re-renders point to a new
  // versioned URL via `?v=<timestamp>` derived from project.updatedAt).
  const ver = p.updatedAt ? new Date(p.updatedAt).getTime() : Date.now();
  const tabs = frames.map((f) => {
    const active = f.graphNodeId === state.activeFrameId ? 'active' : '';
    const src = `/preview/${p.id}/frame/${encodeURIComponent(f.graphNodeId)}?thumb=1&v=${ver}`;
    return `<button class="frame-tab ${active}" data-fid="${esc(f.graphNodeId)}">
      <div class="frame-thumb">
        <iframe sandbox="allow-scripts" src="${src}" tabindex="-1" loading="lazy"></iframe>
      </div>
      <div class="frame-tab-label">
        <span class="order">${String(f.order + 1).padStart(2, '0')}</span>
        <span class="fid">${esc(f.graphNodeId)}</span>
      </div>
    </button>`;
  }).join('');
  strip.innerHTML = `<span class="label">Frames</span>${tabs}
    <button class="frame-graph-btn" id="btn-show-graph">View graph</button>`;
  strip.querySelectorAll('button.frame-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeFrameId = btn.dataset.fid;
      renderPreview();
    });
  });
  const gbtn = document.getElementById('btn-show-graph');
  if (gbtn) gbtn.addEventListener('click', openGraphModal);
}

async function openGraphModal() {
  if (!state.selected) return;
  const modal = document.getElementById('graph-modal');
  const pre = document.getElementById('graph-json');
  if (!modal || !pre) return;
  try {
    const r = await fetch(`/api/projects/${state.selected.id}/content-graph`);
    if (!r.ok) {
      pre.textContent = '(no graph for this project)';
    } else {
      const { graph } = await r.json();
      pre.textContent = JSON.stringify(graph, null, 2);
      state.lastGraph = graph;
    }
  } catch (e) {
    pre.textContent = `error loading graph: ${e.message}`;
  }
  modal.classList.add('open');
  const close = document.getElementById('graph-close');
  const dl = document.getElementById('graph-download');
  if (close) close.onclick = () => modal.classList.remove('open');
  if (dl) dl.onclick = () => {
    if (!state.lastGraph) return;
    const blob = new Blob([JSON.stringify(state.lastGraph, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `content-graph-${state.selected.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  }, { once: true });
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
            const frameCount = ev.frames || 0;
            const summary = frameCount > 0
              ? `✓ ${frameCount}-frame storyboard generated`
              : '✓ HTML preview updated';
            const event = frameCount > 0
              ? `🎞 storyboard reloaded (${frameCount} frames)`
              : '🎞 preview reloaded';
            if (assistantIdx === -1) {
              state.messages[thinkingIdx] = { role: 'assistant', agent: state.selected.agentId ?? 'claude', content: summary, ts: Date.now() };
              assistantIdx = thinkingIdx;
            } else {
              state.messages[assistantIdx].content = summary;
            }
            state.messages.push({ role: 'preview-event', content: event, ts: Date.now() });
            renderChatLog();
            // Multi-frame turn replaces frames[]; reset active frame so the
            // first frame becomes the default again.
            if (frameCount > 0) state.activeFrameId = null;
            const pr = await API.getProject(state.selected.id);
            state.selected = pr.project;
            renderPreview();
            await refreshTextFields();
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
