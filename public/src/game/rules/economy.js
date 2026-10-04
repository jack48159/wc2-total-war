// Economy commands. Loan remains pending original-bank rule recovery.
import { register } from '../commands.js';
import { EV } from '../events.js';

register('buyCard', {
  validate(game, cmd) {
    const country = cmd.country || game.activeCountry || game.player;
    const card = game.findCard(cmd.card, country); if (!card) return 'unknown-card';
    return game.whyNot(card, country);                         // 'tech' | 'money' | 'industry' | null
  },
  execute(game, cmd) {
    const country = cmd.country || game.activeCountry || game.player;
    const isPlayer = country === game.player;
    const card = game.findCard(cmd.card, country);
    const moneyCost = game.price(card, country), industryCost = game.industryCost(card, country);
    const wallet = isPlayer ? game : game.stage.countries.get(country);
    wallet.money -= moneyCost; wallet.industry -= industryCost;
    if (card.id === 21) {
      if (isPlayer) {
        game.techTurn = 3;
        game.cardCooldowns[card.id] = card.round || 0;
      } else {
        wallet.techTurn = 3;
        wallet.cardCooldowns = wallet.cardCooldowns || {};
        wallet.cardCooldowns[card.id] = card.round || 0;
      }
    } else {
      if (isPlayer) {
        game.hand[card.id] = (game.hand[card.id] || 0) + 1;
      }
    }
    game.emit(EV.CARD_BOUGHT, { country, card: card.id, moneyCost, industryCost,
      moneyAfter: wallet.money, industryAfter: wallet.industry, handCount: isPlayer ? game.hand[card.id] || 0 : 0,
      techAfter: isPlayer ? game.tech : wallet.techlevel, techTurn: isPlayer ? game.techTurn : wallet.techTurn });
    game.emit(EV.RESOURCES_CHANGED, { country, money: wallet.money, industry: wallet.industry });
  },
});
