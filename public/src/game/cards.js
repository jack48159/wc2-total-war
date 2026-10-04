// Card catalogue rules: which cards a country can buy and what they cost.
export const CARD_TYPES = ['army', 'navy', 'airforce', 'development', 'strategy'];
const TECH_SCALED = 21;   // the technology card costs price/industry x current tech level

// data = data/cards.json ({ <flag>: [...overrides], others: [...] }); country overrides win over 'others'.
export function shopCards(data, flag) {
  const ids = new Set(), list = [];
  for (const c of (data[flag] || []).concat(data.others)) if (!ids.has(c.id)) { ids.add(c.id); list.push(c); }
  return list.sort((a, b) => a.id - b.id);
}
export const cardPrice = (card, tech) => card.id === TECH_SCALED ? card.price * tech : card.price;
export const cardIndustry = (card, tech) => card.id === TECH_SCALED ? card.industry * tech : Math.max(0, card.industry);
