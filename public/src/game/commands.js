// Command registry: the ONLY way game state changes. Game.apply(cmd) looks the type up here.
//   register('move', { validate(game, cmd) -> null | reasonString, execute(game, cmd) -> void })
// execute() mutates state and reports through game.emit(EV.xxx, payload); it must not touch the UI, the DOM or Math.random.
// Rule modules in game/rules/* register their commands from their own file; rules/index.js imports them all.
// See COMBAT_SPEC.md for the list of commands and their payloads.
const table = new Map();

export function register(type, handler) {
  if (table.has(type)) throw new Error('command registered twice: ' + type);
  table.set(type, handler);
}
export const handlerFor = type => table.get(type);
export const commandTypes = () => [...table.keys()];
