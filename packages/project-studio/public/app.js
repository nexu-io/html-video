// html-video studio v0.4 — chat-driven HTML + template gallery + text-node editor

import { t, getLocale, setLocale, AVAILABLE_LOCALES } from './i18n.js';

// Re-render whole UI on language change.
document.addEventListener('hv-locale-change', () => {
  document.documentElement.lang = getLocale();
  if (typeof renderToolbar === 'function') renderToolbar();
  if (typeof renderMain === 'function') renderMain();
  if (typeof renderSidebar === 'function') renderSidebar();
});
document.documentElement.lang = getLocale();

// Background-music style presets. Clicking a chip fills the prompt textarea
// with a tuned English MiniMax prompt (the model follows English best); the
// label is localized via i18n (soundtrack.preset_<key>). Still editable after.
const MUSIC_PRESETS = [
  { key: 'energetic', prompt: 'energetic upbeat electronic, driving beat, punchy synths, modern and confident' },
  { key: 'calm',      prompt: 'calm ambient pad, soft piano, slow and soothing, gentle and warm' },
  { key: 'tech',      prompt: 'sleek tech corporate, pulsing synth arpeggio, clean minimal beat, futuristic' },
  { key: 'narrative', prompt: 'cinematic storytelling score, emotional strings, building piano, reflective' },
  { key: 'minimal',   prompt: 'minimal lo-fi, sparse beat, mellow keys, understated background bed' },
  { key: 'epic',      prompt: 'epic orchestral, powerful drums, soaring brass, dramatic and inspiring' },
];

// Narration voices — MiniMax built-in voice_ids, all verified usable.
// `key` maps to a localized label (soundtrack.voice_<key>).
const NARRATION_VOICES = [
  { key: 'male_warm',     voiceId: 'male-qn-qingse' },
  { key: 'male_pro',      voiceId: 'male-qn-jingying' },
  { key: 'male_deep',     voiceId: 'audiobook_male_1' },
  { key: 'female_anchor', voiceId: 'presenter_female' },
  { key: 'female_mature', voiceId: 'female-yujie' },
  { key: 'female_sweet',  voiceId: 'female-shaonv' },
];

const API = {
  projects: () => fetch('/api/projects').then(r => r.json()),
  createProject: b => fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  getProject: id => fetch(`/api/projects/${id}`).then(r => r.json()),
  patchProject: (id, b) => fetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  deleteProject: id => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(r => r.json()),
  templates: () => fetch('/api/templates').then(r => r.json()),
  agents: () => fetch('/api/agents').then(r => r.json()),
  setTemplate: (id, tid) => fetch(`/api/projects/${id}/template`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template_id: tid }) }).then(r => r.json()),
  setAgent: (id, aid, model) => fetch(`/api/projects/${id}/agent`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent_id: aid, ...(model !== undefined && { agent_model: model }) }) }).then(r => r.json()),
  exportMp4: id => fetch(`/api/projects/${id}/export`, { method: 'POST' }).then(r => r.json()),
  getMessages: id => fetch(`/api/projects/${id}/messages`).then(r => r.json()),
  rawHtml: id => fetch(`/api/projects/${id}/raw-html`).then(r => r.ok ? r.text() : null),
  putRawHtml: (id, html) => fetch(`/api/projects/${id}/raw-html`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html }) }).then(r => r.json()),
  testAgent: id => fetch(`/api/agents/${encodeURIComponent(id)}/test`, { method: 'POST' }).then(r => r.json()),
  rescanAgents: () => fetch('/api/agents?force=1').then(r => r.json()),
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
  iterateFocusFrameId: null, // graphNodeId iterations should target only (null = whole video)
  editTextMode: false,     // when true, preview iframe accepts inline text edits
  exporting: false,        // export run in progress
  exportProgress: null,    // { pct, stage } during a streamed export
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

/**
 * Format a percent value for inline progress UI.
 *  - integer pcts stay integer ("56" → "56")
 *  - fractional pcts truncate to 1 decimal place ("98.333…" → "98.3")
 * Avoids the JS-default "98.33333333334%" tail when sources publish
 * (frame_index + sub_pct/100) / total style fractions.
 */
function formatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

async function createDefaultProject() {
  const r = await API.createProject({ name: defaultProjectName(0) });
  if (!r?.project) {
    toast(t('modal.new.failed'), 'error');
    return;
  }
  await refreshProjects();
  await selectProject(r.project.id);
}

// ============== Export MP4 (streamed) ==============
async function startExportStream() {
  if (!state.selected) return;
  const projectId = state.selected.id;
  state.exporting = true;
  state.exportProgress = { pct: 0, stage: 'starting' };
  renderToolbar();
  state.messages.push({ role: 'preview-event', content: t('export.starting'), ts: Date.now() });
  renderChatLog();

  let res;
  try {
    res = await fetch(`/api/projects/${projectId}/export`, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (e) {
    state.exporting = false;
    state.exportProgress = null;
    toast(t('export.failed_short', { message: (e?.message ?? e) }), 'error');
    renderToolbar();
    return;
  }
  if (!res.ok || !res.body) {
    state.exporting = false;
    state.exportProgress = null;
    const err = await res.text().catch(() => '');
    toast(t('export.failed_short', { message: err.slice(0, 200) }), 'error');
    renderToolbar();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      for (const line of events) {
        if (!line.startsWith('data: ')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'export_progress') {
          state.exportProgress = { pct: ev.pct, stage: ev.stage };
          renderToolbar();
        } else if (ev.type === 'export_done') {
          state.exporting = false;
          state.exportProgress = null;
          if (ev.project) state.selected = ev.project;
          const seconds = ev.elapsed_ms ? `${(ev.elapsed_ms / 1000).toFixed(1)}s` : '';
          state.messages.push({
            role: 'preview-event',
            content: seconds ? t('export.done_seconds', { seconds }) : t('export.done_no_seconds'),
            ts: Date.now(),
          });
          state.messages.push({
            role: 'export-done',
            content: ev.output_path,
            ts: Date.now(),
          });
          renderChatLog();
          renderToolbar();
          refreshProjects();
        } else if (ev.type === 'export_failed') {
          state.exporting = false;
          state.exportProgress = null;
          state.messages.push({
            role: 'system',
            content: t('export.failed', { message: ev.message }),
            ts: Date.now(),
          });
          renderChatLog();
          renderToolbar();
        }
      }
    }
  } catch (e) {
    state.exporting = false;
    state.exportProgress = null;
    toast(t('export.stream_interrupted', { message: (e?.message ?? e) }), 'error');
    renderToolbar();
  }
}

/**
 * Detect "I want to export this to MP4" intent in a chat message.
 * Hits both Chinese + English without leaning on the agent.
 */
function isExportIntent(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length > 40) return false;        // long messages are content / iterate requests
  if (/https?:\/\//i.test(t)) return false; // a link is ALWAYS source material to build from, never "export"
  // "生成/做一个视频" is the most common way to ask to CREATE a video — it must
  // NOT count as export. Only match explicit export/render verbs that target an
  // already-produced result: 导出 / 出片 / 渲染 / export / render / encode / 输出mp4.
  return /^\s*(?:export|render|encode|导出(?:视频|为?\s?mp4)?|出片|渲染|输出\s?mp4|存为\s?mp4)\s*$/i.test(t)
    || /(?:^|\s)(?:导出|出片|渲染成?|export|render|encode)(?:$|\s|视频|为?\s?mp4|成\s?mp4)/i.test(t);
}

async function revealExportedFile() {
  if (!state.selected) return;
  try {
    const r = await fetch(`/api/projects/${state.selected.id}/reveal`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `${r.status}`);
  } catch (e) {
    toast(t('export.reveal_failed', { message: (e?.message ?? e) }), 'error');
  }
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
  state.iterateFocusFrameId = null;
  state.editTextMode = false;
  // A generation running for the PREVIOUS project keeps going on the backend
  // (its result persists); just release the composer so this project is usable.
  // The in-flight SSE loop self-stops once it sees selectedId changed.
  state.composing = false;
  try { state.messages = (await API.getMessages(id)).messages ?? []; }
  catch { state.messages = []; }
  // If a generation is still running on the backend for this project, surface a
  // live "still generating" line (the in-memory progress lines were lost on the
  // switch; the result will appear in messages once it finishes — reload to see).
  try {
    const g = await fetch(`/api/projects/${id}/generating`).then((r) => r.json());
    if (g?.generating && id === state.selectedId) {
      state.messages.push({ role: 'preview-event', content: t('chat.still_generating'), ts: Date.now() });
    }
  } catch { /* non-fatal */ }
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
    list.innerHTML = `<div class="empty-list">${t('sidebar.empty_list')}</div>`;
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
    <button data-act="rename">${t('sidebar.menu.rename')}</button>
    <button data-act="delete">${t('sidebar.menu.delete')}</button>
  `;
  // Position below the button.
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${r.right - 140}px`;
  document.body.appendChild(menu);
  menu.querySelector('[data-act="rename"]').onclick = async () => {
    menu.remove();
    const next = prompt(t('sidebar.rename_prompt'), proj.name);
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
    if (!confirm(t('sidebar.delete_confirm', { name: proj.name }))) return;
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
  const exportBtn = document.getElementById('btn-export');

  nameInput.disabled = !p;
  nameInput.placeholder = p ? '' : t('app.no_project');
  nameInput.value = p?.name ?? '';

  pickBtn.disabled = !p;
  if (p && p.templateId) {
    const tpl = state.templates.find(x => x.id === p.templateId);
    pickBtn.classList.remove('empty');
    pickBtn.querySelector('.label').textContent = tpl ? tpl.name : p.templateId;
  } else {
    pickBtn.classList.add('empty');
    pickBtn.querySelector('.label').textContent = t('toolbar.template_pick');
  }

  // Frames-mode projects don't need a template to export — they have
  // frames[] directly. Single-frame projects still need a template until
  // the v0.x stub is gone.
  const hasFrames = !!(p && Array.isArray(p.frames) && p.frames.length > 0);
  exportBtn.disabled = !p || (!p.templateId && !hasFrames) || !!state.exporting;
  if (state.exporting) {
    exportBtn.textContent = state.exportProgress
      ? t('export.button_running', {
          pct: formatPct(state.exportProgress.pct),
          stage: state.exportProgress.stage,
        })
      : t('export.starting');
  } else {
    exportBtn.textContent = t('toolbar.export_mp4');
  }
  renderAgentPill();

  // Re-wire on every render so handlers always match the current DOM.
  wireToolbar();
}

/** Fill the top-bar Agent pill: current agent's logo + name + connection dot. */
function renderAgentPill() {
  const pill = document.getElementById('btn-agent');
  if (!pill) return;
  const p = state.selected;
  pill.disabled = !p;
  const dot = document.getElementById('agent-dot');
  const logo = document.getElementById('agent-pill-logo');
  const label = document.getElementById('agent-pill-label');
  if (!p) {
    label.textContent = t('toolbar.agent_none');
    logo.innerHTML = '';
    dot.className = 'agent-dot';
    return;
  }
  const currentId = p.agentId ?? (state.agents.find((a) => a.available && a.id !== 'amr')?.id ?? 'anthropic-api');
  const a = state.agents.find((x) => x.id === currentId);
  const available = a?.available ?? false;
  label.textContent = a?.name ?? currentId;
  logo.innerHTML = AGENT_LOGOS[currentId] ? `<img src="${esc(AGENT_LOGOS[currentId])}" alt="" />` : '';
  dot.className = 'agent-dot ' + (available ? 'ok' : 'missing');
  pill.title = available ? t('toolbar.agent_ready') : t('settings.agent.unavailable');
  renderModelSwitch(currentId);
}

/** Model picker — only for AMR (the one agent with a model catalog). Lazily
 *  fetches the live list, fills the dropdown, and persists the choice to the
 *  project so generation drives session/set_model with it. */
async function renderModelSwitch(currentAgentId) {
  const wrap = document.getElementById('model-switch');
  const sel = document.getElementById('model-select');
  if (!wrap || !sel) return;
  if (!state.selected || currentAgentId !== 'amr') { wrap.hidden = true; return; }
  wrap.hidden = false;
  // Fetch once per session; cache on state.
  if (!state._amrModels) {
    try {
      const data = await fetch('/api/agents/amr/models').then((r) => r.json());
      state._amrModels = data.models ?? [];
      state._amrDefaultModel = data.default ?? null;
    } catch { state._amrModels = []; }
  }
  const models = state._amrModels;
  if (!models.length) { wrap.hidden = true; return; }
  const chosen = state.selected.agentModel ?? state._amrDefaultModel ?? models[0].id;
  sel.innerHTML = models.map((m) => `<option value="${esc(m.id)}"${m.id === chosen ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  sel.onchange = async () => {
    if (!state.selected) return;
    try {
      await API.setAgent(state.selected.id, 'amr', sel.value);
      state.selected = (await API.getProject(state.selected.id)).project;
      toast(`✓ ${sel.value}`, 'success');
    } catch (e) { toast(`${e?.message ?? e}`, 'error'); }
  };
}

/** Open/refresh the top-bar agent dropdown. */
function renderAgentMenu() {
  const menu = document.getElementById('agent-menu');
  if (!menu || !state.selected) return;
  const currentId = state.selected.agentId ?? (state.agents.find((a) => a.available && a.id !== 'amr')?.id ?? 'anthropic-api');
  menu.innerHTML = state.agents.map((a) => {
    const cur = a.id === currentId ? ' current' : '';
    const logo = AGENT_LOGOS[a.id] ? `<img src="${esc(AGENT_LOGOS[a.id])}" alt="" />` : '';
    // AMR is "found but needs login": it can be made available by signing in,
    // unlike a genuinely missing CLI. Offer a login button instead of just
    // greying it out + the misleading "Not installed".
    const needsLogin = !a.available && a.id === 'amr' && !!a.hint;
    // Star the recommended agent (AMR) to draw the eye.
    const star = a.id === 'amr' ? `<span class="mi-star" title="${esc(t('agent.recommended'))}">★</span>` : '';
    const inner = `<span class="mi-dot ${a.available ? 'ok' : ''}"></span>
      <span class="mi-logo">${logo}</span>
      <span class="mi-name">${esc(a.name)}</span>${star}`;
    // AMR-needs-login: render the row as a DIV (not a button) so a real, separate
    // Sign-in <button> can live beside it — nesting a button inside a button is
    // invalid HTML and the outer one eats the inner one's clicks.
    if (needsLogin) {
      return `<div class="agent-menu-item is-unselectable" title="${esc(a.hint ?? '')}">
        ${inner}
        <button type="button" class="mi-login" data-login-agent="${esc(a.id)}">${esc(t('agent.sign_in'))}</button>
      </div>`;
    }
    const tag = a.available ? '' : `<span class="mi-tag">${esc(t('settings.agent.unavailable'))}</span>`;
    const unsel = a.available ? '' : ' is-unselectable';
    return `<button type="button" class="agent-menu-item${cur}${unsel}" data-agent-id="${esc(a.id)}" data-selectable="${a.available ? '1' : '0'}" title="${esc(a.hint ?? '')}">
      ${inner}${tag}
    </button>`;
  }).join('');
  menu.querySelectorAll('.agent-menu-item').forEach((item) => {
    item.onclick = async (e) => {
      // Login button inside the item: don't treat as agent-select.
      if (e.target.closest('.mi-login')) return;
      const aid = item.dataset.agentId;
      if (!state.selected || item.dataset.selectable !== '1') return;
      try {
        await API.setAgent(state.selected.id, aid);
        state.selected = (await API.getProject(state.selected.id)).project;
        toast(`✓ ${aid}`, 'success');
      } catch (e) {
        toast(`${e?.message ?? e}`, 'error');
      }
      closeAgentMenu();
      renderToolbar();
    };
  });
  // AMR "Sign in" → spawn `vela login` server-side (opens the browser), then
  // re-detect so the agent flips to available.
  menu.querySelectorAll('.mi-login').forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.busy === '1') return;
      const label = btn.textContent;
      btn.textContent = t('agent.signing_in');
      btn.dataset.busy = '1';
      btn.classList.add('busy');
      try {
        const res = await fetch(`/api/agents/${btn.dataset.loginAgent}/login`, { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.ok) {
          toast(t('agent.signed_in'), 'success');
          state.agents = (await fetch('/api/agents?force=1').then((r) => r.json())).agents ?? state.agents;
          renderAgentMenu();
          renderToolbar();
        } else {
          toast(data.error || t('agent.sign_in_failed'), 'error');
          btn.textContent = label; delete btn.dataset.busy; btn.classList.remove('busy');
        }
      } catch (err) {
        toast(`${err?.message ?? err}`, 'error');
        btn.textContent = label; delete btn.dataset.busy; btn.classList.remove('busy');
      }
    };
  });
}

function closeAgentMenu() {
  const menu = document.getElementById('agent-menu');
  if (menu) menu.hidden = true;
  document.removeEventListener('click', _agentMenuOutside, true);
}
function _agentMenuOutside(e) {
  const sw = document.getElementById('agent-switch');
  if (sw && !sw.contains(e.target)) closeAgentMenu();
}

// Wire toolbar elements — re-bind on every renderToolbar() so any DOM
// reuse / re-render can't strand stale event handlers. (Joey reported
// template + agent picks not responding in v0.6.2.)
function wireToolbar() {
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) settingsBtn.onclick = openSettingsModal;
  const pickBtn = document.getElementById('btn-pick-template');
  if (pickBtn) {
    pickBtn.onclick = (e) => {
      e.preventDefault();
      if (!state.selected) {
        toast(t('composer.placeholder.no_project'), 'error');
        return;
      }
      openGallery();
    };
  }
  // Top-bar agent switcher: pill toggles a dropdown to view status + switch.
  const agentBtn = document.getElementById('btn-agent');
  if (agentBtn) {
    agentBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.selected) { toast(t('composer.placeholder.no_project'), 'error'); return; }
      const menu = document.getElementById('agent-menu');
      if (!menu) return;
      if (menu.hidden) {
        renderAgentMenu();
        menu.hidden = false;
        // close on outside click (capture so it fires before re-open)
        setTimeout(() => document.addEventListener('click', _agentMenuOutside, true), 0);
      } else {
        closeAgentMenu();
      }
    };
  }
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.onclick = () => {
      if (!state.selected) return;
      if (state.exporting) return;
      startExportStream();
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
        <h2>${t('sidebar.projects')}</h2>
        <button class="new-project" id="btn-new">${t('sidebar.new')}</button>
        <button class="sidebar-toggle" id="btn-sidebar-toggle" title="${t('sidebar.collapse')}">‹</button>
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
                <button class="icon-btn" id="btn-attach" title="${t('composer.attach')}">📎</button>
                <input type="file" id="file-input" multiple style="display:none" />
                <span class="hint">${t('composer.hint')}</span>
                <button class="send-btn" id="btn-send" disabled>${t('composer.send')}</button>
              </div>
            </div>
          </div>
        </section>

        <section class="right-pane">
          <div class="preview-stage" id="preview-stage">
            <div class="preview-placeholder"><div><div class="ico">🎞️</div>${t('preview.placeholder.pick_template')}</div></div>
          </div>
          <div class="frames-strip" id="frames-strip"></div>
          <div class="right-footer">
            <span class="status" id="footer-status">${t('app.no_project')}</span>
            <span class="grow"></span>
            <button class="reload-btn" id="btn-reload">${t('preview.reload')}</button>
          </div>
          <details class="soundtrack-panel" id="soundtrack-panel">
            <summary>
              <span class="st-summary-main">${t('soundtrack.title')}</span>
              <span class="st-summary-sub">${t('soundtrack.summary_sub')}</span>
              <span class="soundtrack-badge">${t('soundtrack.optional')}</span>
            </summary>
            <div class="soundtrack-body">
              <!-- ===== Background music: its own input + generate ===== -->
              <div class="st-section">
                <div class="st-section-title">${t('soundtrack.music_label')}</div>
                <div class="st-presets" id="st-music-presets">
                  ${MUSIC_PRESETS.map((p) => `<button type="button" class="st-preset" data-prompt="${p.prompt}">${t('soundtrack.preset_' + p.key)}</button>`).join('')}
                </div>
                <textarea id="st-music-prompt" rows="2" placeholder="${t('soundtrack.music_placeholder')}"></textarea>
                <div class="st-vol-row"><label>${t('soundtrack.music_volume')} <input type="range" id="st-music-vol" min="-40" max="0" value="-18" /><b id="st-music-vol-val">-18 dB</b></label></div>
                <div class="st-section-actions">
                  <button class="st-generate" id="btn-st-gen-music">${t('soundtrack.gen_music')}</button>
                  <span class="st-status" id="st-music-status"></span>
                </div>
              </div>

              <!-- ===== Narration / voiceover: its own draft + generate ===== -->
              <div class="st-section">
                <div class="st-section-title">${t('soundtrack.narration_label')}
                  <span class="st-draft-group">
                    <button type="button" class="st-draft" id="btn-st-draft-frame">${t('soundtrack.draft_frame')}</button>
                    <button type="button" class="st-draft" id="btn-st-draft-all">${t('soundtrack.draft_all')}</button>
                  </span>
                </div>
                <span class="st-narration-which" id="st-narration-which"></span>
                <textarea id="st-narration-text" rows="2" placeholder="${t('soundtrack.narration_placeholder')}"></textarea>
                <div class="st-voice-row">
                  <span class="st-voice-label">${t('soundtrack.voice_label')}</span>
                  <select id="st-narration-voice" class="st-voice-select">
                    ${NARRATION_VOICES.map((v) => `<option value="${v.voiceId}">${t('soundtrack.voice_' + v.key)}</option>`).join('')}
                  </select>
                  <button type="button" class="st-fit" id="btn-st-fit" title="${t('soundtrack.fit_hint')}">${t('soundtrack.fit_durations')}</button>
                </div>
                <div class="st-vol-row"><label>${t('soundtrack.narration_volume')} <input type="range" id="st-narration-vol" min="-20" max="6" value="0" /><b id="st-narration-vol-val">0 dB</b></label></div>
                <div class="st-section-actions">
                  <button class="st-generate" id="btn-st-gen-narration">${t('soundtrack.gen_narration')}</button>
                  <span class="st-status" id="st-narration-status"></span>
                </div>
              </div>

              <div class="soundtrack-actions">
                <button class="st-clear" id="btn-st-clear">${t('soundtrack.clear')}</button>
              </div>
              <div class="soundtrack-preview" id="st-preview"></div>
            </div>
          </details>
        </section>

        <section class="text-pane">
          <div class="text-pane-head">
            <h2>${t('text_pane.title')}</h2>
            <span class="save-state" id="text-save-state">${t('text_pane.save_state.idle')}</span>
            <button class="textfields-toggle" id="btn-textfields-toggle" title="${t('text_pane.collapse')}">›</button>
          </div>
          <div class="text-fields" id="text-fields">
            <div class="text-empty">${t('text_pane.empty_no_frames')}</div>
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
          <h2>${t('app.empty_pick_create')}</h2>
          <p>${t('app.empty_subtitle')}</p></div></div>`}
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
    wireSoundtrackPanel();
  }
}

/**
 * Soundtrack panel: generate MiniMax music + narration, stream SSE progress,
 * preview the resulting MP3s. The generated tracks are stored on the project's
 * soundtrack and mixed in automatically at export time.
 */
function wireSoundtrackPanel() {
  const panel = document.getElementById('soundtrack-panel');
  if (!panel) return;
  const musicPrompt = document.getElementById('st-music-prompt');
  const narrationText = document.getElementById('st-narration-text');
  const musicVol = document.getElementById('st-music-vol');
  const narrationVol = document.getElementById('st-narration-vol');
  const musicVolVal = document.getElementById('st-music-vol-val');
  const narrationVolVal = document.getElementById('st-narration-vol-val');
  const genMusicBtn = document.getElementById('btn-st-gen-music');
  const genNarrationBtn = document.getElementById('btn-st-gen-narration');
  const clearBtn = document.getElementById('btn-st-clear');
  const musicStatusEl = document.getElementById('st-music-status');
  const narrationStatusEl = document.getElementById('st-narration-status');
  const previewEl = document.getElementById('st-preview');
  const draftFrameBtn = document.getElementById('btn-st-draft-frame');
  const draftAllBtn = document.getElementById('btn-st-draft-all');
  const whichEl = document.getElementById('st-narration-which');

  // Music style presets: click fills the prompt textarea (editable after).
  document.querySelectorAll('#st-music-presets .st-preset').forEach((btn) => {
    btn.onclick = () => {
      musicPrompt.value = btn.dataset.prompt || '';
      document.querySelectorAll('#st-music-presets .st-preset').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  // ---- Per-frame narration model ----------------------------------------
  // narrationByFrame: { [graphNodeId]: text }. The textarea always shows the
  // line for the CURRENTLY SELECTED frame (state.activeFrameId); editing it
  // writes back to that frame. Switching frames in the strip swaps the text.
  const sortedFrames = [...(state.selected?.frames ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const hasFrames = sortedFrames.length > 0;
  // Seed from saved soundtrack; migrate a legacy single narrationText onto frame 1.
  state._narrationByFrame = { ...(state.selected?.soundtrack?.narrationByFrame ?? {}) };
  if (!Object.keys(state._narrationByFrame).length && state.selected?.soundtrack?.narrationText && sortedFrames[0]) {
    state._narrationByFrame[sortedFrames[0].graphNodeId] = state.selected.soundtrack.narrationText;
  }
  const frameLabel = (fid) => {
    const i = sortedFrames.findIndex((f) => f.graphNodeId === fid);
    return i >= 0 ? `${t('soundtrack.frame_word')} ${i + 1}/${sortedFrames.length}` : '';
  };
  // Read frames LIVE from state (not the wire-time snapshot) so button state is
  // always correct no matter what changed it (generate / regen / switch / clear).
  const liveFrames = () => [...(state.selected?.frames ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const currentFrameId = () => state.activeFrameId ?? liveFrames()[0]?.graphNodeId ?? null;
  const syncNarrationField = () => {
    const frames = liveFrames();
    const has = frames.length > 0;
    const fid = currentFrameId();
    if (whichEl) {
      const i = frames.findIndex((f) => f.graphNodeId === fid);
      whichEl.textContent = has && i >= 0 ? `${t('soundtrack.frame_word')} ${i + 1}/${frames.length}` : '';
    }
    // Only overwrite the textarea when it isn't the user's in-progress edit.
    if (document.activeElement !== narrationText) {
      narrationText.value = (fid && state._narrationByFrame[fid]) || '';
    }
    const dis = !has || !fid;
    if (draftFrameBtn) { draftFrameBtn.disabled = dis; draftFrameBtn.title = dis ? t('soundtrack.draft_need_frames') : ''; }
    if (draftAllBtn) { draftAllBtn.disabled = !has; draftAllBtn.title = has ? '' : t('soundtrack.draft_need_frames'); }
    const fitBtn = document.getElementById('btn-st-fit');
    if (fitBtn) {
      const anyNarr = Object.values(state._narrationByFrame || {}).some((v) => (v || '').trim());
      fitBtn.disabled = !has || !anyNarr;
    }
  };
  // Persist edits back to the active frame as the user types.
  narrationText.oninput = () => {
    const fid = currentFrameId();
    if (fid) state._narrationByFrame[fid] = narrationText.value;
  };
  // Expose so ANY state change (frame switch, generation finished, regen, etc.)
  // can re-evaluate button enablement + the shown line without re-rendering the
  // whole panel. Called from renderPreview() — the convergence point all those
  // paths already hit — so buttons can never get stuck stale.
  window.__hvSyncNarration = syncNarrationField;
  syncNarrationField();

  async function draftNarration(frameId /* null = all */) {
    if (!state.selected) return;
    const btn = frameId ? draftFrameBtn : draftAllBtn;
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = t('soundtrack.drafting'); }
    try {
      const res = await fetch(`/api/projects/${state.selected.id}/draft-narration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: state.selected.agentId ?? (state.agents.find((a) => a.available && a.id !== 'amr')?.id ?? 'anthropic-api'),
          ...(frameId && { frameId }),
        }),
      });
      const data = await res.json();
      if (res.ok && data.narrationByFrame) {
        // Merge (single-frame draft only returns that frame; global returns all).
        Object.assign(state._narrationByFrame, data.narrationByFrame);
        syncNarrationField();
      } else {
        if (narrationStatusEl) narrationStatusEl.textContent = t('soundtrack.draft_failed', { message: data.error || `HTTP ${res.status}` });
      }
    } catch (e) {
      if (narrationStatusEl) narrationStatusEl.textContent = t('soundtrack.draft_failed', { message: (e?.message ?? e) });
    } finally {
      if (btn) { btn.textContent = label; }
      syncNarrationField();
    }
  }
  if (draftFrameBtn) draftFrameBtn.onclick = () => draftNarration(currentFrameId());
  if (draftAllBtn) draftAllBtn.onclick = () => draftNarration(null);

  // "Fit to narration": re-pace each frame's duration by its narration length.
  const fitBtn = document.getElementById('btn-st-fit');
  if (fitBtn) {
    const anyNarration = () => Object.values(state._narrationByFrame || {}).some((v) => (v || '').trim());
    fitBtn.disabled = !hasFrames || !anyNarration();
    fitBtn.onclick = async () => {
      if (!state.selected || !anyNarration()) return;
      const label = fitBtn.textContent;
      fitBtn.disabled = true; fitBtn.textContent = t('soundtrack.fitting');
      try {
        const res = await fetch(`/api/projects/${state.selected.id}/fit-durations`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ narrationByFrame: state._narrationByFrame }),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          toast(t('soundtrack.fitted', { sec: data.totalSec }), 'success');
          // Refresh frames so the strip + preview reflect the new per-frame durations.
          if (typeof renderPreview === 'function') renderPreview();
          if (typeof renderFramesStrip === 'function') renderFramesStrip();
        } else {
          toast(data.error || t('soundtrack.fit_failed'), 'error');
        }
      } catch (e) {
        toast(`${e?.message ?? e}`, 'error');
      } finally {
        fitBtn.textContent = label; fitBtn.disabled = !anyNarration();
      }
    };
  }

  // Restore previously generated soundtrack (music prompt + audio previews).
  const st = state.selected?.soundtrack;
  if (st) {
    if (st.musicPrompt) musicPrompt.value = st.musicPrompt;
    if (typeof st.musicVolumeDb === 'number') musicVol.value = String(st.musicVolumeDb);
    if (typeof st.narrationVolumeDb === 'number') narrationVol.value = String(st.narrationVolumeDb);
    renderSoundtrackPreview(st);
  }
  musicVolVal.textContent = `${musicVol.value} dB`;
  narrationVolVal.textContent = `${narrationVol.value} dB`;
  musicVol.oninput = () => { musicVolVal.textContent = `${musicVol.value} dB`; };
  narrationVol.oninput = () => { narrationVolVal.textContent = `${narrationVol.value} dB`; };

  clearBtn.onclick = async () => {
    if (!state.selected) return;
    await fetch(`/api/projects/${state.selected.id}/soundtrack`, { method: 'DELETE' });
    musicPrompt.value = '';
    narrationText.value = '';
    previewEl.innerHTML = '';
    if (musicStatusEl) musicStatusEl.textContent = '';
    if (narrationStatusEl) narrationStatusEl.textContent = '';
    if (state.selected) delete state.selected.soundtrack;
  };

  // Music and narration generate INDEPENDENTLY. `kind` decides which part of
  // the generate-audio payload we send + which button/status to drive.
  async function runGenerate(kind /* 'music' | 'narration' */) {
    if (!state.selected) return;
    const btn = kind === 'music' ? genMusicBtn : genNarrationBtn;
    const statusEl = kind === 'music' ? musicStatusEl : narrationStatusEl;
    const payload = {};
    if (kind === 'music') {
      const mp = musicPrompt.value.trim();
      if (!mp) { if (statusEl) statusEl.textContent = t('soundtrack.empty_music'); return; }
      payload.music = { prompt: mp, instrumental: true, volumeDb: Number(musicVol.value) };
    } else {
      // Stitch every frame's line in order into one narration track.
      const stitched = sortedFrames
        .map((f) => (state._narrationByFrame[f.graphNodeId] || '').trim())
        .filter((s) => s.length > 0).join('\n');
      const nt = stitched || narrationText.value.trim();
      if (!nt) { if (statusEl) statusEl.textContent = t('soundtrack.empty_narration'); return; }
      const voiceSel = document.getElementById('st-narration-voice');
      payload.narration = { text: nt, volumeDb: Number(narrationVol.value), byFrame: state._narrationByFrame, ...(voiceSel?.value && { voiceId: voiceSel.value }) };
    }

    const label = btn?.textContent;
    if (btn) btn.disabled = true;
    clearBtn.disabled = true;
    if (statusEl) statusEl.textContent = t('soundtrack.starting');

    let res;
    try {
      res = await fetch(`/api/projects/${state.selected.id}/generate-audio`, {
        method: 'POST',
        headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (statusEl) statusEl.textContent = t('soundtrack.failed', { message: (e?.message ?? e) });
      if (btn) btn.disabled = false; clearBtn.disabled = false; return;
    }
    if (!res.ok || !res.body) {
      if (statusEl) statusEl.textContent = t('soundtrack.failed', { message: `HTTP ${res.status}` });
      if (btn) btn.disabled = false; clearBtn.disabled = false; return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const line of events) {
          if (!line.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'audio_progress' && statusEl) {
            statusEl.textContent = ev.stage === 'music' ? t('soundtrack.progress_music') : t('soundtrack.progress_narration');
          } else if (ev.type === 'audio_done') {
            if (statusEl) statusEl.textContent = t('soundtrack.done');
            if (ev.project) state.selected = ev.project;
            renderSoundtrackPreview(ev.soundtrack);
          } else if (ev.type === 'audio_failed' && statusEl) {
            statusEl.textContent = t('soundtrack.failed', { message: ev.message });
          }
        }
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = t('soundtrack.failed', { message: (e?.message ?? e) });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      clearBtn.disabled = false;
    }
  }
  if (genMusicBtn) genMusicBtn.onclick = () => runGenerate('music');
  if (genNarrationBtn) genNarrationBtn.onclick = () => runGenerate('narration');
}

function renderSoundtrackPreview(soundtrack) {
  const previewEl = document.getElementById('st-preview');
  if (!previewEl || !soundtrack || !state.selected) return;
  const assets = state.selected.assets || [];
  const srcFor = (id) => {
    const a = assets.find((x) => x.id === id);
    return a?.path ? `/asset?path=${encodeURIComponent(a.path)}` : null;
  };
  const blocks = [];
  const musicSrc = soundtrack.musicAssetId && srcFor(soundtrack.musicAssetId);
  const narrSrc = soundtrack.narrationAssetId && srcFor(soundtrack.narrationAssetId);
  if (musicSrc) blocks.push(`<div class="st-track"><span>${t('soundtrack.music_ready')}</span><audio controls src="${musicSrc}"></audio></div>`);
  if (narrSrc) blocks.push(`<div class="st-track"><span>${t('soundtrack.narration_ready')}</span><audio controls src="${narrSrc}"></audio></div>`);
  previewEl.innerHTML = blocks.join('');
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
  const canType = !!p && !state.composing;
  const canSend = !!(p && availableAgents.length > 0 && !state.composing);
  ta.disabled = !canType;
  sendBtn.disabled = !canSend;

  // Focus chip: when a frame is pinned for single-frame iterate, show it
  // above the textarea so the user knows their next message will only
  // rewrite that frame. Click to clear.
  const shell = document.getElementById('composer-shell');
  if (shell) {
    let chip = shell.querySelector('.focus-chip');
    const focus = state.iterateFocusFrameId;
    if (focus) {
      const order = (p?.frames ?? []).find((f) => f.graphNodeId === focus)?.order ?? 0;
      const orderStr = String(order + 1).padStart(2, '0');
      const html = `🎯 ${t('composer.focus_chip', { order: orderStr, fid: '' })}<span class="fid">${esc(focus)}</span><button title="${t('composer.focus_clear')}" type="button">✕</button>`;
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'focus-chip';
        // Insert above attachments (or as first child).
        shell.insertBefore(chip, shell.firstChild);
      }
      chip.innerHTML = html;
      chip.querySelector('button').onclick = (e) => {
        e.stopPropagation();
        state.iterateFocusFrameId = null;
        renderComposer();
        renderFramesStrip();
      };
    } else if (chip) {
      chip.remove();
    }
  }

  ta.placeholder = !p ? t('composer.placeholder.no_project')
    : !agentsKnown ? t('composer.placeholder.detecting_agents')
    : availableAgents.length === 0 ? t('composer.placeholder.no_agent')
    : state.iterateFocusFrameId ? t('composer.placeholder.focus')
    : !p.templateId ? t('composer.placeholder.no_template')
    : t('composer.placeholder.with_template');
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
      <div style="font-weight:500;margin-bottom:6px;">${t('chat.empty.title')}</div>
      ${t('chat.empty.body')}
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
  // Update the live "total = per_frame × frames" readout for a form card.
  const updateFormTotal = (msgIdx) => {
    const totalEl = document.getElementById(`form-total-${msgIdx}`);
    if (!totalEl) return;
    const card = totalEl.closest('.form-card');
    const val = (key) => {
      const h = card?.querySelector(`.form-seg[data-form-key="${CSS.escape(key)}"] input[type="hidden"]`);
      return Number(h?.value || 0);
    };
    const pf = val('per_frame'), fc = val('frame_count');
    totalEl.textContent = pf > 0 && fc > 0 ? `${t('soundtrack.total_word') || 'Total'} ≈ ${pf * fc}s` : '';
  };
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
      updateFormTotal(Number(btn.dataset.formMsg));
    };
  });
  // Initial paint of any total readouts present.
  log.querySelectorAll('[id^="form-total-"]').forEach((el) => updateFormTotal(Number(el.id.replace('form-total-', ''))));
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
        toast(`${t('text_pane.save_state.error')}: ${missing}`, 'warn');
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
  log.querySelectorAll('[data-export-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.exportAction;
      const card = btn.closest('.export-done');
      const path = card?.querySelector('.export-path code')?.textContent ?? '';
      if (action === 'reveal') {
        await revealExportedFile();
      } else if (action === 'copy' && path) {
        try {
          await navigator.clipboard.writeText(path);
          toast(t('export.copied'), 'success');
        } catch (e) {
          toast(t('export.copy_failed', { message: (e?.message ?? e) }), 'error');
        }
      }
    });
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
      return `<div class="msg user">${t('chat.summary.form_submitted')}</div>`;
    }
    if ((m.content ?? '').trim() === '[hv-confirm:generate]') {
      return `<div class="msg user">${t('chat.summary.confirm_generate')}</div>`;
    }
    if ((m.content ?? '').trim() === '[hv-confirm:edit]') {
      return `<div class="msg user">${t('chat.summary.confirm_edit')}</div>`;
    }
    return `<div class="msg user">${esc(m.content)}</div>`;
  }
  if (m.role === 'system') return `<div class="msg system">${esc(m.content)}</div>`;
  if (m.role === 'preview-event') return `<div class="msg preview-event">${esc(m.content)}</div>`;
  if (m.role === 'thinking') return `<div class="msg thinking">${esc(m.content || t('chat.thinking'))}</div>`;
  if (m.role === 'export-done') {
    const path = m.content || '';
    const fname = path.split('/').pop() || 'output.mp4';
    return `<div class="msg export-done">
      <div class="export-title">${t('export.title')}</div>
      <div class="export-path"><code>${esc(path)}</code></div>
      <div class="export-actions">
        <button class="btn-reveal" data-export-action="reveal">${t('export.reveal')}</button>
        <button class="btn-copy-path" data-export-action="copy">${t('export.copy_path')}</button>
      </div>
      <div class="export-fname">${esc(fname)}</div>
    </div>`;
  }
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
      <div class="body">${md(sanitizeAssistantProse(formP.prose))}${formHtml}</div>
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
      <div class="body">${md(sanitizeAssistantProse(confirmP.prose))}${confirmHtml}</div>
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
    <div class="body">${md(sanitizeAssistantProse(prose))}${optionsHtml}</div>
  </div>`;
}

/**
 * Strip HTML / content-graph code blocks from assistant text before render.
 * Streaming text comes in raw — without this the user sees a wall of CSS /
 * JSX / HTML scrolling past. We replace each block with a one-line collapsed
 * marker so they know something is being generated, but don't have to read
 * 600 lines of style declarations.
 *
 * Acts on render only; the underlying message content is untouched, so the
 * server's persisted "✓ frame X updated" summary still wins on reload.
 */
function sanitizeAssistantProse(text) {
  if (!text) return text;
  let out = text;
  const genHtml = t('chat.placeholder.gen_html');
  const planGraph = t('chat.placeholder.plan_graph');
  // ```html ... ``` (full block) — closed
  out = out.replace(/```html(?:#[\w-]+)?\s*\n[\s\S]*?```/gi, `\n${genHtml}\n`);
  // ```html ... (still open, mid-stream) — clip everything after the fence
  out = out.replace(/```html(?:#[\w-]+)?\s*\n[\s\S]*$/i, `\n${genHtml}`);
  // ```json#content-graph ...```
  out = out.replace(/```json#content-graph\s*\n[\s\S]*?```/gi, `\n${planGraph}\n`);
  out = out.replace(/```json#content-graph\s*\n[\s\S]*$/i, `\n${planGraph}`);
  // ```hv-form / ```hv-confirm / ```hv-options blocks are parsed by their
  // own renderers above; if we got here they slipped past — collapse them.
  out = out.replace(/```hv-(?:form|confirm|options)\s*\n[\s\S]*?```/gi, '');
  return out;
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
    const hintHtml = f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : '';
    return `<div class="form-field">
      <label>${esc(label)}${required}${hintHtml}</label>
      ${control}
    </div>`;
  }).join('');
  // Live total-duration readout when the form paces by per-frame × frames.
  const hasPerFrame = fields.some((f) => f.key === 'per_frame') && fields.some((f) => f.key === 'frame_count');
  const totalHtml = hasPerFrame && !submitted
    ? `<div class="form-total" id="form-total-${msgIdx}"></div>`
    : '';
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
    ${totalHtml}
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
    stage.innerHTML = `<div class="preview-placeholder"><div><div class="ico">🎞️</div>${t('preview.placeholder.pick_project')}</div></div>`;
    renderFramesStrip();
    return;
  }
  // No template + no prior preview → show "send a chat first" placeholder
  if (!p.templateId && !p.lastPreviewHtmlPath) {
    stage.innerHTML = `<div class="preview-placeholder"><div><div class="ico">🎞️</div>${t('preview.placeholder.pick_template')}</div></div>`;
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
  // sandbox now grants same-origin so we can attach a text-edit overlay
  // from the parent window. allow-scripts keeps the page's own animations
  // running. forms / popups / top-navigation stay blocked.
  stage.innerHTML = `<div class="preview-frame ${state.editTextMode ? 'editing' : ''}">
    <iframe id="preview-iframe" sandbox="allow-scripts allow-same-origin" src="${iframeSrc}"></iframe>
    ${stamp ? `<div class="stamp">${esc(stamp)}</div>` : ''}
    <button class="edit-toggle" id="btn-edit-text"
      title="${state.editTextMode ? t('preview.edit_text_done_title') : t('preview.edit_text_title')}">
      ${state.editTextMode ? t('preview.edit_text_on') : t('preview.edit_text_off')}
    </button>
  </div>`;
  attachPreviewScaler();
  const editBtn = document.getElementById('btn-edit-text');
  if (editBtn) editBtn.onclick = togglePreviewEdit;
  // If the user just toggled into edit mode, attach the overlay once the
  // iframe loads. If already in edit mode and we re-rendered, attach now
  // (iframe might already be loaded when reusing a cached preview).
  const iframe = document.getElementById('preview-iframe');
  if (iframe && state.editTextMode) {
    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
      attachTextEditOverlay(iframe);
    } else {
      iframe.addEventListener('load', () => attachTextEditOverlay(iframe), { once: true });
    }
  }
  renderFramesStrip();
  // Convergence point for every frame/preview change → keep soundtrack buttons
  // (draft / fit) and the per-frame narration line in sync, regardless of which
  // path triggered the change.
  if (typeof window.__hvSyncNarration === 'function') window.__hvSyncNarration();
}

function togglePreviewEdit() {
  state.editTextMode = !state.editTextMode;
  // When leaving edit mode, force-reload preview so any in-iframe styling
  // is dropped cleanly.
  renderPreview();
}

// Inject hover highlight + click-to-edit on every [data-hv-text] node in
// the preview iframe. On commit we replace text content in the iframe DOM,
// serialize it, and PUT to the right endpoint (frame-specific or whole-
// project preview).
function attachTextEditOverlay(iframe) {
  let doc;
  try { doc = iframe.contentDocument; } catch (err) {
    console.warn('[hv-edit] iframe.contentDocument blocked:', err);
    return;
  }
  if (!doc) {
    console.warn('[hv-edit] iframe.contentDocument is null (still loading? sandbox blocking?)');
    return;
  }
  if (!doc.body) {
    console.warn('[hv-edit] iframe document has no body yet — re-attaching on next load tick');
    iframe.addEventListener('load', () => attachTextEditOverlay(iframe), { once: true });
    return;
  }
  const tagged = doc.querySelectorAll('[data-hv-text]');
  console.log(`[hv-edit] attached overlay; found ${tagged.length} [data-hv-text] elements`);
  if (tagged.length === 0) {
    toast(t('preview.no_hv_text'), 'warn');
  }
  // Idempotent: tear down any prior overlay first.
  doc.querySelectorAll('[data-hv-edit-style]').forEach((el) => el.remove());
  const style = doc.createElement('style');
  style.setAttribute('data-hv-edit-style', '');
  style.textContent = `
    [data-hv-text] { outline: 1px dashed rgba(201, 100, 66, .6) !important;
      outline-offset: 3px !important; cursor: text !important;
      transition: outline-color .12s, background .12s; }
    [data-hv-text]:hover { outline: 2px solid rgb(201, 100, 66) !important;
      background: rgba(201, 100, 66, .08) !important; }
    [data-hv-text][contenteditable="true"] { outline: 2px solid rgb(201, 100, 66) !important;
      outline-offset: 3px !important; background: rgba(201, 100, 66, .12) !important; }
  `;
  (doc.head || doc.documentElement).appendChild(style);

  let dirty = false;
  const enableEdit = (el) => {
    if (el.getAttribute('contenteditable') === 'true') return;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    // Place caret at end
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = doc.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  };
  const finishEdit = async (el) => {
    if (el.getAttribute('contenteditable') !== 'true') return;
    el.removeAttribute('contenteditable');
    if (!dirty) return;
    dirty = false;
    await commitInlineTextEdits(iframe);
  };

  doc.addEventListener('click', (e) => {
    const target = e.target.closest('[data-hv-text]');
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    enableEdit(target);
  }, true);
  doc.addEventListener('input', (e) => {
    if (e.target.closest && e.target.closest('[data-hv-text]')) {
      dirty = true;
    }
  });
  doc.addEventListener('keydown', (e) => {
    const target = e.target.closest && e.target.closest('[data-hv-text][contenteditable="true"]');
    if (!target) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); target.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); target.blur(); }
  });
  doc.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('[data-hv-text][contenteditable="true"]')) {
      finishEdit(t);
    }
  }, true);
}

async function commitInlineTextEdits(iframe) {
  if (!state.selected) return;
  const projectId = state.selected.id;
  const fid = state.activeFrameId;
  const url = fid
    ? `/api/projects/${projectId}/frames/${encodeURIComponent(fid)}/raw-html`
    : `/api/projects/${projectId}/raw-html`;
  // Read the current frame HTML from disk, walk its [data-hv-text] nodes,
  // sync each one's text from the iframe DOM. We do server-side merging
  // on the client to keep it simple.
  let serverHtml;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch failed ${r.status}`);
    serverHtml = await r.text();
  } catch (e) {
    toast(`保存失败：${e.message}`, 'error');
    return;
  }
  const parser = new DOMParser();
  const target = parser.parseFromString(serverHtml, 'text/html');
  const live = iframe.contentDocument;
  const liveByKey = new Map();
  if (live) {
    live.querySelectorAll('[data-hv-text]').forEach((el) => {
      const k = el.getAttribute('data-hv-text');
      if (k) liveByKey.set(k, el.textContent ?? '');
    });
  }
  let changed = 0;
  target.querySelectorAll('[data-hv-text]').forEach((el) => {
    const k = el.getAttribute('data-hv-text');
    if (!k || !liveByKey.has(k)) return;
    const newText = liveByKey.get(k);
    if (el.textContent !== newText) {
      el.textContent = newText;
      changed += 1;
    }
  });
  if (changed === 0) return;
  // Serialize the doc + ship it back.
  const out = '<!doctype html>\n' + target.documentElement.outerHTML;
  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: out }),
    });
    if (!r.ok) throw new Error(`save failed ${r.status}`);
    toast(`已保存 ${changed} 处修改`, 'success');
    // Refresh local project state so frames-strip thumbnails cache-bust.
    if (fid) {
      const pr = await API.getProject(projectId);
      state.selected = pr.project;
      renderFramesStrip();
    }
  } catch (e) {
    toast(`保存失败：${e.message}`, 'error');
  }
}

// Keep --preview-scale on .preview-frame in sync with its rendered width
// so the 1920×1080 iframe shrinks proportionally rather than getting
// cropped by a smaller viewport.
let _previewResizeObserver = null;
function attachPreviewScaler() {
  const frame = document.querySelector('.preview-frame');
  if (!frame) return;
  const apply = () => {
    const w = frame.clientWidth;
    if (!w) return;
    frame.style.setProperty('--preview-scale', (w / 1920).toFixed(4));
  };
  apply();
  if (_previewResizeObserver) _previewResizeObserver.disconnect();
  _previewResizeObserver = new ResizeObserver(apply);
  _previewResizeObserver.observe(frame);
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
    const isActive = f.graphNodeId === state.activeFrameId;
    const isFocus = f.graphNodeId === state.iterateFocusFrameId;
    const cls = ['frame-tab', isActive && 'active', isFocus && 'focus']
      .filter(Boolean).join(' ');
    const src = `/preview/${p.id}/frame/${encodeURIComponent(f.graphNodeId)}?thumb=1&v=${ver}`;
    return `<button class="${cls}" data-fid="${esc(f.graphNodeId)}">
      <div class="frame-thumb">
        <iframe sandbox="allow-scripts" src="${src}" tabindex="-1" loading="lazy"></iframe>
        ${isFocus ? '<div class="focus-mark" title="正在编辑此帧">✎</div>' : ''}
      </div>
      <div class="frame-tab-label">
        <span class="order">${String(f.order + 1).padStart(2, '0')}</span>
        <span class="fid">${esc(f.graphNodeId)}</span>
      </div>
    </button>`;
  }).join('');
  strip.innerHTML = `<span class="label">${t('frames.label')}</span>${tabs}
    <button class="frame-graph-btn" id="btn-show-graph">${t('frames.view_graph')}</button>`;
  // Single-click: switch which frame is shown in the centre preview.
  // Double-click: pin this frame as the iteration target so subsequent
  // chat messages only rewrite this frame. Click another / dbl-click the
  // same one to clear.
  strip.querySelectorAll('button.frame-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fid = btn.dataset.fid;
      state.activeFrameId = fid;
      // First click also pins focus so the user doesn't have to dbl-click —
      // but only when nothing else is focused, or they're switching to a new
      // frame. Clicking the already-focused frame again clears focus.
      if (state.iterateFocusFrameId === fid) {
        state.iterateFocusFrameId = null;
      } else {
        state.iterateFocusFrameId = fid;
      }
      renderPreview();
      renderComposer();
      // Refresh the right-pane Frame text editor to point at the newly
      // active frame's data-hv-text values.
      refreshTextFields();
      // Soundtrack narration is per-frame — point the textarea at this frame.
      if (typeof window.__hvSyncNarration === 'function') window.__hvSyncNarration();
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
/**
 * Source the HTML the right-side editor reads. For multi-frame projects
 * we follow `state.activeFrameId` so clicking a frame in the strip swaps
 * the editor over to that frame; otherwise fall back to the whole-project
 * preview HTML.
 */
async function fetchActiveFrameHtml() {
  if (!state.selected) return null;
  const fid = state.activeFrameId;
  const url = fid
    ? `/api/projects/${state.selected.id}/frames/${encodeURIComponent(fid)}/raw-html`
    : `/api/projects/${state.selected.id}/raw-html`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function refreshTextFields() {
  if (!state.selected) {
    state.textFields = [];
    renderTextFields();
    return;
  }
  // We used to gate this on a templateId, but frames-mode projects are
  // template-free and still have hv-text fields worth showing.
  const html = await fetchActiveFrameHtml();
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
    wrap.innerHTML = `<div class="text-empty">${t('text_pane.no_project')}</div>`;
    return;
  }
  if (state.textFields.length === 0) {
    const hasFrames = (state.selected.frames?.length ?? 0) > 0;
    const hint = hasFrames ? t('text_pane.empty_with_frames') : t('text_pane.empty_no_frames');
    wrap.innerHTML = `<div class="text-empty">${hint}</div>`;
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
  // Read the SAME source we'll write back to — the active frame's HTML
  // when there is one, otherwise the whole-project preview.
  const html = await fetchActiveFrameHtml();
  if (!html) { setSaveState('error', 'error'); return; }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const f of state.textFields) {
    const nodes = doc.querySelectorAll(`[data-hv-text="${cssEscape(f.key)}"]`);
    nodes.forEach((n) => { n.textContent = f.current; });
    f.original = f.current;
  }
  // Serialize back: include doctype because DOMParser drops it
  const serialized = '<!doctype html>\n' + doc.documentElement.outerHTML;
  const fid = state.activeFrameId;
  const url = fid
    ? `/api/projects/${state.selected.id}/frames/${encodeURIComponent(fid)}/raw-html`
    : `/api/projects/${state.selected.id}/raw-html`;
  let r;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: serialized }),
    });
    r = await res.json();
  } catch (e) {
    setSaveState('error: ' + (e?.message ?? e), 'error');
    return;
  }
  if (r?.error) {
    setSaveState('error: ' + r.error, 'error');
    return;
  }
  // Refresh project so frames-strip thumbnails cache-bust.
  if (fid) {
    try {
      const pr = await API.getProject(state.selected.id);
      state.selected = pr.project;
      renderFramesStrip();
    } catch {}
  } else if (r?.project) {
    state.selected = r.project;
  }
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

  // Intent shortcut: if the message is a clear "export to MP4" command
  // and there's something to export, run the export flow directly
  // instead of routing through the agent. The agent has nothing useful
  // to add for a deterministic export action.
  const p = state.selected;
  const canExport = !!(p && (p.templateId || (p.frames?.length ?? 0) > 0));
  if (canExport && !hasAttachments && isExportIntent(text)) {
    ta.value = '';
    state.messages.push({ role: 'user', content: text, ts: Date.now() });
    renderChatLog();
    startExportStream();
    return;
  }

  ta.value = '';
  state.composing = true;
  // The project this send belongs to — used to ignore late events / not clobber
  // a different project if the user switches away mid-generation.
  const genProjectId = state.selectedId;
  renderComposer();

  // Iterate scope: when the user has selected a specific frame in the
  // strip, the iterate-phase server route should only rewrite that frame.
  // We pass the focus along on every send (server uses it only for iterate).
  const focusFrame = state.iterateFocusFrameId || '';

  // User message includes attachment summary + focus chip
  const attSummary = hasAttachments
    ? `\n\n📎 ${state.pendingAttachments.length} attachment(s): ${state.pendingAttachments.map(a => a.name).join(', ')}`
    : '';
  const focusSummary = focusFrame ? `\n\n🎯 focus: frame ${focusFrame}` : '';
  state.messages.push({
    role: 'user',
    content: text + attSummary + focusSummary,
    ts: Date.now(),
    ...(focusFrame ? { focusFrameId: focusFrame } : {}),
  });
  state.messages.push({ role: 'thinking', content: t('chat.thinking'), ts: Date.now() });
  const thinkingIdx = state.messages.length - 1;
  renderChatLog();

  let assistantIdx = -1;

  try {
    let res;
    if (hasAttachments) {
      const fd = new FormData();
      fd.append('content', text);
      if (focusFrame) fd.append('focus_frame_id', focusFrame);
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
        body: JSON.stringify({
          content: text,
          ...(focusFrame ? { focus_frame_id: focusFrame } : {}),
        }),
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
      // If the user switches away mid-generation, stop rendering its events into
      // the (now different) active project — the backend keeps running and
      // persists the result, so it's there when they switch back.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (state.selectedId !== genProjectId) { try { await reader.cancel(); } catch {} break; }
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
            const focusedFrame = ev.focused_frame;
            const summary = focusedFrame
              ? `✓ frame ${focusedFrame} updated`
              : frameCount > 0
                ? `✓ ${frameCount}-frame storyboard generated`
                : '✓ HTML preview updated';
            const event = focusedFrame
              ? `🎞 frame ${focusedFrame} reloaded`
              : frameCount > 0
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
            renderPreview(); // also re-syncs soundtrack buttons via __hvSyncNarration
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
    // Only surface the error if we're still on the project that started this
    // send — otherwise it's just the user having navigated away.
    if (state.selectedId === genProjectId) {
      state.messages[thinkingIdx] = { role: 'system', content: '⚠️ ' + (e.message ?? e), ts: Date.now() };
      renderChatLog();
    }
  }
  // Don't clobber composing if the user already switched to another project
  // (which may have its own generation running).
  if (state.selectedId === genProjectId) {
    state.composing = false;
    renderComposer();
  }
}

// ============== gallery modal ==============
function openGallery() {
  if (!state.selected) return;
  document.getElementById('gallery-modal').classList.add('show');
  const grid = document.getElementById('gallery');

  // Each card's iframe loads the template's actual entry HTML (`index.html`,
  // dropped under templates/<id>/ so /template-asset/<id>/index.html serves
  // it). The 1920×1080 (or 1080×1920) source is transform-scaled to fit
  // the card via a CSS variable set per-card after layout.
  grid.innerHTML = state.templates.map(t => {
    const sel = state.selected?.templateId === t.id ? ' selected' : '';
    const tags = (t.tags || []).slice(0, 4).map((tg) => `<span class="tag">${esc(tg)}</span>`).join('');
    const portrait = isPortraitTemplate(t);
    const entry = templateEntryPath(t);
    // Poster-mode templates (entry only stitches sub-comps via
    // data-composition-src) iframe-render blank until the HF player ships —
    // show the shipped poster instead. Falls back to the iframe when the
    // backend couldn't find a poster file (poster_url null).
    const inner =
      t.preview_mode === 'poster' && t.poster_url
        ? `<img class="poster" src="${esc(t.poster_url)}" alt="${esc(t.name ?? t.id)}" loading="lazy" />`
        : `<iframe sandbox="allow-scripts allow-same-origin" src="/template-asset/${esc(t.id)}/${esc(entry)}" loading="lazy"></iframe>`;
    return `<div class="gallery-card${sel}" data-id="${t.id}">
      <div class="preview ${portrait ? 'portrait' : ''}" data-portrait="${portrait}">
        ${inner}
      </div>
      <div class="meta">
        <div class="name">${esc(t.name)}</div>
        <div class="desc">${esc(t.description ?? '')}</div>
        <div class="tags">${tags}</div>
      </div>
    </div>`;
  }).join('');

  // Click → open the fullscreen preview modal so the user can confirm
  // before applying. Replaces the old "click immediately replaces template"
  // behaviour, which never let the user actually see the candidate first.
  grid.querySelectorAll('.gallery-card').forEach(card => {
    card.onclick = () => {
      const tid = card.dataset.id;
      const tpl = state.templates.find((x) => x.id === tid);
      if (tpl) openTemplatePreviewModal(tpl);
    };
  });

  // Resize observer recomputes --gallery-scale per card so 1920×1080 fits
  // the actual rendered card width.
  setTimeout(() => applyGalleryScales(grid), 0);
  if (galleryResizeObserver) galleryResizeObserver.disconnect();
  galleryResizeObserver = new ResizeObserver(() => applyGalleryScales(grid));
  grid.querySelectorAll('.gallery-card .preview').forEach((p) => galleryResizeObserver.observe(p));
}

let galleryResizeObserver = null;
function applyGalleryScales(grid) {
  grid.querySelectorAll('.gallery-card .preview').forEach((p) => {
    const w = p.clientWidth;
    if (!w) return;
    const portrait = p.dataset.portrait === 'true';
    // Landscape fills the 16:9 box by width. Portrait keeps the same 16:9
    // box but is scaled to fit the box HEIGHT (1080×1920 → fit by height,
    // centred), so its card stays the same height as the rest of the grid.
    const scale = portrait ? p.clientHeight / 1920 : w / 1920;
    p.style.setProperty('--gallery-scale', scale.toFixed(4));
  });
}

function isPortraitTemplate(t) {
  const aspects = t?.output?.resolution?.supported_aspects ?? [];
  return aspects.includes('9:16') && !aspects.includes('16:9');
}

function templateEntryPath(t) {
  // The template's entry HTML is declared as `source_entry` in its
  // template.html-video.yaml — some templates use `source/index.html`,
  // others a top-level `index.html`. The /api/templates response now
  // surfaces this field; fall back to `index.html` only if it's missing.
  const entry = t?.source_entry;
  return typeof entry === 'string' && entry ? entry : 'index.html';
}

function closeGallery() {
  document.getElementById('gallery-modal').classList.remove('show');
  if (galleryResizeObserver) {
    galleryResizeObserver.disconnect();
    galleryResizeObserver = null;
  }
}

// ============== Template fullscreen preview ==============
let _tplPreviewResizeObserver = null;
let _tplPreviewCurrent = null;
function openTemplatePreviewModal(tpl) {
  _tplPreviewCurrent = tpl;
  const modal = document.getElementById('tpl-preview-modal');
  if (!modal) return;
  modal.classList.add('show');

  document.getElementById('tpl-preview-name').textContent = tpl.name ?? tpl.id;
  document.getElementById('tpl-preview-desc').textContent = tpl.description ?? '';
  const dur = tpl?.output?.duration?.default_sec ?? tpl?.output?.duration?.max_sec ?? '?';
  const fps = tpl?.output?.fps?.default ?? '?';
  const aspect = (tpl?.output?.resolution?.supported_aspects ?? [])[0] ?? '16:9';
  document.getElementById('tpl-preview-meta').textContent = t('tpl_preview.fps_dur', {
    fps, duration: dur, aspect,
  });

  const frame = document.getElementById('tpl-preview-frame');
  const portrait = isPortraitTemplate(tpl);
  frame.classList.toggle('portrait', portrait);

  const iframe = document.getElementById('tpl-preview-iframe');
  const poster = document.getElementById('tpl-preview-poster');
  const entry = templateEntryPath(tpl);
  // Poster-mode templates render blank in a live iframe (need the unbuilt HF
  // player) — show the shipped poster instead. Fall back to the iframe if the
  // backend reported no poster file (poster_url null).
  const usePoster = tpl.preview_mode === 'poster' && tpl.poster_url;
  if (usePoster) {
    iframe.src = 'about:blank';
    iframe.hidden = true;
    poster.src = `${tpl.poster_url}?t=${Date.now()}`;
    poster.hidden = false;
  } else {
    poster.src = '';
    poster.hidden = true;
    iframe.hidden = false;
    iframe.src = `/template-asset/${encodeURIComponent(tpl.id)}/${entry}?t=${Date.now()}`;
  }

  const apply = () => {
    const w = frame.clientWidth;
    const h = frame.clientHeight;
    if (!w || !h) return;
    const baseW = portrait ? 1080 : 1920;
    const baseH = portrait ? 1920 : 1080;
    const s = Math.min(w / baseW, h / baseH);
    frame.style.setProperty('--tpl-preview-scale', s.toFixed(4));
  };
  apply();
  if (_tplPreviewResizeObserver) _tplPreviewResizeObserver.disconnect();
  _tplPreviewResizeObserver = new ResizeObserver(apply);
  _tplPreviewResizeObserver.observe(frame);

  const useBtn = document.getElementById('tpl-preview-use');
  const cancelBtn = document.getElementById('tpl-preview-cancel');
  const closeBtn = document.getElementById('tpl-preview-close');

  // If the project already has this template applied, downgrade the primary
  // action to a no-op "in use" label so the user doesn't reapply needlessly.
  const isCurrent = state.selected?.templateId === tpl.id;
  useBtn.textContent = isCurrent
    ? t('settings.agent.in_use')
    : t('tpl_preview.use');
  useBtn.disabled = isCurrent;

  useBtn.onclick = async () => {
    if (!state.selected) return;
    // If the project already has a different template applied, confirm
    // before replacing — the user may have been just exploring.
    const current = state.selected.templateId;
    if (current && current !== tpl.id) {
      if (!confirm(t('tpl_preview.replace_confirm', { name: tpl.name ?? tpl.id }))) return;
    }
    useBtn.disabled = true;
    try {
      await API.setTemplate(state.selected.id, tpl.id);
      closeTemplatePreviewModal();
      closeGallery();
      await selectProject(state.selected.id);
      toast(t('tpl_preview.applied', { name: tpl.name ?? tpl.id }), 'success');
    } finally {
      useBtn.disabled = false;
    }
  };
  cancelBtn.onclick = closeTemplatePreviewModal;
  closeBtn.onclick = closeTemplatePreviewModal;
}

function closeTemplatePreviewModal() {
  const modal = document.getElementById('tpl-preview-modal');
  if (modal) modal.classList.remove('show');
  if (_tplPreviewResizeObserver) {
    _tplPreviewResizeObserver.disconnect();
    _tplPreviewResizeObserver = null;
  }
  // Stop the iframe from continuing to play in the background.
  const iframe = document.getElementById('tpl-preview-iframe');
  if (iframe) iframe.src = 'about:blank';
  const poster = document.getElementById('tpl-preview-poster');
  if (poster) { poster.src = ''; poster.hidden = true; }
  _tplPreviewCurrent = null;
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
    if (!name) { toast(t('modal.new.name_required'), 'error'); return; }
    const r = await API.createProject({ name, ...(intent && { intent }) });
    closeNewModal();
    await refreshProjects();
    await selectProject(r.project.id);
    toast(t('modal.new.created', { name }), 'success');
  };
  document.getElementById('new-modal').addEventListener('click', e => {
    if (e.target.id === 'new-modal') closeNewModal();
  });
  document.getElementById('gallery-close').onclick = closeGallery;
  document.getElementById('gallery-modal').addEventListener('click', e => {
    if (e.target.id === 'gallery-modal') closeGallery();
  });
  // Settings
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal) {
    document.getElementById('settings-close').onclick = closeSettingsModal;
    settingsModal.addEventListener('click', (e) => {
      if (e.target.id === 'settings-modal') closeSettingsModal();
    });
    settingsModal.querySelectorAll('.settings-nav-item').forEach((btn) => {
      btn.onclick = () => {
        settingsModal.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderSettingsPanel(btn.dataset.settingsTab);
      };
    });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeNewModal();
      closeGallery();
      closeSettingsModal();
    }
  });
}

// ============== Settings modal ==============
// Real brand logos (SVG, copied from open-design/agent-icons). Served from
// /agent-icons/<id>.svg. Agents without a brand logo fall back to a glyph.
const AGENT_LOGOS = {
  'anthropic-api': '/agent-icons/anthropic.svg',
  'claude': '/agent-icons/claude.svg',
  'cursor-agent': '/agent-icons/cursor-agent.svg',
  'codex': '/agent-icons/codex.svg',
  'hermes': '/agent-icons/hermes.svg',
  'amr': '/agent-icons/amr.svg',
};
const AGENT_ICON_FALLBACK = {
  'anthropic-api': '☁️',
  'gemini': '🟦',
  'grok': '🟪',
};
function agentIconHtml(id) {
  const logo = AGENT_LOGOS[id];
  if (logo) return `<img src="${esc(logo)}" alt="" class="agent-logo" />`;
  return AGENT_ICON_FALLBACK[id] || '⚙️';
}
const AGENT_DESC = {
  'anthropic-api': 'Direct Messages API · streams reliably',
  'claude': 'Claude Code (claude --print)',
  'cursor-agent': 'Cursor command line',
  'codex': 'Codex CLI (codex exec)',
  'hermes': 'Hermes ACP CLI',
};

function openSettingsModal(tab = 'agent') {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.add('show');
  modal.querySelectorAll('.settings-nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.settingsTab === tab);
  });
  renderSettingsPanel(tab);
}
function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('show');
}

function renderSettingsPanel(tab) {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;
  if (tab === 'audio') return renderSettingsAudio(panel);
  if (tab === 'language') return renderSettingsLanguage(panel);
  if (tab === 'about') return renderSettingsAbout(panel);
  return renderSettingsAgent(panel);
}

async function renderSettingsAudio(panel) {
  panel.innerHTML = `
    <h3>${esc(t('settings.audio.title'))}</h3>
    <div class="panel-sub">${esc(t('settings.audio.subtitle'))}</div>
    <div class="audio-config" id="audio-config">
      <div class="audio-status" id="audio-status">${esc(t('settings.audio.loading'))}</div>
      <label class="audio-field">
        <span>${esc(t('settings.audio.api_key'))}</span>
        <input type="password" id="mm-api-key" placeholder="${esc(t('settings.audio.api_key_placeholder'))}" autocomplete="off" />
      </label>
      <label class="audio-field">
        <span>${esc(t('settings.audio.base_url'))}</span>
        <input type="text" id="mm-base-url" placeholder="https://api.minimaxi.chat/v1" autocomplete="off" />
      </label>
      <div class="audio-actions">
        <button class="audio-save primary-action" id="mm-save" style="background:var(--accent);border-color:var(--accent);color:var(--accent-fg)">${esc(t('settings.audio.save'))}</button>
        <button class="audio-clear" id="mm-clear">${esc(t('settings.audio.clear'))}</button>
        <span class="audio-save-state" id="mm-save-state"></span>
      </div>
      <p class="panel-sub" style="font-size:11.5px;margin-top:4px">${esc(t('settings.audio.hint'))}</p>
    </div>
  `;

  const statusEl = panel.querySelector('#audio-status');
  const keyInput = panel.querySelector('#mm-api-key');
  const baseInput = panel.querySelector('#mm-base-url');
  const saveState = panel.querySelector('#mm-save-state');

  const refresh = async () => {
    try {
      const s = await fetch('/api/config/minimax').then((r) => r.json());
      if (s.configured) {
        const src = s.source === 'env' ? t('settings.audio.source_env') : t('settings.audio.source_config');
        statusEl.innerHTML = `<span class="agent-status-dot ok"></span>${esc(t('settings.audio.configured', { key: s.maskedKey, source: src }))}`;
        if (s.baseUrl) baseInput.value = s.baseUrl;
      } else {
        statusEl.innerHTML = `<span class="agent-status-dot missing"></span>${esc(t('settings.audio.not_configured'))}`;
      }
    } catch {
      statusEl.textContent = t('settings.audio.not_configured');
    }
  };
  await refresh();

  panel.querySelector('#mm-save').onclick = async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) { saveState.textContent = t('settings.audio.need_key'); return; }
    saveState.textContent = t('settings.audio.saving');
    try {
      const r = await fetch('/api/config/minimax', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl: baseInput.value.trim() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      keyInput.value = '';
      saveState.textContent = t('settings.audio.saved');
      await refresh();
    } catch (e) {
      saveState.textContent = t('settings.audio.save_failed', { message: (e?.message ?? e) });
    }
  };

  panel.querySelector('#mm-clear').onclick = async () => {
    await fetch('/api/config/minimax', { method: 'DELETE' });
    keyInput.value = '';
    baseInput.value = '';
    saveState.textContent = '';
    await refresh();
  };
}

function renderSettingsAgent(panel) {
  // Default to local CLI mode; BYOK = anthropic-api which is itself an HTTP agent
  const mode = panel.dataset.mode || 'local';
  const agents = state.agents ?? [];
  const localAgents = agents.filter((a) => a.id !== 'anthropic-api');
  const httpAgents = agents.filter((a) => a.id === 'anthropic-api');
  const list = mode === 'byok' ? httpAgents : localAgents;
  const currentId = state.selected?.agentId
    || (agents.find((a) => a.available)?.id ?? 'anthropic-api');

  panel.innerHTML = `
    <h3>${esc(t('settings.agent.title'))}</h3>
    <div class="panel-sub">${esc(t('settings.agent.subtitle'))}</div>

    <div class="settings-mode-tabs">
      <button data-mode="local" class="${mode === 'local' ? 'active' : ''}">${esc(t('settings.agent.mode.local'))}</button>
      <button data-mode="byok" class="${mode === 'byok' ? 'active' : ''}">${esc(t('settings.agent.mode.byok'))}</button>
    </div>

    ${mode === 'byok' ? `
      <div class="panel-sub" style="margin-bottom:14px">
        ${esc(t('settings.agent.byok.intro'))}
        <ul style="margin:6px 0 0 18px;padding:0;font-family:var(--font-mono);font-size:11.5px">
          <li>${esc(t('settings.agent.byok.env_key'))}</li>
          <li>${esc(t('settings.agent.byok.env_base'))}</li>
        </ul>
      </div>
    ` : ''}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);letter-spacing:.08em;text-transform:uppercase">
        ${esc(t('settings.agent.detected', { count: list.length }))}
      </div>
      <button class="btn-rescan" style="background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:5px 10px;border-radius:var(--radius-sm);cursor:pointer;font-size:11px;font-family:var(--font-mono)">
        ${esc(t('settings.agent.rescan'))}
      </button>
    </div>

    <div class="agent-list">
      ${list.map((a) => {
        const isCurrent = a.id === currentId && a.available;
        const desc = AGENT_DESC[a.id] || (a.bin ?? '');
        const ver = a.version ? esc(a.version) : (a.available ? '' : esc(t('settings.agent.unavailable')));
        const icon = agentIconHtml(a.id);
        return `<div class="agent-card ${isCurrent ? 'selected' : ''}" data-agent-id="${esc(a.id)}">
          <div class="agent-icon">${icon}</div>
          <div class="agent-meta">
            <div class="agent-name">
              <span class="agent-status-dot ${a.available ? 'ok' : 'missing'}"></span>${esc(a.name)}
            </div>
            <div class="agent-desc">${esc(desc)}</div>
            ${ver ? `<div class="agent-version">${ver}</div>` : ''}
          </div>
          <div class="agent-actions">
            ${a.available ? `<button data-act="test">${esc(t('settings.agent.test'))}</button>` : ''}
            ${a.available
              ? (isCurrent
                  ? `<span style="font-size:11px;color:var(--accent);font-family:var(--font-mono)">${esc(t('settings.agent.in_use'))}</span>`
                  : `<button data-act="use" class="primary-action" style="background:var(--accent);border-color:var(--accent);color:var(--accent-fg)">${esc(t('settings.agent.use'))}</button>`)
              : (a.installUrl ? `<a href="${a.installUrl}" target="_blank" rel="noopener" style="font-size:11px;color:var(--text-faint)">install ↗</a>` : '')}
          </div>
          <div class="agent-test-result" data-test-result="${esc(a.id)}" style="display:none;grid-column:1 / -1"></div>
        </div>`;
      }).join('')}
    </div>
  `;

  panel.querySelectorAll('.settings-mode-tabs button').forEach((btn) => {
    btn.onclick = () => {
      panel.dataset.mode = btn.dataset.mode;
      renderSettingsAgent(panel);
    };
  });
  panel.querySelectorAll('.btn-rescan').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const r = await API.rescanAgents();
        state.agents = r.agents ?? state.agents;
        renderSettingsAgent(panel);
        toast(t('settings.agent.rescanned'), 'success');
      } finally {
        btn.disabled = false;
      }
    };
  });
  panel.querySelectorAll('.agent-card [data-act]').forEach((btn) => {
    btn.onclick = async () => {
      const card = btn.closest('.agent-card');
      const aid = card.dataset.agentId;
      const act = btn.dataset.act;
      if (act === 'use') {
        if (!state.selected) {
          toast(t('composer.placeholder.no_project'), 'error');
          return;
        }
        await API.setAgent(state.selected.id, aid);
        state.selected = (await API.getProject(state.selected.id)).project;
        renderSettingsAgent(panel);
        toast(`✓ ${aid}`, 'success');
      } else if (act === 'test') {
        const result = panel.querySelector(`[data-test-result="${aid}"]`);
        result.style.display = 'block';
        result.className = 'agent-test-result';
        result.textContent = t('settings.agent.testing');
        btn.disabled = true;
        try {
          const r = await API.testAgent(aid);
          if (r.ok) {
            result.classList.add('ok');
            result.textContent = t('settings.agent.test_ok', { ms: r.ms, bytes: r.bytes })
              + (r.stdout_head ? ` — ${r.stdout_head.slice(0, 60).replace(/\n/g, ' ')}` : '');
          } else {
            result.classList.add('error');
            result.textContent = t('settings.agent.test_fail', { message: r.error || `exit ${r.exit_code}` });
          }
        } catch (e) {
          result.classList.add('error');
          result.textContent = t('settings.agent.test_fail', { message: e?.message ?? String(e) });
        } finally {
          btn.disabled = false;
        }
      }
    };
  });
}

function renderSettingsLanguage(panel) {
  const cur = getLocale();
  panel.innerHTML = `
    <h3>${esc(t('settings.language.title'))}</h3>
    <div class="panel-sub">${esc(t('settings.language.subtitle'))}</div>
    <div class="lang-options">
      <button data-lang="en" class="${cur === 'en' ? 'active' : ''}">
        <div class="lang-name">${esc(t('settings.language.en'))}</div>
        <div class="lang-sub">${esc(t('settings.language.en_sub'))}</div>
      </button>
      <button data-lang="zh" class="${cur === 'zh' ? 'active' : ''}">
        <div class="lang-name">${esc(t('settings.language.zh'))}</div>
        <div class="lang-sub">${esc(t('settings.language.zh_sub'))}</div>
      </button>
    </div>
  `;
  panel.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.onclick = () => {
      setLocale(btn.dataset.lang);
      // re-render this panel itself with the new locale
      renderSettingsLanguage(panel);
    };
  });
}

function renderSettingsAbout(panel) {
  panel.innerHTML = `
    <h3>${esc(t('settings.about.title'))}</h3>
    <div class="panel-sub">${esc(t('settings.about.subtitle'))}</div>
    <div class="about-block">
      <div class="about-line"><span class="k">${esc(t('settings.about.version'))}</span><span class="v">studio · v0.7</span></div>
      <div class="about-line"><span class="k">${esc(t('settings.about.repo'))}</span><span class="v"><a href="https://github.com/nexu-io/html-video" target="_blank" rel="noopener">github.com/nexu-io/html-video</a></span></div>
      <div class="about-line"><span class="k">${esc(t('settings.about.discord'))}</span><span class="v"><a href="https://discord.com/invite/keeVPMrueT" target="_blank" rel="noopener">discord.com/invite/keeVPMrueT</a></span></div>
      <div class="about-line"><span class="k">${esc(t('settings.about.license'))}</span><span class="v">Apache-2.0</span></div>
      <div class="about-line"><span class="k">${esc(t('settings.about.related'))}</span><span class="v"><a href="https://github.com/nexu-io/open-design" target="_blank" rel="noopener">Open Design</a></span></div>
    </div>
  `;
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

window.addEventListener('error', (e) => {
  console.error('[hv-studio] uncaught:', e.error || e.message);
  try { toast(`错误：${e.error?.message || e.message}`, 'error'); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[hv-studio] unhandled rejection:', e.reason);
  try { toast(`错误：${e.reason?.message || e.reason}`, 'error'); } catch {}
});
init().catch((e) => {
  console.error('[hv-studio] init failed:', e);
  try { toast(`init 失败：${e.message}`, 'error'); } catch {}
});

