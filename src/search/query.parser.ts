import type { Place } from '../catalog/catalog.service';

export interface ParsedSearch {
  query: string;
  meaning: string;
  place: string | null;
  place_ids: string[];
  radius_miles: number | null;
  guests: number | null;
  bedrooms: number | null;
  pets: boolean;
  check_in: string;
  check_out: string;
  budget: number | null;
  budget_basis: 'nightly' | 'total';
  budget_currency: 'USD' | 'NGN' | 'GHS' | null;
  requested_type: string | null;
  assumptions: string[];
}

const DAY = 86_400_000;
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const TYPES = ['serviced apartment', 'a-frame', 'treehouse', 'farmhouse', 'apartment', 'cottage', 'cabin', 'chalet', 'lodge', 'studio', 'villa', 'house'];
const TYPE_TERMS: Record<string, string> = { flat: 'apartment', condo: 'apartment', loft: 'apartment', bungalow: 'cottage', 'log cabin': 'cabin', 'holiday home': 'house' };

function stamp(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function day(s: string): number { return Date.parse(`${s}T00:00:00Z`); }
function valid(s: string): boolean { return /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(day(s)) && stamp(day(s)) === s; }
function ordinal(raw: string): number { return ({ first: 1, second: 2, third: 3, fourth: 4, last: -1 } as Record<string, number>)[raw.toLowerCase()] ?? Number(raw.replace(/(?:st|nd|rd|th)$/i, '')); }
function number(raw?: string): number | null { if (!raw) return null; return NUMBERS[raw.toLowerCase()] ?? (Number.isFinite(Number(raw)) ? Number(raw) : null); }

function parseDates(text: string, today: string, assumptions: string[]): [string, string] {
  const base = valid(today) ? day(today) : Date.now();
  const nowYear = new Date(base).getUTCFullYear();
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\s*(?:to|through|until|[-–])\s*(20\d{2}-\d{2}-\d{2})\b/i);
  if (iso && valid(iso[1]) && valid(iso[2]) && day(iso[2]) > day(iso[1])) return [iso[1], iso[2]];
  const monthName = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const weekend = new RegExp(`\\b(first|second|third|fourth|last|[1-4](?:st|nd|rd|th))\\s+weekend\\s+(?:of|in)\\s+${monthName}(?:\\s+(20\\d{2}))?`, 'i').exec(text);
  if (weekend) {
    const month = MONTHS[weekend[2].slice(0, 3).toLowerCase()];
    let year = weekend[3] ? Number(weekend[3]) : nowYear;
    if (!weekend[3] && Date.UTC(year, month + 1, 0) < base) year++;
    const fridays: number[] = [];
    for (let n = 1; n <= new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); n++) {
      const value = Date.UTC(year, month, n);
      if (new Date(value).getUTCDay() === 5) fridays.push(value);
    }
    const target = ordinal(weekend[1]);
    const friday = target === -1 ? fridays[fridays.length - 1] : fridays[target - 1];
    if (friday !== undefined) return [stamp(friday), stamp(friday + 2 * DAY)];
  }
  const range = new RegExp(`\\b${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|through|until|[-–])\\s*(?:(?:${monthName})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, 'i').exec(text);
  if (range) {
    const mo = MONTHS[range[1].slice(0, 3).toLowerCase()];
    const endMo = range[3] ? MONTHS[range[3].slice(0, 3).toLowerCase()] : mo;
    let year = range[5] ? Number(range[5]) : nowYear;
    let first = Date.UTC(year, mo, Number(range[2]));
    if (!range[5] && first < base) { year++; first = Date.UTC(year, mo, Number(range[2])); }
    const endYear = endMo < mo ? year + 1 : year;
    const last = Date.UTC(endYear, endMo, Number(range[4]));
    if (last > first && last - first <= 30 * DAY) return [stamp(first), stamp(last)];
  }
  const single = new RegExp(`\\b${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?`, 'i').exec(text);
  if (single) {
    const month = MONTHS[single[1].slice(0, 3).toLowerCase()];
    let year = single[3] ? Number(single[3]) : nowYear;
    let first = Date.UTC(year, month, Number(single[2]));
    if (!single[3] && first < base) { year++; first = Date.UTC(year, month, Number(single[2])); }
    const n = number(text.match(/\b(\d+|one|two|three|four|five|six|seven)\s+nights?\b/i)?.[1]) ?? (text.includes('weekend') ? 2 : 1);
    return [stamp(first), stamp(first + Math.min(30, n) * DAY)];
  }
  const isoSingle = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoSingle && valid(isoSingle[1])) {
    const n = number(text.match(/\b(\d+|one|two|three|four|five|six|seven)\s+nights?\b/i)?.[1]) ?? 1;
    return [isoSingle[1], stamp(day(isoSingle[1]) + Math.min(30, n) * DAY)];
  }
  if (/\btomorrow\b/i.test(text)) return [stamp(base + DAY), stamp(base + 2 * DAY)];
  if (/\btonight\b/i.test(text)) return [stamp(base), stamp(base + DAY)];
  if (/\b(this|coming|next)\s+weekend\b/i.test(text) || /\bweekend\b/i.test(text)) {
    const dow = new Date(base).getUTCDay();
    const nextFriday = base + ((5 - dow + 7) % 7) * DAY;
    if (/\bnext weekend\b/i.test(text)) return [stamp(nextFriday + 7 * DAY), stamp(nextFriday + 9 * DAY)];
    if (dow === 6) return [stamp(base), stamp(base + DAY)];
    return [stamp(nextFriday), stamp(nextFriday + 2 * DAY)];
  }
  assumptions.push('Dates not specified: next available Friday and Saturday nights assumed.');
  const fri = base + ((5 - new Date(base).getUTCDay() + 7) % 7) * DAY;
  return [stamp(fri), stamp(fri + 2 * DAY)];
}

function parsePlace(text: string, places: Place[]): { place: Place | null; place_ids: string[]; radius_miles: number | null } {
  const normalized = text.toLowerCase();
  const matches = places.flatMap(p => [p.name, ...p.aliases].filter(s => s.length > 2).map(s => ({ name: s, place: p })))
    .filter(item => new RegExp(`(^|[^a-z])${item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase()}(?=$|[^a-z])`, 'i').test(normalized))
    .sort((a, b) => b.name.length - a.name.length);
  if (matches.length) {
    const chosen = matches[0].place;
    const vicinity = /\b(near|around|within|close to|outside|by)\b/i.test(text);
    return { place: chosen, place_ids: [chosen.id], radius_miles: vicinity ? 30 : null };
  }
  const region = /\blagos\b/i.test(text) ? 'Lagos' : /\baccra\b/i.test(text) ? 'Accra' : null;
  if (region) return { place: null, place_ids: places.filter(p => p.region === region).map(p => p.id), radius_miles: null };
  if (/\b(smokies|smoky mountains)\b/i.test(text)) return { place: null, place_ids: ['gatlinburg', 'pigeon-forge'], radius_miles: null };
  return { place: null, place_ids: [], radius_miles: null };
}

/** Extract eligibility predicates deterministically; embeddings never decide eligibility. */
export function parseSearch(query: string, today: string, places: Place[]): ParsedSearch {
  const text = query.trim();
  const assumptions: string[] = [];
  const location = parsePlace(text, places);
  const [check_in, check_out] = parseDates(text, today, assumptions);
  const person = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  const guestMatch = new RegExp(`\\b(?:for|family of|sleeps?|fits?|accommodat(?:e|es|ing)|party of|group of)\\s+${person}\\s*(?:of us|people|guests?|adults?|persons?|travellers?|travelers?|of us)?\\b`, 'i').exec(text)
    ?? new RegExp(`\\b${person}\\s+(?:people|guests?|adults?|persons?|travellers?|travelers?)\\b`, 'i').exec(text);
  let guests = number(guestMatch?.[1]);
  const adults = number(new RegExp(`\\b${person}\\s+adults?`, 'i').exec(text)?.[1]);
  const kids = number(new RegExp(`\\b${person}\\s+(?:kids?|children)`, 'i').exec(text)?.[1]);
  if (adults && kids) guests = adults + kids;
  else if (!guests && adults) guests = adults;
  if (!guests && /\b(?:a couple|couple|two of us|partner and me)\b/i.test(text)) guests = 2;

  const bedrooms = number(new RegExp(`\\b${person}\\s*(?:bedrooms?|beds?)\b`, 'i').exec(text)?.[1]);
  const pets = /\b(dog|dogs|puppy|pup|cat|cats|with (?:a |my |our )?pet|pet[- ]friendly|bringing (?:a |my )?pet)\b/i.test(text) && !/\b(no pets?|without (?:a |any )?(?:pets?|dogs?|cats?))\b/i.test(text);
  const money = /(?:\$|USD\s*|US\$\s*|₦\s*|NGN\s*|N\s*|GH₵\s*|GHS\s*|₵\s*)([\d,]+(?:\.\d+)?)(k\b)?|\b(?:under|below|max(?:imum)?|up to|budget(?: of)?|less than)\s+([\d,]+(?:\.\d+)?)(k\b)?\b/i.exec(text);
  let budget: number | null = null;
  let budget_currency: ParsedSearch['budget_currency'] = null;
  if (money) {
    budget = Number((money[1] ?? money[3]).replace(/,/g, '')) * ((money[2] ?? money[4]) ? 1000 : 1);
    const prefix = text.slice(Math.max(0, money.index - 5), money.index + money[0].length).toLowerCase();
    budget_currency = /₦|\bngn\b|\bnaira\b/.test(prefix) ? 'NGN' : /₵|\bghs\b|\bcedis?\b/.test(prefix) ? 'GHS' : /\$|\busd\b/.test(prefix) ? 'USD' : null;
    if (!budget_currency && location.place) budget_currency = location.place.currency as ParsedSearch['budget_currency'];
    if (!budget_currency && location.place_ids.length) {
      const currencies = new Set(places.filter(p => location.place_ids.includes(p.id)).map(p => p.currency));
      if (currencies.size === 1) budget_currency = [...currencies][0] as ParsedSearch['budget_currency'];
    }
    if (!budget_currency) assumptions.push('Unmarked price amount uses each listing’s local currency.');
  }
  const budget_basis: ParsedSearch['budget_basis'] = /\b(total|altogether|whole stay|entire stay|for the stay|overall|in total)\b/i.test(text) ? 'total' : 'nightly';
  if (budget !== null && budget_basis === 'nightly') assumptions.push('Budget interpreted as a per-night limit before fees.');
  const lower = text.toLowerCase();
  const requested_type = TYPES.find(t => new RegExp(`\\b${t}s?\\b`, 'i').test(lower)) ?? Object.entries(TYPE_TERMS).find(([t]) => new RegExp(`\\b${t}s?\\b`, 'i').test(lower))?.[1] ?? null;
  const meaning = text
    .replace(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?|\d+(?:\.\d+)?k?)\b/gi, ' ')
    .replace(/(?:\$|₦|₵|\bUSD\b|\bNGN\b|\bGHS\b)/gi, ' ')
    .replace(/\b(near|around|in|at|for|of|us|with|the|a|an|first|second|third|fourth|last|weekend|october|september|november|december|january|february|march|april|may|june|july|august|under|below|and|we|need|looking|want|next|this|from|to|staying|night|nights|dollars|total)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  return { query: text, meaning: meaning || text, place: location.place?.name ?? null, place_ids: location.place_ids, radius_miles: location.radius_miles, guests, bedrooms, pets, check_in, check_out, budget, budget_basis, budget_currency, requested_type, assumptions };
}
