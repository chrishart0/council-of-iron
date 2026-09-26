# ENTENTE
## A real-time diplomacy game for humans and agents
### Design brief and playable prototype rules — v0.1

**Status:** Proposed rules, not a claim of demonstrated balance. Numerical settings are initial playtest values. No game implementation or gameplay test is implied by this document.

**The promise:** Win territory by moving armies. Win the match by choosing, persuading, and coordinating the right allies. Win more individual prestige by sharing victory with fewer partners—but accepting fewer partners may cost you victory altogether.

**The central design question:** Can a player improve their position through a good conversation, without needing to learn a complicated military simulation?

---

## 1. What we are making

ENTENTE is a short, continuously running, map-painting strategy game set on a stylized 1910 world map. Humans and independently operated agents occupy the same player seats. Humans use a browser; agents use a structured API, CLI, or MCP wrapper. All clients control the same game through the same rules.

This is a diplomacy game with an intentionally small military system, not an attempt to reproduce a conventional RTS with an API bolted on. Its desired stories are about promises, threats, coordinated attacks, mistaken trust, coalition changes, and surprising model behavior.

The intended experience is: “That agent could calculate the front better than I could, but I persuaded its ally to open a second front.” Another equally valid story is: “I tried to trick it, but it understood my incentives and refused.” Humans are not promised an advantage in manipulation.

A successful first version should produce those stories from three things: troop movement, coalition membership, and conversation. If it only becomes interesting after adding technologies, buildings, or national bonuses, the central design has not yet succeeded.

### Design principles and evidence

The MDA framework distinguishes rules, the behavior those rules produce, and the player experience. Its practical implication here is to choose the experience first and test whether a small ruleset generates it, rather than starting with a feature inventory. [1]

Research applying self-determination theory to games associates enjoyment with experienced autonomy and competence, and, in multiplayer settings, relatedness. Here those suggest meaningful diplomatic choices, understandable combat and feedback, and relationships that matter mechanically. They do not establish an optimal match length, cooldown, or scoring formula. [2]

Diplomacy supplies a useful precedent for negotiation, nonbinding promises, and military cooperation. Its official rules also distinguish that social freedom from the actual orders that determine outcomes. ENTENTE borrows that separation, not Diplomacy's full adjudication system, fleets, or turn structure. [3]

CICERO is a relevant precedent for combining natural-language negotiation with strategic play against humans. It is evidence that negotiation belongs inside an agent game, not evidence that a generic attached model will play this new game well. [4]

---

## 2. Prototype at a glance

| Setting | Initial rule |
|---|---|
| Seats | 8, in any human/agent mixture |
| Map | One fixed, connected graph of 64 land provinces |
| Setting | 1910-inspired countries and geography |
| Starting position | 3 provinces and 30 troops per country; 10 troops in each province |
| Uncontrolled provinces | 2 defending troops each; no recruitment |
| Resource and unit | Manpower; one manpower equals one troop |
| Recruitment | Each owned province produces 1 troop every 20 seconds |
| Movement | 45 seconds across any printed connection |
| Military input limit | At most 3 accepted manual military commands in any rolling 10 seconds |
| Alliance changes | Take effect 30 seconds after a valid change is confirmed |
| Early victory | Hold at least 39 of 64 provinces for 90 continuous seconds |
| Maximum duration | 30 minutes |
| Deadline result | Side with most provinces wins; a tie for first is a draw |
| Chat | World, alliance, and direct messages |
| Initial chat limit | 500 characters; at most 1 message every 10 seconds per seat, across all channels |
| Full coalition payout | Earned after 5 uninterrupted minutes in the current allegiance; short matches use their actual duration |

A “side” is either a formal coalition or an independent country. A “seat” is one country, regardless of how many processes help control it. No new playing seats enter after the match begins. The competitive objective, including in the default agent instructions, is to maximize expected individual match prestige—not merely to obtain a coalition-win flag.

The military rate limit is not a spendable resource. It is a shared interface constraint to limit mechanical speed advantages. Standing recruitment routes do not require repeated manual commands.

---

## 3. The map and the historical setting

Use a recognizable world map, historical-style country names and presentation, and a small curated set of starting powers. Do not attempt every 1910 country in the first prototype.

**The balanced prototype does not reproduce the exact 1910 distribution of imperial possessions.** Each power starts with three game provinces in an appropriate home area. Remaining game provinces are uncontrolled, even where a historical empire would have governed them. This must be visible in the scenario description; uncontrolled is a gameplay status, not a historical claim.

One province always has the same recruitment and victory value as another, regardless of how many square kilometers its polygon covers. Exact historical ownership, identical province values, free country selection, and equal competitive prospects cannot simply be assumed to coexist. Handicaps are not the first solution; first test a deliberately authored scenario with equal starting budgets.

Equal budgets do not prove equal positions. Review each start for accessible neutral territory, number of exposed borders, nearby opponents, reinforcement distances, and isolation. Rotate operators through countries during tests. If a start is too safe or too crowded, change the graph or starting allocation before introducing economic exceptions.

Land borders and a small set of clearly drawn sea connections define adjacency. Sea connections work exactly like land connections: the same troops, the same travel time, no ships or transport resource. Avoid an isolated continent that becomes a safe compounding economy while other players must fight immediately.

The first map is fixed. Map generation, an accurate global colonial simulation, and multiple scenarios are outside v0.1.

---

## 4. Manpower, movement, and combat

### One resource, with no treasury

Manpower exists on the board as troops. There is no separate bank, purchase screen, build queue, or upkeep. A province recruits locally. Capturing land provides another local recruitment source and another province toward victory.

Recruitment uses a per-province 20-second timer. Capture restarts that timer, so a captured province must be held for 20 seconds before its first new troop appears. Ownership survives an empty garrison. Uncontrolled provinces do not recruit.

There is no troop cap in this prototype. Match length bounds accumulation. If hoarding or runaway growth becomes a problem, test the existing recruitment rate and map before adding another economy.

### The military command

The primary command is **send a chosen number of troops from an owned province to an adjacent province**. Leave at least one troop behind. Movement takes 45 seconds; an army cannot be recalled or redirected after departure.

If the destination belongs to you at arrival, the troops reinforce it. If it belongs to an ally, the troops reinforce that province and become the ally's troops. This is an explicit gift, not a shared-control army. If the destination belongs to a non-ally or is uncontrolled, the troops fight its defenders.

The relation at arrival determines the result. An alliance change or a capture can turn an intended reinforcement into a battle. The interface must show that committed armies are still in transit and cannot be recalled.

Troop gifting makes military cooperation possible without foreign garrisons, military-access treaties, multiple owners inside a province, or expulsion rules. It also creates a meaningful trust decision: the recipient will control the troops you send.

### Remove repetitive reinforcement work

A player may set one standing recruitment arrow from a province to an adjacent province that they or an ally owns. Future recruited troops travel automatically along that connection. Existing garrison troops do not automatically leave.

A recruitment arrow keeps the source's last troop at home. It clears when its source changes owner or its destination ceases to be friendly. Already moving troops continue under normal arrival rules. Setting or clearing an arrow consumes one manual military command; automatic departures do not.

The browser and agent interface both expose these arrows. A batch of three manual orders consumes three orders, not one API call's worth of allowance. A multi-agent controller receives no extra allowance.

### Visible, deterministic combat

For two opposing sides, subtract the smaller force from the larger. The larger side keeps the difference. An attack of 40 against 30 leaves 10 attackers in the captured province. An attack of 20 against 30 leaves 10 defenders. Equal forces destroy each other; the previous owner keeps the empty province.

All arrivals at the same province on the same simulation tick resolve together, with allied contingents combined. For three or more sides, the largest side survives only if it exceeds the combined strength of all other sides; its survivors are the difference. Otherwise all troops in that battle are destroyed and the previous owner retains the empty province. This is an explicit simplification, not a simulation of real combat.

If the defending side wins, its existing province owner keeps the province and all surviving troops. If another coalition wins, the country contributing the largest arriving contingent takes the province and the survivors; exact allied ties use a publicly displayed rotating country-priority order. This tie rule changes ownership within the winning coalition, not its total surviving strength.

Combat occurs at provinces. Oppositely moving armies can pass on a connection; there are no road-interception battles in v0.1. The map must make their destinations and arrival times legible.

There are no dice, defense multipliers, terrain bonuses, unit classes, critical hits, or tactical abilities. The uncertain part is what other players decide to do—not an invisible combat roll.

---

## 5. Information and real time

The entire military board is public: province owners, troop counts, moving armies, destinations, arrival times, active coalitions, confirmed pending alliance changes, and victory timers. Private conversations and unissued intentions are not public. Recruitment arrows can also be public; neither interface receives secret military state.

The game runs continuously. It does not wait for all players to submit a turn. A model that spends 40 seconds reasoning may produce a better plan but miss an opportunity. A fast model can react earlier, but cannot turn unlimited tool calls into unlimited military commands.

The initial 45-second travel time is a pacing hypothesis. It should allow a meaningful warning and response while leaving time for negotiation. Measure real end-to-end agent latency and human response burden before shortening it.

An attack preview shows the result against the currently visible situation, with known incoming forces and arrivals. It must not promise that the outcome cannot change before impact. A small event history explains every change in territory and troops.

The game should remain readable from across a room: national colors for ownership, a separate coalition outline or overlay, large troop numbers, and a prominent victory countdown. Do not recolor the whole map to hide individual countries when they ally.

---

## 6. Alliances and diplomacy

### Formal coalition rules

A country may belong to one formal coalition at a time. There is no preset Axis/Allies division, national alignment restriction, coalition-size cap, or permanent friendship rule.

Two independent countries can form a coalition by mutual agreement. Adding a country requires the candidate's consent and unanimous consent from the coalition's non-eliminated members. Consent is tied to the exact proposed roster; a material roster change invalidates a pending proposal. Once confirmed, the membership change is public and activates after 30 seconds.

A player can leave unilaterally with the same public 30-second notice. It must finish leaving before joining another coalition. No member can kick another member. There is no separate merge operation that carries old membership credit into a newly formed group.

A coalition provides combined victory eligibility, combined strength in a simultaneous battle, reinforcement gifts without combat, and alliance chat. It does not transfer land or allow another player to issue your orders.

Joining does not reset existing members' payout clocks. It starts the newcomer's clock. Creating a new coalition starts every founder's clock at zero. Renaming a coalition changes nothing. Leaving resets the departing player's eligibility clock for its new independent allegiance. If departures reduce a coalition to one roster member, it dissolves and the remaining player begins a new independent allegiance with a fresh clock. Eliminated retained members still count as roster members.

### Promises and deception

A promise in chat is not a game command and is not automatically enforced. Non-aggression promises, plans to attack together, threats, misleading advice, and arguments about another player's incentives are allowed. Formal membership and active orders are whatever the server says they are.

There is no enforceable treaty language, reputation currency, good/evil meter, or hidden alignment mechanic. Personas belong to the agent configuration. Actual choices and chat history provide the interesting behavior.

Trust must sometimes be worthwhile. The game should not teach that betrayal is always optimal or that trusting anyone is always a mistake. A stable coalition earns full individual shares, while changing sides creates a temporary payout cost and a visible military risk.

### Chat and agent attention

Every accepted message is delivered to its intended inbox and is available through a resumable event stream. The default agent adapter includes new diplomatic messages when it next observes the game. It does not require screenshots or browser scraping.

Delivery does not mean compulsory replies, compulsory acknowledgment before acting, an immediate paid model invocation per message, or proof that the agent obeyed the message. An agent is allowed to decide that a message is irrelevant or dishonest. No implementation can honestly promise that an arbitrary external agent semantically considers everything it receives.

The initial rate limit is one message per 10 seconds per seat, 500 characters maximum, shared across world, alliance, and direct channels. It bounds forced reading and token exposure; it is not intended to ban conversational play. Coalesce notifications, preserve the log, keep critical game events separately visible, and never make an unread message block a military order.

The experiment permits attempts to influence game decisions, including adversarial persuasion. The agent running in this environment should have only match-scoped game access, not the operator's personal email, production credentials, or unrelated filesystem tools. Player text remains labeled, untrusted player text; it cannot become a server instruction or forge an authenticated command. Ordinary harassment and abuse controls remain available for humans.

---

## 7. Ending a match

A side wins early by controlling at least 39 of the 64 provinces for 90 continuous seconds. Falling below 39 resets the countdown. An activated roster change also resets that side's countdown, even if it still has enough land. A warning shows which side is about to win and the time remaining.

At 30 minutes, if there has been no earlier victory, the side controlling the most provinces wins. An exact tie for first is a draw. No kill-count or stockpiled-army tiebreaker is added.

The roster-stability condition applies to the early-win countdown. Deadline scoring uses membership changes that actually activated before the final state was evaluated. Thus a negotiated late realignment can change who wins at the deadline, but it cannot provide a fully matured individual payout to its newcomers. This is deliberate: discourage an unearned last-minute windfall, not every late diplomatic deal.

If one coalition contains all eight original seats, the match ends as a negotiated draw, not a ranked victory. This is different from a coalition defeating every opponent: eliminated opponents outside its roster still count as opponents it defeated.

A player is eliminated only after losing all provinces and having no troops in transit that could still arrive. Eliminated members remain on their coalition's prize-sharing roster. Their earned maturity freezes at elimination; they cannot be removed merely to enlarge the survivors' shares. They have no military commands or admission vote. Other players cannot respawn or join a vacated seat mid-match.

Disconnecting is not surrender. Existing troops defend, recruitment and standing arrows continue, and the same seat can reconnect. No account gets a free early departure from a losing match's result. Aborted infrastructure-failure matches are void, not competitive draws.

---

## 8. Individual scoring: fixed shares, earned over time

### The objective

Reward winning with useful partners, make large coalitions cost something, reduce late bandwagon rewards, and avoid pretending that kills measure diplomatic contribution.

Do not divide the prize only in proportion to relative membership time. If two players form a fresh coalition ten seconds before the end, each has half its membership-time total; that formula would still give each half the entire prize. Absolute maturity avoids that reset loophole.

### Match payout

For an eight-seat match, the maximum prize pool is **800 points**. More generally it is 100 points per starting seat. This is a scoring benchmark, not a currency, stake, or entry fee.

Each winning-roster member has an equal maximum slice. It earns that slice linearly over five uninterrupted minutes in its current allegiance. For a match ending in less than five minutes, use the actual match duration as the maturity window instead: spending the entire match in the winning allegiance always earns the full slice. This avoids penalizing an unchanged allegiance merely for winning quickly. Any unearned portion is not redistributed—to veterans, to losers, or to anyone else.

Let:

- `N` = starting seats; 8 in the initial scenario.
- `k` = winning roster size, including retained eliminated members.
- `t_i` = seconds continuously spent in the winning allegiance; frozen at elimination.
- `m = min(300, match_duration_seconds)` = maturity window.
- `v_i = min(1, t_i / m)` = earned fraction.

Then:

```text
winner_payout_i = (100 * N / k) * v_i
loser_payout_i  = 0
match_prestige_i = payout_i - 100
```

An independent country that never changed allegiance starts its clock at match start. Going independent after leaving a coalition starts a fresh clock; it does not restore an old solo clock. Draws give zero match prestige to everyone, rather than applying the decisive-match formula.

### Worked example

Eight players finish with a winning coalition of four. Three members have been in it for at least five minutes. The fourth member joined one minute before the end.

| Player | Earned fraction | Payout | Match prestige |
|---|---:|---:|---:|
| Established ally A | 100% | 200 | +100 |
| Established ally B | 100% | 200 | +100 |
| Established ally C | 100% | 200 | +100 |
| Late ally D | 20% | 40 | -60 |
| Each of four losing players | — | 0 | -100 |

The late member does better than losing, but does not receive a positive prestige windfall. The established members also pay a real admission cost: a fourth member reduces their maximum slices from 800/3 to 800/4. They must decide whether that partner improves their chance of victory enough to justify it.

A full-maturity solo win pays 800 (+700 prestige). A full-maturity two-country victory pays 400 each (+300). Four mature partners earn 200 each (+100). These numbers express a risk/reward choice; they do not prove that small coalitions will be viable on the map.

Five-minute maturity, rather than full-match tenure, is intentional. A sincere alliance formed halfway through a long game can still earn full shares. Early cooperation is valuable, but the opening minute must not permanently determine everyone's diplomatic options.

### Reforming, free-riding, and deliberate delay

Two full-maturity members of a three-country coalition would each receive about 266.67 points by winning with that roster. If they exclude their partner by leaving and forming a new two-country coalition, then win after only one minute of new membership, each receives only 80 points. They can eventually earn larger shares, but not through an instant payout reset.

There is still a free-riding risk: a passive member can mature alongside active allies. After a recent membership change, there is also an incentive to delay an otherwise available victory until shares mature, where opponents and the clock permit it. The short-match adjustment removes this incentive for a country that never changed allegiance, but does not remove it for newcomers. These are explicit playtest targets, not problems declared solved by the formula.

Do not add points for messages sent, troops killed, troops gifted, or an LLM's opinion of contribution. Such metrics would change what players optimize and would miss much of the diplomatic work. Start with admission consent, a fixed pool, and transparent shares.

### Persistent standings, not mislabeled Elo

Retain every match result and show a **Prestige standing**: the average match prestige from the last 20 eligible decisive matches, accompanied by the sample size. Mark fewer than 10 eligible matches provisional. Draws and void matches do not advance this decisive-match window.

This prevents a raw total from rewarding match volume alone. It does not adjust for opponent strength or prove skill. It is not Elo, and it must not be sold as an independently validated model leaderboard.

Partially matured victories leave some points unawarded, so a decisive match can be negative-sum in prestige. That is a deliberate scoring penalty, not a conserved rating transfer. Keep these payouts separate from any later skill-estimation model. Existing skill-rating research illustrates that estimating ability from results is a distinct task from defining the prize itself. [5]

Log this score from the first prototype. Do not launch public competitive matchmaking or claim country/model rankings before the game and scenario have been tested.

---

## 9. Humans, agents, and competitive integrity

The game exposes four conceptual capabilities: observe state and events; issue military orders; propose, accept, or leave a coalition; and send messages. CLI and MCP are wrappers over the same underlying controls as the browser.

Both interfaces need the same map information, timestamps, attack preview, recruitment arrows, readable coalition history, and projected individual payout. Equal endpoint names alone are not equal usability. The browser must not require a hundred clicks for an operation the API performs in a single privileged call; a batch must still obey the same per-order limits.

One seat receives one total military and chat budget even when controlled by several collaborating agents. Several independently controlled countries can form a swarm through the coalition system. One operator secretly occupying several ranked seats is a different thing: it can transfer results to a preferred account.

Private experimental rooms may deliberately include several agents owned by the same person. Their results are recorded but do not contribute to the competitive Prestige standing. For eligible league rooms, the rule is one independently controlled seat per operator, with no deliberately sacrificial accounts or arranged cross-match win trading. This is a participation rule; the prototype cannot claim automatic detection of common ownership.

For model comparisons, record the model/version label, system persona or configuration identifier, available tools, operator interventions, and observed decision latency. Rotate countries and opponents. Attribute results to the full agent configuration rather than claiming that a few wins isolate the language model's inherent ability.

More compute may produce better decisions. This design limits input speed and extra-seat advantages; it does not make compute budgets identical. Controlled benchmarking is a separate evaluation protocol, not another game mechanic.

---

## 10. The minimum interface

The main screen needs the map, a compact side scoreboard, chat, and contextual province controls. Selecting a province reveals its owner, garrison, recruitment countdown, adjacent destinations, and incoming/outgoing armies. Sending troops previews the visible consequences and the remaining garrison.

The coalition panel shows members, pending changes, each member's earned percentage, current maximum slice, and projected prestige if the coalition wins now. Before accepting a member or leaving, show the projected effect on the acting player's payout. Do not hide the central strategic tradeoff in a formula tooltip.

A public spectator view can show the map, public messages, coalitions, and victory countdown on a projector. It must not expose private conversations live. Private-message replays require the room's consent policy; they are not silently public by default.

The tutorial can be one short guided sequence: move troops to an uncontrolled neighbor; inspect a battle preview; set a recruitment arrow; make an alliance offer; read the changed payout. No civilization encyclopedia is required.

---

## 11. What is deliberately absent

No buildings, technologies, multiple resources, fleets, unit classes, terrain modifiers, supply networks, capitals with special defeat rules, espionage, fog of war, alignment stats, enforceable contracts, vassals, auction systems, or contribution-AI judges.

No paid progression, permanent military upgrades, or stronger starting countries earned from past wins. Persistent prestige changes standing, not battlefield strength.

No custom tournament rating research project before the first entertaining match. No procedural map pipeline before testing the fixed graph. No artwork sprint that delays testing whether diplomacy actually matters.

---

## 12. The first playtest and the decisions it must settle

First play a facilitator-run match on a small graph with counters, a timer, and chat. Include at least two independently controlled agents as well as humans. The facilitator supplies the same structured visible state to both. This can test negotiation and scoring before a browser game exists. It cannot establish production latency or API fairness; those need a later integrated test.

Then build only the playable core: fixed map, authoritative troop movement and combat, alliances and score projection, chat, and paired browser/API access. The first graphical version is a measurement tool, not a content-rich release.

### Questions to observe

| Hypothesis | Evidence to collect | First adjustment if it fails |
|---|---|---|
| Diplomacy changes outcomes | Concrete cases where a promise, refusal, gift, or defection changed orders or the eventual winner | Fix reasons to cooperate and coalition incentives before adding military systems |
| Humans have time to think | Missed defensive opportunities, command burden, and whether players can keep a conversation going | Increase travel time or improve standing-order controls |
| Coalition choice is not solved | Team-size distribution, when teams form, and whether near-table coalitions dominate | Revisit prize incentives and scenario; test a size limit only if the failure is persistent |
| Early commitment matters without freezing teams | Payouts and success of midgame vs. final-minute joiners | Adjust the five-minute maturity period |
| The endgame remains active | Frequency and duration of deliberate stalling; time from likely winner to actual end | Adjust victory pacing and maturity together |
| Starting powers are competitive | Repeated seat-rotated outcomes, neutral access, and early elimination rates | Change province connections and starting allocations |
| The rules are legible | Whether players can explain a battle, an admission cost, and their final score | Improve feedback or remove a rule before adding tutorial text |

Also run adversarial scenarios: a last-minute newcomer; an entire team reforming under a new name; players dropping an old partner; an eliminated ally; all seats proposing one coalition; a passive allied account; maximum allowed chat; a disconnect during an attack; three simultaneous hostile arrivals; and an alliance change on the final tick.

A handful of games can reveal obvious failures. It cannot establish balance. Scripted and agent self-play can stress incentives, but human playtests are still required to assess enjoyment and legibility.

The most useful post-match question is: **“Which decision would you change, and what would you try next time?”** The desired answers concern whom to trust, where to commit troops, and when to change sides—not merely who clicked faster or understood a hidden rule.

---

## Appendix A. Minimal adjudication contract

This appendix resolves implementation ambiguities without adding player-facing systems.

**Clock.** Use a one-second authoritative simulation tick. Commands received since the preceding tick become eligible on the next tick. Clients see the server timestamp and the tick at which a command was accepted. No client timestamp can backdate an action.

**Within a tick.** First apply due, still-valid alliance changes; then execute previously accepted military commands from the start-of-tick military state; then resolve all due arrivals, simultaneously across provinces. Resolve recruitment after combat, so a capture resets the recruitment timer rather than awarding an immediate recruit. Process eligible automatic recruitment departures, determine elimination, and finally evaluate victory or the deadline. Invalid commands do not spend troops; they return an explicit reason.

**At the deadline.** The 30:00 tick's due state changes and arrivals resolve before the final territory count. Anything scheduled after that tick does not resolve. A pending departure that has not activated leaves the player in its old coalition for the result. Outcome computation occurs once.

**Coalition changes.** Each country can have only one confirmed pending membership change. A proposal does not itself confer benefits. Proposal acceptance must refer to its exact membership version. A creator cannot use an old independent-side identity to give new coalition founders mature credit.

**Friendly and hostile arrivals.** Determine each arriving country's current side at arrival. Group strengths by side, including the current garrison. Arrival at an allied province is a transfer of control if that side holds the province after resolution. An arriving army does not refund or reroute when ownership changes.

**Zero strength.** If every side has zero survivors, keep the pre-battle province owner. If the province was uncontrolled, it stays uncontrolled. An empty owned province still has its recruitment timer; an empty uncontrolled province does not.

**Tie priority.** For exact allied capture-ownership ties, rotate the public list of country IDs by simulation tick modulo starting seat count. Choose the first tied country in that list. No random combat result or hidden timing advantage is introduced; all interfaces can inspect the priority.

**Recruitment routes.** A route forwards the newly created troop, not the entire stack. If the source has no garrison, its next recruited troop stays. Each route is one-hop; a received gift does not automatically forward again. Ownership changes clear source routes; loss of friendly destination clears the route. A lost or disconnected client does not clear otherwise valid routes.

**Score bookkeeping.** Store actual membership activation timestamps, departures, eliminations, retained rosters, and outcome timestamps. Compute maturity from that log, not from a client claim. Retain enough precision for scoring; round for display only. Do not renormalize partially paid winnings back to the full pool.

**Replays and reconciliation.** Given the same initial state and accepted event log, game and score results should reproduce. Both interfaces must be able to reconnect from a state snapshot and an event cursor without replaying already accepted orders. Operation identifiers prevent retries from issuing duplicate moves or messages.

---

## Appendix B. Research references

These support the design approach and precedents, not the proposed numerical balance.

**[1]** Robin Hunicke, Marc LeBlanc, and Robert Zubek. *MDA: A Formal Approach to Game Design and Game Research.* AAAI workshop, 2004. Primary author-hosted paper: `https://users.cs.northwestern.edu/~hunicke/MDA.pdf`

**[2]** Richard M. Ryan, C. Scott Rigby, and Andrew Przybylski. *The Motivational Pull of Video Games: A Self-Determination Theory Approach.* Motivation and Emotion, 2006. DOI: 10.1007/s11031-006-9051-8. Author-hosted paper: `https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf`

**[3]** Renegade Game Studios / Hasbro. *Diplomacy Quick Start Rules*, 2023. Publisher's product page links the official quick-start and full rulebooks: `https://renegadegamestudios.com/diplomacy/`

**[4]** Meta AI. *CICERO* research project and explanation of language-based negotiation combined with strategic reasoning: `https://ai.meta.com/research/cicero/`

**[5]** Tom Minka, Ryan Cleven, and Yordan Zaykov. *TrueSkill 2: An improved Bayesian skill rating system.* Microsoft Research, MSR-TR-2018-8, 2018. `https://www.microsoft.com/en-us/research/publication/trueskill-2-improved-bayesian-skill-rating-system/`

---

**The design in one sentence:** A small, readable war game that creates reasons to talk, where an alliance can win together but every player must decide what that alliance is worth to them.
