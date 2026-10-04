# Workflow and order guide

## Choosing a verb

- `attack`: broad pressure across one or several current goals; safest fallback for disconnected fronts.
- `allout`（全线总攻）: an all-front, high-casualty order. Use only when holding a clear advantage or in desperation. It needs no `from/to/path`; `setCountryOrder` covers the country, while `setTheaterOrder` and `setArmyOrder` restrict the scope. `ao` limits enemy targets; `mustHold` protects explicitly held tiles. It acts once by default; `expires` makes it persist. Include a Chinese `reason` and read the returned casualty warning.
- `breakthrough`: push one adjacent path toward depth; pair with armor and occupation support.
- `envelop`: exactly two axes around a target sector. Use only when both starts are current and both paths are adjacent.
- `counterattack`: regain a recent loss when a viable formation is nearby.
- `defend`: occupy and hold explicit line posts. Supply `to=line`; do not assume omission will derive it reliably.
- `delay`: trade space/time along a line; exact withdrawal quality is **未验证**.
- `concentrate`: assemble at a goal before a new attack; `autoPath:true` produced intermediate steps in game 5 (`game_05_battle_wto3.md:14`).
- `screen`: cover a line without assuming decisive defense; exact behavior is **未验证**.
- `withdraw`: disengage toward friendly ground; exact behavior is **未验证**.
- `support`: reinforce another formation/area; exact behavior is **未验证**.

## Geometry

- Preview every `path`/`axes`/`line`. Paths must be enabled, land-passable and adjacent (`public/src/game/army_groups.js:202-229`).
- `from` may be an array for multiple starts and `to` an array for multiple goals. This worked across disconnected fronts in game 6 (`game_06_battle_nato4.md:6,15`).
- `axes` must contain exactly two paths and requires `envelop`.
- `detour:true` permits local executor bypass; it does not repair a stale strategic destination.
- For defend/screen, use identical arrays for `to`, `line`, and optional `mustHold`. Game 4 succeeded only after doing this (`game_04_battle_allies3.md:13,16`).

## Standing order versus micro

- Let a standing order perform bulk movement and ordinary attacks.
- Micro first when a ranged unit can soften safely, a fragile unit must not attack, an armored unit can finish/occupy, or a card changes the exchange.
- A manually used unit is skipped by later standing execution that round. A newly issued formation order clears that priority, so do not reissue after micro unless deliberate (`public/src/game/game.js:218-222,442-458`).
- At next `turnStart`, movement restores and the standing order resumes automatically (`public/src/game/rules/turn.js:83-93`).

## Diagnosing status

- `progressing`: verify that progress is strategically useful, not movement toward an obsolete goal.
- `achieved`: inspect the front and issue the next operational intent.
- `stalled`: refresh front and unit legality, inspect warnings/rejected/plan, then redraw current adjacent goals. Three no-progress rounds trigger it (`public/src/game/game.js:260-296`).
- `failed`: fix invalid geometry, missing target, eliminated country, or expired objective; then issue a new order.
- `rejected`: reason is per attempted action. Refresh live unit view before replacing route.

## Round cadence

- Every round: objective/remaining turns, front, resources, formation status.
- Every 2-3 rounds: redraw moving axes, inspect ungrouped units, spend reserves.
- Before end turn: ensure fragile melee units are not exposed to a standing attack and that expensive cards have legal targets.
- After end turn: compare captures/losses and ScriptedAi expansion, not only local battle events.
- For every mutation, write a fresh `reason` tied to the observed state and intended effect. The log is player-facing, so avoid generic phrases such as “按计划行动”.
