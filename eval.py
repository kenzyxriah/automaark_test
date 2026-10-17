#!/usr/bin/env python3
"""Live API evaluation: independently verify inventory, structural hard constraints and ranked relevance."""
import json
import math
import os
import statistics
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
BASE = os.environ['SEARCH_URL'].rstrip('/')
INVENTORY = os.getenv('INVENTORY_URL', 'http://localhost:4010').rstrip('/')
CATALOG = {v['id']: v for v in json.loads((ROOT / 'data/listings.json').read_text())}
PLACES = {v['id']: v for v in json.loads((ROOT / 'data/places.json').read_text())}


def get_json(url, data=None, headers=None):
    payload = json.dumps(data).encode() if data is not None else None
    req = Request(url, data=payload, headers=headers or {}, method='POST' if payload else 'GET')
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def distance_miles(a, b):
    rad = math.pi / 180
    dlat, dlon = (b['lat'] - a['lat']) * rad, (b['lng'] - a['lng']) * rad
    x = math.sin(dlat / 2)**2 + math.cos(a['lat'] * rad) * math.cos(b['lat'] * rad) * math.sin(dlon / 2)**2
    return 3958.8 * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def obeys_structure(listing, parsed, tenant):
    if listing['visibility'] not in ('public', f'private:{tenant}'):
        return False
    if parsed.get('guests') is not None and listing['sleeps'] < parsed['guests']:
        return False
    if parsed.get('bedrooms') is not None and listing['bedrooms'] < parsed['bedrooms']:
        return False
    if parsed.get('pets') and not listing['pets_allowed']:
        return False
    if parsed.get('place_ids'):
        if parsed.get('radius_miles') is not None and parsed.get('place'):
            center = next((p for p in PLACES.values() if p['name'] == parsed['place']), None)
            if center and distance_miles(center, listing) > parsed['radius_miles'] + 0.01:
                return False
        elif listing['place_id'] not in parsed['place_ids']:
            return False
    if parsed.get('budget') is not None and parsed.get('budget_currency') and listing['currency'] != parsed['budget_currency']:
        return False
    return True


def quotes(ids, parsed):
    answer = {}
    for i in range(0, len(ids), 50):
        query = urlencode({'ids': ','.join(ids[i:i+50]), 'check_in': parsed['check_in'], 'check_out': parsed['check_out']})
        for r in get_json(f'{INVENTORY}/v1/availability?{query}')['results']:
            answer[r['listing_id']] = r
    return answer


def available_and_affordable(listing, quote, parsed):
    if not quote or not quote['available'] or quote['currency'] != listing['currency']:
        return False
    if parsed.get('budget') is not None:
        amount = quote['total'] if parsed.get('budget_basis') == 'total' else quote['nightly_avg']
        if amount is None or amount > parsed['budget']:
            return False
    return True


def ndcg(actual, grades):
    def dcg(items):
        return sum((2**grade - 1) / math.log2(rank + 2) for rank, grade in enumerate(items))
    ideal = dcg(sorted(grades.values(), reverse=True)[:10])
    return dcg([grades.get(x, 0) for x in actual[:10]]) / ideal if ideal else 1.0


def main():
    cases = [json.loads(line) for line in (ROOT / 'eval/queries.jsonl').read_text().splitlines() if line.strip()]
    assert len(cases) == 20, f'Expected 20 queries, found {len(cases)}'
    recalls, ndcgs, latencies = [], [], []
    hard_pass = 0
    hard_total = 0
    quote_pass = 0
    quote_total = 0
    zero_pass = 0
    errors = 0
    for case in cases:
        started = time.perf_counter()
        try:
            result = get_json(f'{BASE}/v1/search', {'q': case['q'], 'limit': 10},
                              {'content-type': 'application/json', 'x-tenant': case['tenant'], 'x-now': case['now']})
            latency = (time.perf_counter() - started) * 1000
            latencies.append(latency)
            parsed = result['understood']
            output = result['results']
            ids = [r['listing_id'] for r in output]
            if len(ids) != len(set(ids)) or len(ids) > 10:
                errors += 1
            relevant = list(case['judgments'])
            reference = quotes(list(set(ids + relevant)), parsed) if ids or relevant else {}
            valid_grades = {
                lid: grade for lid, grade in case['judgments'].items()
                if lid in CATALOG and obeys_structure(CATALOG[lid], parsed, case['tenant'])
                and available_and_affordable(CATALOG[lid], reference.get(lid), parsed)
            }
            for item in output:
                hard_total += 1
                listing = CATALOG.get(item['listing_id'])
                quote = reference.get(item['listing_id'])
                if listing and obeys_structure(listing, parsed, case['tenant']) and available_and_affordable(listing, quote, parsed):
                    hard_pass += 1
                quote_total += 1
                if quote and item['currency'] == quote['currency'] and item['total'] == quote['total'] and item['nightly_avg'] == quote['nightly_avg']:
                    quote_pass += 1
            recall = len(set(ids[:10]) & set(valid_grades)) / len(valid_grades) if valid_grades else 1.0
            rank_score = ndcg(ids, valid_grades)
            recalls.append(recall)
            ndcgs.append(rank_score)
            if case.get('expect_empty'):
                zero_pass += int(len(ids) == 0)
            print(f"{case['id']:<31} R@10={recall:.2f} nDCG@10={rank_score:.2f} results={len(ids):2} latency={latency:.0f}ms")
        except Exception as exc:
            errors += 1
            print(f"{case['id']:<31} ERROR {type(exc).__name__}: {exc}")
    latencies.sort()
    p95 = latencies[math.ceil(0.95 * len(latencies)) - 1] if latencies else 0
    print('\n--- SUMMARY (independent live inventory checks) ---')
    print(f"queries={len(cases)} completed={len(latencies)} errors={errors}")
    print(f"mean_recall@10={statistics.mean(recalls) if recalls else 0:.3f} mean_ndcg@10={statistics.mean(ndcgs) if ndcgs else 0:.3f}")
    print(f"hard_constraint_pass={hard_pass}/{hard_total} live_quote_match={quote_pass}/{quote_total} impossible_query_empty={zero_pass}/1")
    print(f"p50_latency_ms={statistics.median(latencies) if latencies else 0:.1f} p95_latency_ms={p95:.1f} under_300ms={sum(x < 300 for x in latencies)}/{len(latencies)}")


if __name__ == '__main__':
    main()
