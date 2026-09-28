const matchTools = [
  'map', 'observe', 'situation', 'news', 'board', 'decision_view', 'match_leaderboard',
  'strategic_options', 'alliance_victory_share', 'preview', 'plan_attack',
  'move', 'transit', 'route', 'recall', 'develop', 'coordinated_attack',
  'propose_alliance', 'accept_alliance', 'decline_alliance', 'leave_alliance',
  'declare_war', 'offer_peace', 'vote_war', 'vote_peace', 'send_message',
  'after_action_report', 'replay_state', 'standings',
];

const redundantDuringDecisionMatch = new Set([
  'map', 'observe', 'situation', 'board',
  'after_action_report', 'replay_state', 'standings',
]);

/** Keep separate game commands while giving decision-view turns one current state read. */
export function gameToolNames({ taskMode, turnView, vision }) {
  const names = matchTools.filter(name => taskMode !== 'match' || turnView !== 'decision' ||
    !redundantDuringDecisionMatch.has(name));
  return new Set(vision ? [...names, 'view_map'] : names);
}
