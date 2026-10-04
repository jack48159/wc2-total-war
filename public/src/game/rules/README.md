# game/rules/
One file per rule area; each registers its commands with `register()` from `../commands.js` and is imported in `index.js`.
Suggested split (see COMBAT_SPEC.md §4 for the contract of each):
  armies.js      army stats: create / hp / dice / level / morale (pure functions on army objects)
  movement.js    move cost, reachable areas, `move` command
  combat.js      `attack` command, damage resolution, capture, encirclement
  turn.js        `endTurn`, round / turn order, turn begin / end hooks, upkeep, income
  cardEffects.js `useCard` command (deploy, air strike, paratroopers, ...)
  victory.js     victory / defeat evaluation, `gameOver`
  scenario.js    scenario events (data/stages/*.json -> extra)
economy.js already holds `buyCard`.
