# Hearthly hybrid search — engineering notes

## Architecture / decisions

`POST /v1/search` validates inputs, deterministically parses the query, applies tenant visibility / guest / pet / bedroom / location and explicit currency restrictions **before** ranking, then scores the authorized catalogue with BM25 + offline travel-concept embeddings + type preference. Candidate scores are blended with Reciprocal Rank Fusion; the guest-facing `why` line is derived only from catalogue attributes. Listing type and preferences are *ranking signals*, not eligibility overrides.

Every structurally eligible listing receives a **live** availability and price quote in batches of at most 50 (up to 8 concurrent batches), **before** budget validation and final ranking/limit. No candidate is dropped before the live check, to avoid false zero-result pages when the nominal top candidates are already booked. Every night must be available; total and mean must agree with the live nightly quotes. `price_hint` is never used in decisions or responses. Inventory errors fail closed (503), never to stale data. Search indices contain only public/private-filterable content, not pricing or inventory.

Partner isolation is a server-side requirement: only `visibility=public` or `visibility=private:<authenticated tenant>` can enter the retrieval/ranking set. The LLM (not required in this offline lab) never decides tenant scope, access, availability or money.

## Assumptions / policy decisions

- The supplied `x-tenant` is already authenticated by the gateway, per contract. Unknown tenants see no inventory.
- `in PLACE` restricts to that place ID; `near PLACE` uses a **30-mile straight-line radius** around the place centroid (disclosed in `understood`). A city-region name like Lagos/Accra searches its defined neighbourhoods. These rules are configurable product choices.
- A weekend means **Friday and Saturday nights**, checking out Sunday; if today is Saturday, `this weekend` means Saturday night. First/second/third/fourth/last weekend of a month means the corresponding Friday. For month/day without a year, choose the next occurrence. Unknown stay dates default to the coming weekend and the assumption is returned explicitly.
- Unless `total`, `entire stay`, etc. is present, `under $250` means up to 250 **per night**, in the explicitly stated currency (before fees). Full stay totals are still displayed. No FX conversion is assumed: a budget in USD excludes NGN/GHS listings rather than making a misleading comparison. If a budget amount has no currency, use the named place's currency or the candidate's currency where no place is provided.
- Guest capacity, explicit bedroom minimum, and requests *bringing* pets are hard constraints. Cabin/cottage/etc., amenities and vibes determine **rank order**. The supplied inventory exposes one `pets_allowed` boolean, not per-animal policies or pet surcharges.
- When a query has no available matches, return `{results: []}`. A future UI can offer opt-in relaxations; the search API never silently relaxes hard conditions.

## Evaluation

Run `npm run inventory` and `npm run dev` in two terminals, then `SEARCH_URL=http://localhost:3000 INVENTORY_URL=http://localhost:4010 bash eval.sh`. `eval/queries.jsonl` has **20 human-interpretable graded examples** (0–3, with highest grades for matching the requested type + features) spanning mountain towns, coastal stays, Lagos, Accra, pet/capacity constraints, budgets, private partner access and an intentional zero-result query.

`eval.py` calls the **real search endpoint** and independently calls **live inventory** for returned and judged IDs. It computes live-eligible Recall@10 and nDCG@10, the proportion of actual results obeying structural hard constraints, exact match of response vs live quote prices, empty-result correctness, p50/p95 API latency and rate of searches below 300ms. Relevance labels are intentionally static; unavailable judged stays are omitted from the ideal ranking at evaluation time. Live availability changes with the grading seed: metrics should be rerun against that seed.

**Baseline** (provided starter): word matching only on titles, stale `price_hint`, no guest/geo/pet/date/tenant eligibility, no live inventory or meaningful ranking evaluation. **After**: explicit hard-rule gates, hybrid ranking, authoritative price/availability and an executable offline evaluation. Quantitative scores come from `eval.sh` at runtime; do not invent baseline or after numbers for runs not executed.

## Where vectors deliberately do not apply

Authorization and tenant isolation, geospatial radius, capacity and bedroom minimum, dog eligibility, day-by-day booking availability, quote amounts and budget comparison. These require structured/authoritative checks, not semantic similarity. The offline 24-concept vector is intentionally lightweight: no model downloads or external APIs are needed after setup. BM25 supports exact travel terms; embeddings add synonym-level recall for travel intent (e.g. 'secluded'/'romantic', 'desk'/'work').

## Next

Confirm `near`/weekend/budget product policy with Tolu. Add an authorization middleware backed by verified tenant principal instead of directly trusting headers outside this gateway-controlled lab. Expand temporal and currency language parsing with a structured local grammar or small, optional, validated LLM parser. Explore location geocoding and travel-time distance, a trained cross-encoder for reranking (benchmark quality vs latency), versioned catalogue updates, multi-currency quote service, explainability, and per-tenant monitoring + segment-level A/B conversion.

## AI assistance and human verification

AI assisted with typed NestJS parsing/retrieval implementation, local offline ranking, evaluation plumbing and drafting notes. I selected the separation of hard vs soft constraints, chose fail-closed quotes and strict tenant prefiltering, grounded sample relevance judgments in the actual Hearthly catalogue, reviewed date/currency decisions and tested representative parser, budget, privacy and live-inventory paths. Open questions and approximations are called out above, rather than representing them as product decisions or claiming unobserved benchmark numbers.
