import { createInterface } from 'node:readline';

const mode = process.argv[2] || 'modern';
let selectedModel = 'automatic';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'initialize') {
    const capabilities = mode === 'legacy'
      ? { sessionCapabilities: { modelSelection: { method: 'session/set_model' } } }
      : {};
    send({ jsonrpc: '2.0', id: request.id, result: { agentCapabilities: capabilities } });
    return;
  }
  if (request.method === 'session/new') {
    const configOptions = mode === 'modern'
      ? [{
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'model-a',
          options: [
            { value: 'model-a', name: 'Model A', description: 'Default fixture' },
            { value: 'model-b', name: 'Model B' },
          ],
        }]
      : [];
    send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'fixture-session', configOptions } });
    return;
  }
  if (request.method === 'session/set_config_option') {
    selectedModel = request.params?.value || 'missing';
    send({ jsonrpc: '2.0', id: request.id, result: { configOptions: [] } });
    return;
  }
  if (request.method === 'session/set_model') {
    selectedModel = request.params?.modelId || 'missing';
    send({ jsonrpc: '2.0', id: request.id, result: {} });
    return;
  }
  if (request.method === 'session/prompt') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'fixture-session',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `selected:${selectedModel}` } },
      },
    });
    send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } });
  }
});
