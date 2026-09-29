# Core review notes (branch review-core)

For the client and docs reviewers. No endpoint, MCP tool or CLI command changed shape.

Behaviour fixes in the engine:
- **Truce vs. alliances (unchanged, clarified):** a truce blocks declaring war; joining an alliance that is already at war brings you into its wars immediately, even against a truce partner (user decision). README, AGENT-RULES, SIMPLIFY-PLAN M13 and the AGENTS.md orders contract now say so; `tests/review-core.test.js` pins it.
- **Arrival forecast:** `defenseAtArrival.incoming` (march preview/plan) counts only friendly armies on their last leg into the target, not columns passing through it.
- **Same-tick arrivals:** an arriving army that may not attack the target (no war with its owner) no longer takes first claim; it used to turn back a smaller real attack as `rival_arrival`.
- Error text: an unknown country is now "That country is not in this match." (was "Country has no player.").

Operations: `scripts/restore-room.js` is removed (and its OPERATIONS section); `scripts/deploy.sh` re-checks live rooms just before the fast-forward and deploys exactly the checked commit.
