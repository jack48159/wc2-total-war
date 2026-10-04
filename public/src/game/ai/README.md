# game/ai/
Controllers' brains. `game/controllers.js` defines the interface (`takeTurn(game, country) -> command[]`);
put the built-in AI here (e.g. `scripted.js`) and register it in `defaultControllers`.
Rules: read state only through `game.describe()` / `game.stage`, act only by returning commands (never mutate).
