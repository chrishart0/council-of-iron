# Core review notes (branch review-core)

For the client and docs reviewers. No endpoint, MCP tool or CLI command changed shape.

Behaviour fixes in the engine:
- **Truce vs. alliances:** a country in truce with X that joins an alliance at war with X is no longer put at war with X until the truce ends (then the alliance's war reaches it, as before). `wars` can therefore briefly list a side at war with X except one member; clients already read wars pair by pair (`public/relations.js`), so nothing changes there.
- **Arrival forecast:** `defenseAtArrival.incoming` (march preview/plan) counts only friendly armies on their last leg into the target, not columns passing through it.
- **Same-tick arrivals:** an arriving army that may not attack the target (no war with its owner) no longer takes first claim; it used to turn back a smaller real attack as `rival_arrival`.
- Error text: an unknown country is now "That country is not in this match." (was "Country has no player.").

Operations: `scripts/restore-room.js` is removed (and its OPERATIONS section); `scripts/deploy.sh` re-checks live rooms just before the fast-forward and deploys exactly the checked commit.
