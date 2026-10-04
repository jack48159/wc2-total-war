# Rules and mechanics

## Turn and victory

- MCP mutations require a player-readable Chinese `reason`; this is a control-layer audit rule and does not change combat, economy, AI, or victory mechanics.

- Campaign uses its scenario limit; conquest has none (`public/src/game/game.js:187-190`).
- End turn closes recovery/cooldowns, runs active AI countries, advances round, checks victory, grants income, restores movement, then runs `turnStart` orders (`public/src/game/rules/turn.js:20-93,121-145`).
- Failure occurs when `round > totalRounds`; limit 16 therefore reports on round 17 (`public/src/game/rules/victory.js:108-116`; `game_06_battle_nato4.md:4,13`).
- No land means elimination. Other non-stability defeat rules may require an army or core (`public/src/game/rules/victory.js:9-17`). Capital occupation plus stability at/below the configured threshold (default 30) can also eliminate (`public/src/game/rules/victory.js:85-105`).
- Victory requires no living enemy under diplomacy/alliance rules. Conquest has no stars; campaigns begin at five stars and degrade after `greatVictory` (`public/src/game/rules/victory.js:118-144`).

## Movement, recovery, supply, stacking

- Move validates ownership, movement, domain and capacity, then uses a shortest legal path and directional cost; empty intermediate hostile land can be captured (`public/src/game/rules/movement.js:15-54`).
- Allied occupation may register hostility/transfer ownership; observed on `ru1`, so move through allied land cautiously (`public/src/game/rules/movement.js:29-49`; `game_05_battle_wto3.md:13,16`).
- Unspent movement grants rest: base 9/7/5/6/3 by area type plus 3 per city/industry level; naval units double sea rest. Rank/commander recovery also applies (`public/src/game/rules/turn.js:11-42`).
- Movement restores at turn start; non-naval units at sea are capped to one (`public/src/game/rules/turn.js:83-89`).
- Tile capacity defaults to four with overrides; group cap is 16 (`public/src/game/stage.js:269-272`; `public/src/game/army_groups.js:24,152,175`).
- No consumable unit supply stock is exposed. `supply:null` means not modeled. Card 26 heals every damaged unit on the tile, not only a supplied `armyId` (`public/src/game/rules/cardEffects.js:106,157-163`; `game_04_battle_allies3.md:13,16`).

## Combat

- HP dice: >=50%=5, 25-49%=4, 15-24%=3, 6-14%=2, <=5%=1 (`public/src/game/rules/combatModel.js:10-19`).
- Fort, entrenchment and area type 1 add one defense input; levels, commanders, cards, morale and matchups also apply (`public/src/game/rules/combatModel.js:165-172,351-357`).
- Attacks spend `attackCost` (normally one). Eligible tanks keep movement only after killing a defender while others remain; entrenchment may exhaust attackers (`public/src/game/rules/combatModel.js:36-45`).
- Artillery/rockets normally cannot occupy; occupation needs matching land/sea domain. Rockets normally counter rockets; artillery has explicit counter exceptions (`public/src/game/rules/combatModel.js:70-104`).
- Fresh/repeat flank is +10/+5%; fresh/repeat rear +15/+7% (`public/src/game/rules/combatModel.js:126-133,522-532`).
- Encirclement derives from connected groups/ring strength, reduces the surrounded side's output, and suppresses flank/rear on the surrounded defender (`public/src/game/rules/combatModel.js:115-176,519-603`). Sampled level-1 penalties were 28-30% and one level-2 position 75%; percentages are state-dependent (`game_01b_conquest_mirror_de.md:10`; `game_05_battle_wto3.md:8`).
- An exhausted defender (`movement===0`) deals 10% less counter damage (`public/src/game/rules/combatModel.js:519-532,560-595`).
- Stack splash suppresses ordinary counterattack and applies falloff behind the front (`public/src/game/rules/combatModel.js:500-505,587-588`; `public/src/game/rules/combat.js:162-170`). Bombing hit multiple stacked units while air strike was single-target in game 5 (`game_05_battle_wto3.md:10,15`).
- `wc2_preview_attack` is the engine estimator and already includes terrain, fort, facing, fatigue, encirclement and matchups (`public/src/game/rules/combatModel.js:646-714`).

## Economy, cards, technology, diplomacy

- Controlled areas produce money/industry, then commerce and stability modify them (`public/src/game/game.js:346-373`). Stability income is 100/92/80/64/48% at 80/60/40/20 thresholds (`public/src/game/rules/diplomacy.js:162-169`).
- Buying validates tech, cooldown, money and industry. Tech card 21 takes three turns and does not enter hand (`public/src/game/rules/economy.js:5-35`).
- Using a card separately checks target, terrain/domain, capacity, development cap and tactic eligibility (`public/src/game/rules/cardEffects.js:65-107`). Buyable does not mean deployable (`game_03_battle_nato3.md:14-17`).
- Invalid targets should be retried from returned `legalTargets` (`game_01b_conquest_mirror_de.md:8`; `game_06_battle_nato4.md:7`).
- War declaration costs base 12 stability; alliance/NAP betrayal costs 20 before traits (`public/src/game/rules/diplomacy.js:162-178`). Loss ledgers use destroyed-unit build cost; peace charges casualty-based reparations and creates truce/cooldowns (`public/src/game/rules/diplomacy.js:129-150,338-390,883-913`). Diplomacy/peace remains **未验证于六局实战**.

## Standing orders

- Verbs: attack, breakthrough, envelop, counterattack, defend, delay, concentrate, screen, withdraw, support (`public/src/game/army_groups.js:201-230`).
- Envelop alone takes two axes. Defend/screen require `to===line` and any `mustHold===line` (`public/src/game/army_groups.js:206-223`).
- Auto execution is once per round/phase at turnStart/endTurn (`public/src/game/game.js:252-256`; `public/src/game/rules/turn.js:91-93`).
- Manual actions have round priority; reissuing an order clears formation manual flags (`public/src/game/game.js:218-222,442-458`).
- Three no-progress rounds cause stalled; progress clears it. Expiry falls without progress and can slide up after progress (`public/src/game/game.js:260-296`).
