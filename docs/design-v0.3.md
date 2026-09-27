# Industry & Empire — v0.3 rules

This supersedes the military/economy/map rules in [the original brief](design-v0.1.md). Diplomacy, privacy and fixed matured victory shares remain. The aim is a small diplomacy-first RTS with deliberately asymmetric great powers, not equal national win probabilities.

## Scenario assets, not national multipliers

79 provinces; 186 bidirectional printed connections; 51 starting holdings when all eight countries join. European subdivisions include Ruhr, Brandenburg, Saxony, Normandy, Occitania, Midlands, Belgium, Poland and Baltic provinces. Britain, France and Germany have overseas footholds; Germany starts in Namibia and Tanganyika. Holdings and borders are authored approximations, not exact historical sovereignty or a census of 1910 industrialization.

Starting industry and troops are visible in the lobby, state/API, and checked-in map. They can be lost or captured. There are no hidden country combat/recruitment bonuses. The desired strong group is USA, Britain, Germany, France and Russia, with the Ottomans below them. Japan and Qing are harder starts in current tests; they remain selectable.

## Manpower and development

Manpower exists as troops. Industry is a fixed province property, not another currency. A province produces its industry level (I=1, II=2, III=3 troops) every 20 ticks. Capture resets the recruitment clock but retains completed industry.

Develop I→II by spending 12 local uncommitted troops, leaving one, and waiting 60 ticks. II→III costs 24 and takes 90 ticks. A build is accepted/reserved now, starts next tick, and pays its manpower cost at execution. It fails without spending if the source is no longer yours or its garrison became insufficient. One active/queued build per province; no investment above III. No cancellation/refund mechanic for construction in this release. Capture destroys unfinished work and sunk investment, without damaging a completed level. An empty province retains ownership and can recruit.

This offers reinforcement now versus recruitment later. Ignoring combat and timer phase, the extra production recovers 12 manpower in approximately four minutes after completion, or 24 in approximately eight. Expansion into weak neutral territory may remain the better investment; development is not intended to replace expansion everywhere.

## Movement and commitments

A one-second authoritative tick remains. A legal one-source move specifies exactly one of `amount` (positive integer) or `percent` (>0, ≤100). Percentage is applied to the **currently uncommitted deployable garrison after leaving one**, rounded down; it must select at least one. It is resolved at acceptance and never silently absorbs future recruits.

Each printed connection takes `15 + ceil(haversine_distance_km / 35)` ticks, using its map anchors. Long sea routes are slower; antimeridian distance uses the short direction. This is game pacing, not realistic military speed. Visual animation interpolates between those anchors; server arrival ticks are authoritative. No multi-hop pathfinding, interception battles or fleet resource is added.

A coordinated attack is one target plus 1–16 unique owned adjacent sources, each with its own amount or percentage. Earliest common arrival is next tick plus the longest travel time. Alternatively request an absolute arrival tick no more than 300 ticks later than that earliest arrival and not beyond 30:00. Faster/nearer sources depart later; all valid components arrive together. Validation and reservations are atomic: one invalid source rejects the whole submission without spending commands/troops. Once accepted, each component revalidates ownership and available troops at departure; one later failure does not cancel its companions.

Waiting troops remain part of their home garrison and can defend or die there. They are reserved against additional orders or development, not removed into an invulnerable queue. The accepted plan is private until departures make movement visible. Two allies can use the same absolute arrival tick with their own independently submitted plans; neither may order the other's provinces.

A one-target coordinated attack counts as **one** command. All players share three commands per rolling ten game seconds. Moves, coordinated attacks, development, route changes and recalls share that budget. Automatic recruitment arrows consume no subsequent commands. This deliberately replaces the older per-source batching constraint: humans and agents now have the same first-class coordinated order.

## Recall

Recall accepts a queued order ID, an outbound army ID, or a whole attack group ID. It executes next tick, before departures/arrivals. Waiting components cancel and release their reservations. Departed components reverse at their current interpolated point. They return to their original source in as many ticks as their outbound journey has already used (at least one); no instant refund, teleportation or fresh fixed setup charge.

A group can therefore have some cancelled components and some returning components. Returned armies use normal combat/reinforcement rules. A hostile owner at home means battle, not safe delivery or automatic rerouting. Already-returning or already-arrived armies cannot be recalled. A recall accepted before an arrival tick executes first on that boundary; once arrival is resolved, it is too late. Overlapping recalls cannot duplicate troops; a later ineffective recall explicitly fails. Construction is not an attack and is not recallable.

## Tick order and outcome

Apply due diplomacy changes; execute recalls; execute other due orders; resolve arrivals simultaneously per province; complete construction; recruit and forward new troops; determine eliminations; evaluate victory. A build captured on its completion tick loses unfinished construction before completion. Opposing arrivals cancel one-for-one; existing deterministic multi-side and allied-ownership tie rules still apply.

Hold 60% of active industry for 90 continuous ticks, or lead in industrial output at 30:00. Active industry is the sum of completed industry levels on owned provinces; unowned provinces contribute zero. The required integer output is rounded up and changes with conquest or development. An activated coalition membership change or falling below the threshold resets the hold. Due arrivals at 30:00 count; later ones do not. An owned empty-garrison province contributes its completed industry; a neutral province contributes nothing. Troops in transit keep a country from being eliminated.

Winning roster members divide the fixed pool `100 × starting seats`, then earn each slice in proportion to uninterrupted allegiance maturity (five minutes, capped; shorter matches use their duration). Missing maturity is not redistributed. Leaving/re-forming resets maturity. Eliminated coalition members remain on the sharing roster with frozen maturity. Individual Prestige is payout minus 100. Draws give zero and do not advance the last-20 decisive window. No score points for industrial construction, kills or chat volume.

## Compatibility and tests

Matches freeze these rules, movement times and coordinates into their snapshots. The only playable scenario is `imperial-1910-v3`.

59 automated tests include full modern deterministic replay, mixed waiting/marching group recall, recall at arrival, return-to-captured-home combat, percentage rounding, atomic validation, queued reservations, interrupted construction, partial dispatch failure, restart, private planning and real CLI/MCP subprocesses. See [playtest record](PLAYTEST.md) and [balance evidence](BALANCE.md). Testing functionality does not establish human enjoyment or live-model competence.
