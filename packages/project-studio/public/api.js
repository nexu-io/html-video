// Studio REST client — thin fetch wrappers for /api/*.
export const API = {
  projects: () => fetch('/api/projects').then((r) => r.json()),
  createProject: (b) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }).then((r) => r.json()),
  getProject: (id) => fetch(`/api/projects/${id}`).then((r) => r.json()),
  patchProject: (id, b) =>
    fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    }).then((r) => r.json()),
  deleteProject: (id) => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then((r) => r.json()),
  templates: () => fetch('/api/templates').then((r) => r.json()),
  agents: () => fetch('/api/agents').then((r) => r.json()),
  setTemplate: (id, tid) =>
    fetch(`/api/projects/${id}/template`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: tid }),
    }).then((r) => r.json()),
  setAgent: (id, aid, model) =>
    fetch(`/api/projects/${id}/agent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: aid, ...(model !== undefined && { agent_model: model }) }),
    }).then((r) => r.json()),
  exportMp4: (id) => fetch(`/api/projects/${id}/export`, { method: 'POST' }).then((r) => r.json()),
  getMessages: (id) => fetch(`/api/projects/${id}/messages`).then((r) => r.json()),
  rawHtml: (id) => fetch(`/api/projects/${id}/raw-html`).then((r) => (r.ok ? r.text() : null)),
  putRawHtml: (id, html) =>
    fetch(`/api/projects/${id}/raw-html`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html }),
    }).then((r) => r.json()),
  contentGraph: (id) =>
    fetch(`/api/projects/${id}/content-graph`).then((r) => (r.ok ? r.json() : null)),
  reorderFrames: (id, order) =>
    fetch(`/api/projects/${id}/frames/order`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order }),
    }).then((r) => r.json()),
  setFrameDuration: (id, nodeId, durationSec) =>
    fetch(`/api/projects/${id}/frames/${encodeURIComponent(nodeId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durationSec }),
    }).then((r) => r.json()),
  unenhanceFrame: (id, nodeId) =>
    fetch(`/api/projects/${id}/frames/${encodeURIComponent(nodeId)}/unenhance`, {
      method: 'POST',
    }).then((r) => r.json()),
  nativeTemplates: () => fetch('/api/native-templates').then((r) => r.json()),
  testAgent: (id) =>
    fetch(`/api/agents/${encodeURIComponent(id)}/test`, { method: 'POST' }).then((r) => r.json()),
  rescanAgents: () => fetch('/api/agents?force=1').then((r) => r.json()),
};
