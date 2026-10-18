export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

/** Parse complete SSE records, including tool arguments split across network chunks. */
export async function readMessage(response: Response, onText: (text: string) => void) {
  if (!response.ok || !response.body) {
    throw new Error(
      `Messages API: HTTP ${response.status} ${(await response.text()).slice(0, 400)}`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const blocks: MessageBlock[] = [];
  const partialInputs = new Map<number, string>();
  let buffer = '';
  let stopped = false;
  let reason = '';
  const consume = (record: string) => {
    const data = record
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'error')
      throw new Error(event.error?.message ?? 'Messages API stream error');
    if (event.type === 'content_block_start') {
      const block = event.content_block;
      if (block?.type === 'text') {
        blocks[event.index] = { type: 'text', text: block.text ?? '' };
        if (block.text) onText(block.text);
      } else if (block?.type === 'tool_use') {
        blocks[event.index] = {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        };
      } else {
        throw new Error(`Unsupported Messages API content block: ${block?.type}`);
      }
    } else if (event.type === 'content_block_delta') {
      const block = blocks[event.index];
      if (event.delta?.type === 'text_delta' && block?.type === 'text') {
        block.text += event.delta.text;
        onText(event.delta.text);
      } else if (event.delta?.type === 'input_json_delta' && block?.type === 'tool_use') {
        partialInputs.set(
          event.index,
          (partialInputs.get(event.index) ?? '') + event.delta.partial_json,
        );
      }
    } else if (event.type === 'content_block_stop') {
      const block = blocks[event.index];
      const partial = partialInputs.get(event.index);
      if (block?.type === 'tool_use' && partial) {
        const input: unknown = JSON.parse(partial);
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('Invalid tool arguments');
        block.input = input as Record<string, unknown>;
      }
    } else if (event.type === 'message_delta') {
      reason = event.delta?.stop_reason ?? '';
    } else if (event.type === 'message_stop') stopped = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!stopped) throw new Error('Messages API stream ended before message_stop');
    return { content: blocks, reason };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
