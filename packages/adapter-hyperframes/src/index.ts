import type { EngineAdapter } from '@html-video/core';
import { capabilities } from './capabilities.js';
import { render, renderToHtml } from './render.js';
import { validate } from './validate.js';

const adapter: EngineAdapter = {
  id: 'hyperframes',
  name: 'Hyperframes',
  upstreamVersion: '0.4.x',
  capabilities,
  validate,
  render,
  renderToHtml,
};

export default adapter;
export { adapter };
export { detectChromiumPath } from './detect.js';
