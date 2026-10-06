// Shared by local games, bridge games and the authoritative multiplayer engine.
export function isSandbox(game) {
  return !!(game?.sandbox || game?.sandboxCustom || game?.sandboxBattle || game?.stage?.data?.sandboxMode);
}
export function hasStability(game) { return !isSandbox(game); }
