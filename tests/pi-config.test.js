import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPiConfig } from '../agents/pi/config.js';

test('Pi resolves arbitrary local model profile entirely from config', () => {
  const env = {
    PI_MODEL_SAMPLE_PROVIDER: 'openai-completions',
    PI_MODEL_SAMPLE_BASE_URL: 'http://127.0.0.1:8000/v1',
    PI_MODEL_SAMPLE_ID: 'vendor/model',
    PI_MODEL_SAMPLE_PLAYER_NAME: 'Sample Pi',
    PI_MODEL_SAMPLE_CONTEXT_WINDOW: '1048576',
    PI_MODEL_SAMPLE_TRANSPORT: 'chat_completions',
    PI_MODEL_SAMPLE_THINKING_LEVEL: 'off',
  };
  assert.deepEqual(loadPiConfig('sample', env), {
    alias: 'sample', provider: 'openai-completions', id: 'vendor/model', playerName: 'Sample Pi',
    name: 'Sample Pi', leaderName: 'The Visiting Regent', baseUrl: 'http://127.0.0.1:8000/v1',
    transport: 'chat_completions', apiKey: 'local', contextWindow: 1048576, maxTokens: 4096,
    thinkingLevel: 'off', reasoning: false, inputImages: false, thinkingFormat: undefined, chatTemplateKwargs: undefined,
    offReasoningEffort: undefined,
  });
});

test('Pi rejects unsafe aliases and incomplete model profiles', () => {
  assert.throws(() => loadPiConfig('../data', {}), /alias/);
  assert.throws(() => loadPiConfig('sample', {}), /PROVIDER/);
  assert.throws(() => loadPiConfig('sample', { PI_MODEL_SAMPLE_PROVIDER: 'openai-completions' }), /ID/);
});

test('Pi preserves configured chat-template options without naming a provider', () => {
  const env = {
    PI_MODEL_SAMPLE_PROVIDER: 'openai-completions', PI_MODEL_SAMPLE_BASE_URL: 'http://127.0.0.1:8000/v1',
    PI_MODEL_SAMPLE_ID: 'vendor/model', PI_MODEL_SAMPLE_PLAYER_NAME: 'Sample Pi',
    PI_MODEL_SAMPLE_CONTEXT_WINDOW: '1048576', PI_MODEL_SAMPLE_REASONING: 'true',
    PI_MODEL_SAMPLE_THINKING_FORMAT: 'chat-template',
    PI_MODEL_SAMPLE_CHAT_TEMPLATE_KWARGS: '{"thinking":false,"reasoning_effort":"low"}',
  };
  assert.deepEqual(loadPiConfig('sample', env).chatTemplateKwargs, { thinking: false, reasoning_effort: 'low' });
  env.PI_MODEL_SAMPLE_INPUT_IMAGES = 'true';
  assert.equal(loadPiConfig('sample', env).inputImages, true);
  env.PI_MODEL_SAMPLE_CHAT_TEMPLATE_KWARGS = '{bad';
  assert.throws(() => loadPiConfig('sample', env), /invalid CHAT_TEMPLATE_KWARGS/);
});

test('Pi accepts an explicit off reasoning effort for compatible local servers', () => {
  const env = {
    PI_MODEL_SAMPLE_PROVIDER: 'openai-completions', PI_MODEL_SAMPLE_BASE_URL: 'http://127.0.0.1:8000/v1',
    PI_MODEL_SAMPLE_ID: 'vendor/model', PI_MODEL_SAMPLE_PLAYER_NAME: 'Sample Pi',
    PI_MODEL_SAMPLE_CONTEXT_WINDOW: '1048576', PI_MODEL_SAMPLE_REASONING: 'true',
    PI_MODEL_SAMPLE_THINKING_LEVEL: 'off', PI_MODEL_SAMPLE_OFF_REASONING_EFFORT: 'none',
  };
  assert.equal(loadPiConfig('sample', env).offReasoningEffort, 'none');
  env.PI_MODEL_SAMPLE_THINKING_FORMAT = 'chat-template';
  assert.throws(() => loadPiConfig('sample', env), /cannot combine/);
  delete env.PI_MODEL_SAMPLE_THINKING_FORMAT;
  env.PI_MODEL_SAMPLE_REASONING = 'false';
  assert.throws(() => loadPiConfig('sample', env), /REASONING=true/);
});
