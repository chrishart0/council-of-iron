/** The Council MCP game tools a Pi seat gets (room setup is never offered to an already joined seat). */
const matchTools = [
  'map', 'observe', 'news', 'inbox', 'board', 'decision_view', 'preview',
  'march', 'turn_around', 'rally', 'develop',
  'propose_alliance', 'accept_alliance', 'decline_alliance', 'leave_alliance',
  'declare_war', 'offer_peace', 'accept_peace', 'send_message',
  'after_action_report', 'replay_state', 'standings',
];

// A decision-view turn already embeds the current state, so bulk state reads and post-match tools are left out.
const redundantDuringDecisionMatch = new Set(['map', 'observe', 'board', 'after_action_report', 'replay_state', 'standings']);

export function gameToolNames({ taskMode, turnView, vision }) {
  const names = matchTools.filter(name => taskMode !== 'match' || turnView !== 'decision' || !redundantDuringDecisionMatch.has(name));
  return new Set(vision ? [...names, 'view_map'] : names);
}

/** An MCP input schema without its `opId` property: the Pi harness assigns operation IDs itself. */
export function withoutOpId(schema) {
  const { opId: _opId, ...properties } = schema.properties || {};
  return { ...schema, properties, ...(schema.required ? { required: schema.required.filter(name => name !== 'opId') } : {}) };
}
