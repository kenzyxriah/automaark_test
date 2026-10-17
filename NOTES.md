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

## Evaluation — measured original versus hybrid

The evaluator in `eval.py` makes actual HTTP requests to two independent API processes:
- Before: the unmodified starter code from initial commit `be0a955d`, compiled and served on port 3001.
- After: the current hybrid search, served on port 3000.

Both execute the exact same **20 manually graded** queries from `eval/queries.jsonl`, with the same tenant and `x-now` headers, the same graded relevance labels, and the same live inventory server and seed. The authoritative query interpretation comes from the hybrid parser, because the original word matcher does not parse constraints; the evaluator independently checks **both** result sets against those same rules and live quotes. Relevance judgments for unavailable or unaffordable stays are excluded from both ideal rankings for that query.

| Metric (20 queries, CI dev inventory seed) | Before: original word match | After: hybrid |
|---|---:|---:|
| Mean Recall@10 | 0.333 | 0.975 |
| Mean nDCG@10 | 0.296 | 0.925 |
| Hard-rule + live-eligibility pass | 13/200 (6.5%) | 174/174 (100%) |
| Exactly matches live quote totals and nightly averages | 0/200 | 174/174 |
| Private stays exposed to unauthorized tenant | 5 | 0 |
| Correctly empty impossible-query response | 0/1 | 1/1 |
| p50 API latency | 2.0 ms | 43.3 ms |
| p95 API latency | 3.4 ms | 75.7 ms |
| Searches under 300 ms | 20/20 | 20/20 |

Result: +0.642 mean Recall@10 and ~+0.630 mean nDCG@10. The baseline is much faster because it returns stale hints and makes **no** live inventory calls, not because it performs equivalent search work. Likewise, a zero live-quote-match count reflects that the baseline response has null totals and stale nightly price hints. The new pipeline does the extra work required by the product contract.

These are **local lab evaluation numbers**, not an estimate of production conversion or a guarantee under different inventory seeds. Evaluations use a small, hand-curated label set, and Recall@10 is defined only over the available, eligible judged IDs rather than all conceivable relevant stays. Re-run for different `INVENTORY_SEED` settings and add an independent held-out annotation set before drawing broader conclusions.

Reproduce under GitHub Actions: `.github/workflows/validate.yml` builds the original Git commit and new code, runs both services plus a shared live inventory, then runs `bash eval.sh` with `BASELINE_URL` and `SEARCH_URL` set; evaluation output is uploaded as a workflow artifact. For the grading environment, `bash eval.sh` also works without `BASELINE_URL`, evaluating the running new search alone. Last verified run: https://github.com/kenzyxriah/automaark_test/actions/runs/39058399144

## Where vectors deliberately do not apply

Authorization and tenant isolation, geospatial radius, capacity and bedroom minimum, dog eligibility, day-by-day booking availability, quote amounts and budget comparison. These require structured/authoritative checks, not semantic similarity. The offline 24-concept vector is intentionally lightweight: no model downloads or external APIs are needed after setup. BM25 supports exact travel terms; embeddings add synonym-level recall for travel intent (e.g. 'secluded'/'romantic', 'desk'/'work').

## Next

Confirm `near`/weekend/budget product policy with Tolu. Add an authorization middleware backed by verified tenant principal instead of directly trusting headers outside this gateway-controlled lab. Expand temporal and currency language parsing with a structured local grammar or small, optional, validated LLM parser. Explore location geocoding and travel-time distance, a trained cross-encoder for reranking (benchmark quality vs latency), versioned catalogue updates, multi-currency quote service, explainability, and per-tenant monitoring + segment-level A/B conversion.

## AI assistance and human verification

AI assisted with typed NestJS parsing/retrieval implementation, local offline ranking, evaluation plumbing and drafting notes. I selected the separation of hard vs soft constraints, chose fail-closed quotes and strict tenant prefiltering, grounded sample relevance judgments in the actual Hearthly catalogue, reviewed date/currency decisions and tested representative parser, budget, privacy and live-inventory paths. Open questions and approximations are called out above, rather than representing them as product decisions or claiming unobserved benchmark numbers.
