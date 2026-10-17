#!/usr/bin/env node
/**
 * Hearthly's live availability and price service, for local development (the same behaviour as production, with
 * its own data). Prices and availability change all the time: never copy them into your index. When we grade, we run
 * our own copy, seeded differently, and point INVENTORY_URL at it.
 *
 *   node tools/inventory-dev.mjs            # http://localhost:4010
 *
 * GET /v1/availability?ids=L0001,L0002&check_in=2026-10-02&check_out=2026-10-04
 *   -> { "results": [{ "listing_id", "available", "nights": [{ "date", "available", "price" }], "total", "nightly_avg", "currency" }] }
 *   Up to 50 ids per request. Prices are per night, in the listing's currency, before fees.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SEED = process.env.INVENTORY_SEED ?? 'dev';
const PORT = Number(process.env.INVENTORY_PORT ?? 4010);
const LISTINGS = new Map(JSON.parse(readFileSync(join(DATA, 'listings.json'), 'utf8')).map((l) => [l.id, l]));
const MOUNTAIN = new Set(['asheville', 'black-mountain', 'weaverville', 'brevard', 'boone', 'gatlinburg', 'pigeon-forge', 'blue-ridge']);

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseDay = (s) => Date.parse(`${s}T00:00:00Z`);

/** One night's availability and price, as the live system has it (seed: 'dev' for candidates, another for grading). */
function night(listing, date, seed) {
  const r = rng(`${seed}:${listing.id}:${date}`);
  const d = new Date(parseDay(date));
  const dow = d.getUTCDay(); // 5 Friday, 6 Saturday
  const weekend = dow === 5 || dow === 6;
  const peak = MOUNTAIN.has(listing.place_id) && d.getUTCMonth() === 9; // October: leaf season
  // Weekends are booked as a block (Friday and Saturday nights together); weekdays night by night.
  const week = Math.floor((parseDay(date) + 3 * DAY) / (7 * DAY));
  const booked = weekend ? rng(`${seed}:${listing.id}:w${week}`)() < 0.28 + (peak ? 0.12 : 0) : r() < 0.06 + (peak ? 0.04 : 0);
  const drift = 0.82 + rng(`${seed}:${listing.id}`)() * 0.4; // the live price has moved away from price_hint
  const price = Math.round(listing.price_hint * drift * (weekend ? 1.22 : 1) * (peak ? 1.15 : 1) / (listing.currency === 'USD' ? 1 : 100)) * (listing.currency === 'USD' ? 1 : 100);
  return { date, available: !booked, price };
}

function quote(listing, checkIn, checkOut, seed) {
  const nights = [];
  for (let t = parseDay(checkIn); t < parseDay(checkOut); t += DAY) nights.push(night(listing, ymd(t), seed));
  const total = nights.reduce((s, n) => s + n.price, 0);
  return { listing_id: listing.id, available: nights.length > 0 && nights.every((n) => n.available), nights, total, nightly_avg: nights.length ? Math.round((total / nights.length) * 100) / 100 : null, currency: listing.currency };
}


createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/health') return send(200, { ok: true });
  if (url.pathname !== '/v1/availability') return send(404, { error: 'Not found' });
  const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
  const checkIn = url.searchParams.get('check_in') ?? '';
  const checkOut = url.searchParams.get('check_out') ?? '';
  if (!ids.length || ids.length > 50) return send(400, { error: 'Send between 1 and 50 ids.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut) || checkOut <= checkIn) return send(400, { error: 'check_in and check_out are YYYY-MM-DD, check_out after check_in.' });
  if ((Date.parse(checkOut) - Date.parse(checkIn)) / DAY > 30) return send(400, { error: 'At most 30 nights.' });
  const unknown = ids.filter((id) => !LISTINGS.has(id));
  if (unknown.length) return send(404, { error: `Unknown listing: ${unknown.join(', ')}` });
  // Like production: a little slower for bigger batches.
  setTimeout(() => send(200, { results: ids.map((id) => quote(LISTINGS.get(id), checkIn, checkOut, SEED)) }), 15 + ids.length);
}).listen(PORT, () => console.log(`Hearthly inventory (dev) on http://localhost:${PORT}`));
