/**
 * A small offline embedding: text -> a 24-number vector over travel concepts (cabin, romantic, pets, work, water...).
 * It stands in for a real embedding model so your search runs offline when we grade it. Use it, improve it, or don't.
 * Same algorithm in Python: tools/embed.py. ES modules: tools/embed.mjs.
 */
const CONCEPTS = {
  cabin: ['cabin', 'log', 'timber', 'a-frame', 'chalet', 'lodge', 'rustic', 'woods', 'wood', 'hut'],
  cottage: ['cottage', 'bungalow', 'cosy', 'cozy', 'charming', 'garden'],
  apartment: ['apartment', 'flat', 'loft', 'condo', 'studio', 'serviced', 'suite'],
  luxury: ['luxury', 'luxurious', 'elegant', 'villa', 'premium', 'upscale', 'high-end'],
  budget: ['cheap', 'budget', 'affordable', 'inexpensive', 'value', 'deal'],
  romantic: ['romantic', 'honeymoon', 'couple', 'couples', 'anniversary', 'getaway', 'secluded', 'intimate'],
  family: ['family', 'families', 'kids', 'children', 'crib', 'game', 'games', 'spacious', 'reunion'],
  pets: ['dog', 'dogs', 'pet', 'pets', 'puppy', 'cat', 'pup'],
  nature: ['nature', 'hiking', 'trail', 'trails', 'forest', 'creek', 'creekside', 'river', 'quiet', 'peaceful'],
  mountain: ['mountain', 'mountains', 'view', 'views', 'hilltop', 'ridge', 'smokies', 'peak'],
  water: ['lake', 'lakefront', 'beach', 'ocean', 'sea', 'waterfront', 'pool', 'creek', 'river'],
  warm: ['fireplace', 'fire', 'stove', 'wood-burning', 'firepit', 'pit', 'hearth'],
  hottub: ['hot', 'tub', 'jacuzzi', 'spa'],
  work: ['work', 'remote', 'workspace', 'desk', 'wifi', 'internet', 'office', 'fast'],
  city: ['downtown', 'city', 'walkable', 'nightlife', 'restaurants', 'central', 'urban'],
  farm: ['farm', 'farmhouse', 'barn', 'acres', 'countryside'],
  treehouse: ['treehouse', 'tree', 'treetop'],
  access: ['accessible', 'wheelchair', 'step-free', 'stepfree', 'ground-floor', 'mobility'],
  power: ['generator', 'power', 'electricity', 'inverter', 'backup'],
  security: ['security', 'secure', 'gated', 'guarded'],
  modern: ['modern', 'new', 'renovated', 'restored', 'bright', 'light-filled'],
  group: ['group', 'groups', 'friends', 'party', 'large', 'lodge'],
  car: ['parking', 'ev', 'charger', 'garage'],
  coast: ['coastal', 'island', 'tybee', 'porch', 'bikes', 'marsh'],
};
const CONCEPT_KEYS = Object.keys(CONCEPTS);
const WORD = new Map();
CONCEPT_KEYS.forEach((k, i) => CONCEPTS[k].forEach((w) => WORD.set(w, [...(WORD.get(w) ?? []), i])));
function embed(text) {
  const v = new Array(CONCEPT_KEYS.length).fill(0);
  for (const w of String(text).toLowerCase().split(/[^a-z0-9-]+/)) for (const i of WORD.get(w) ?? WORD.get(w.replace(/s$/, '')) ?? []) v[i] += 1;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => +(x / norm).toFixed(4));
}

module.exports = { CONCEPTS, embed };
