# Hearthly search

Hearthly is a stays marketplace (cabins, cottages, apartments) in the US Southeast, Lagos and Accra. Guests search on
Hearthly's own site; partner businesses (property managers, travel agencies) search through Hearthly's API. Each
partner may also have **private stays only they can see**.

Today's search is a word match on titles (`src/search/search.service.ts`). It ignores dates, guests, pets, place and
price, shows an out-of-date price, and doesn't know who is asking. Your job is to replace it with **hybrid search**,
and to **measure** it.

## What to build (about 50 minutes)

1. `POST /v1/search` that turns a guest's sentence into a precise search, for example:

   > a cabin near Asheville for four of us and the dog, first weekend of October, under $250

   Hard rules (place, guests, pets, dates, price) must hold for every result. Meaning ("cabin", "romantic", "quiet
   place to work") decides the order, never what is allowed. Prices and availability come **live** from the
   inventory service for the requested nights, never from `price_hint`.
2. **A test set of 20 queries** in `eval/queries.jsonl`, with your judgments, and `eval.sh`, which runs them against
   the search and prints your metrics.
3. **NOTES.md**: how you measured, where you chose not to use vectors and why, and what you would improve next.

Some product rules are not written down here (what "near" means, what a weekend is, what a price limit applies to).
Ask the people in the Lab, or decide and write down what you assumed.

## The contract we grade

```
POST /v1/search
x-tenant: hearthly | ridgeline | lagos-keys | savannah-co    (which business is asking; already authenticated)
x-now:    2026-09-14                                          (today, for this request: resolve "this weekend" against it)
{ "q": "a cabin near Asheville for four of us and the dog, first weekend of October, under $250", "limit": 10 }

200 { "results": [ { "listing_id": "L0123", "title": "...", "nightly_avg": 231.5, "total": 463,
                     "currency": "USD", "why": "Log cabin 6 miles from Asheville, dogs welcome, hot tub" } ],
      "understood": { ...whatever you parsed... } }
```

- `results` best first, at most `limit` (default 10). An empty list is right when nothing fits.
- `nightly_avg` and `total` for the requested nights, from live inventory, in the listing's currency.
- `why`: one short line a guest could read.
- `understood`: what you parsed (free form); reviewers read it.
- **A business must never see another business's private stays**, whatever the query says.

## Data and services

- `data/listings.json` (445 stays), `data/places.json`, `data/tenants.json`.
- Live availability and prices: `npm run inventory` starts a local copy on http://localhost:4010 (see
  `tools/inventory-dev.mjs` for the API). **When we grade, prices and availability are different**: we run our own
  copy and set `INVENTORY_URL`. Never copy prices or availability into your index.
- `tools/embed.mjs` / `tools/embed.py`: a small offline text embedding (24 travel concepts). It stands in for a real
  embedding model, because grading runs offline. Use it, improve it, or don't.
- A Postgres 16 with pgvector is available at `$DATABASE_URL` when we grade, if you want it. In-memory is fine.

## How we run it

On a clean Linux machine (Ubuntu 24.04, Node 22, Python 3.12) as a user with no special rights:

1. `bash setup.sh`: install and build. Network allowed, up to 10 minutes.
2. `bash start.sh` with `PORT`, `INVENTORY_URL`, `DATABASE_URL` set: must answer `GET /health` within 60 seconds.
   No network from here on except this machine.
3. Our hidden queries (like the one above, for different businesses and dates) against your search.
4. `bash eval.sh` with `SEARCH_URL` set (up to 3 minutes): it must exit 0 and print your metrics.

We look at: every hard rule holding in every result, no stay from another business, live prices, how good the order
is, speed (each search under about 300 ms), whether your evaluation runs and measures something real, and the code.

You can change anything, including the language (keep the two scripts and the contract). Push to `main` or open a
pull request into `main`; we take the latest when your time ends.

## Run it

```bash
npm install
npm run inventory          # in one terminal
npm run dev                # in another
curl -s localhost:3000/v1/search -H 'content-type: application/json' -H 'x-tenant: hearthly' -H 'x-now: 2026-09-14' \
  -d '{"q":"a cabin near Asheville for four of us and the dog, first weekend of October, under $250"}'
```
