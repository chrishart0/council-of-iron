/** Resolve an arbitrary Pi player profile from environment-backed local config. */
export function loadPiConfig(alias, env = process.env) {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(alias || ''))
    throw new Error('Model alias must use lowercase letters, digits, and underscores.');
  const key = name => env[`PI_MODEL_${alias.toUpperCase()}_${name}`];
  const provider = key('PROVIDER');
  if (!['openai-completions', 'openai-codex'].includes(provider))
    throw new Error(`Profile ${alias} needs PROVIDER=openai-completions or openai-codex.`);
  const id = key('ID');
  const playerName = key('PLAYER_NAME');
  const contextWindow = Number(key('CONTEXT_WINDOW'));
  const maxTokens = Number(key('MAX_TOKENS') || 4096);
  const thinkingLevel = key('THINKING_LEVEL') || 'off';
  if (!id || !playerName || playerName.length > 40 || !Number.isSafeInteger(contextWindow) || contextWindow < 1000 ||
      !Number.isSafeInteger(maxTokens) || maxTokens < 1 || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(thinkingLevel))
    throw new Error(`Profile ${alias} needs ID, PLAYER_NAME (1–40 chars), valid CONTEXT_WINDOW, MAX_TOKENS, and THINKING_LEVEL.`);
  const baseUrl = key('BASE_URL');
  const transport = key('TRANSPORT') || 'chat_completions';
  if (provider === 'openai-completions' && (!baseUrl || transport !== 'chat_completions'))
    throw new Error(`Profile ${alias} needs BASE_URL and TRANSPORT=chat_completions.`);
  const reasoning = key('REASONING') === 'true';
  const offReasoningEffort = key('OFF_REASONING_EFFORT');
  if (offReasoningEffort && (!reasoning || !/^[a-z][a-z_-]{0,31}$/.test(offReasoningEffort)))
    throw new Error(`Profile ${alias} needs REASONING=true and a simple OFF_REASONING_EFFORT value.`);
  const inputImages = key('INPUT_IMAGES') === 'true';
  const thinkingFormat = key('THINKING_FORMAT');
  if (offReasoningEffort && thinkingFormat)
    throw new Error(`Profile ${alias} cannot combine OFF_REASONING_EFFORT with THINKING_FORMAT.`);
  let chatTemplateKwargs;
  if (key('CHAT_TEMPLATE_KWARGS')) {
    try { chatTemplateKwargs = JSON.parse(key('CHAT_TEMPLATE_KWARGS')); }
    catch { throw new Error(`Profile ${alias} has invalid CHAT_TEMPLATE_KWARGS JSON.`); }
    if (!chatTemplateKwargs || typeof chatTemplateKwargs !== 'object' || Array.isArray(chatTemplateKwargs) || thinkingFormat !== 'chat-template')
      throw new Error(`Profile ${alias} needs THINKING_FORMAT=chat-template with object CHAT_TEMPLATE_KWARGS.`);
  }
  return { alias, provider, id, playerName, name: key('NAME') || playerName,
    leaderName: key('LEADER_NAME') || 'The Visiting Regent', baseUrl, transport,
    apiKey: key('API_KEY') || 'local', contextWindow, maxTokens, thinkingLevel, reasoning, inputImages,
    thinkingFormat, chatTemplateKwargs, offReasoningEffort };
}
