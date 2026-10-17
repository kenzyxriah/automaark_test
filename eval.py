#!/usr/bin/env python3
"""Compare original word-match and hybrid search against the same 20 judged requests and live inventory."""
import json
import math
import os
import statistics
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
SEARCH = os.environ["SEARCH_URL"].rstrip("/")
BASELINE = os.getenv("BASELINE_URL", "").rstrip("/")
INVENTORY = os.getenv("INVENTORY_URL", "http://localhost:4010").rstrip("/")
CATALOG = {v["id"]: v for v in json.loads((ROOT / "data/listings.json").read_text())}
PLACES = {v["id"]: v for v in json.loads((ROOT / "data/places.json").read_text())}


def get_json(url, data=None, headers=None):
    payload = json.dumps(data).encode() if data is not None else None
    req = Request(url, data=payload, headers=headers or {}, method="POST" if payload else "GET")
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def distance_miles(a, b):
    rad = math.pi / 180
    dlat, dlon = (b["lat"] - a["lat"]) * rad, (b["lng"] - a["lng"]) * rad
    x = math.sin(dlat / 2)**2 + math.cos(a["lat"] * rad) * math.cos(b["lat"] * rad) * math.sin(dlon / 2)**2
    return 3958.8 * 2 * math.atan2(math.sqrt(x), math.sqrt(max(0, 1 - x)))


def obeys_structure(listing, parsed, tenant):
    if listing["visibility"] not in ("public", f"private:{tenant}"):
        return False
    if parsed.get("guests") is not None and listing["sleeps"] < parsed["guests"]:
        return False
    if parsed.get("bedrooms") is not None and listing["bedrooms"] < parsed["bedrooms"]:
        return False
    if parsed.get("pets") and not listing["pets_allowed"]:
        return False
    if parsed.get("place_ids"):
        if parsed.get("radius_miles") is not None and parsed.get("place"):
            center = next((p for p in PLACES.values() if p["name"] == parsed["place"]), None)
            if center and distance_miles(center, listing) > parsed["radius_miles"] + 0.01:
                return False
        elif listing["place_id"] not in parsed["place_ids"]:
            return False
    if parsed.get("budget") is not None and parsed.get("budget_currency") and listing["currency"] != parsed["budget_currency"]:
        return False
    return True


def live_quotes(ids, parsed):
    answer = {}
    for i in range(0, len(ids), 50):
        query = urlencode({
            "ids": ",".join(ids[i:i+50]),
            "check_in": parsed["check_in"],
            "check_out": parsed["check_out"],
        })
        for result in get_json(f"{INVENTORY}/v1/availability?{query}")["results"]:
            answer[result["listing_id"]] = result
    return answer


def eligible(listing, quote, parsed):
    if not quote or not quote["available"] or quote["currency"] != listing["currency"]:
        return False
    if parsed.get("budget") is not None:
        value = quote["total"] if parsed.get("budget_basis") == "total" else quote["nightly_avg"]
        if value is None or value > parsed["budget"]:
            return False
    return True


def ndcg(ids, grades):
    def dcg(values):
        return sum((2 ** grade - 1) / math.log2(rank + 2) for rank, grade in enumerate(values))
    ideal = dcg(sorted(grades.values(), reverse=True)[:10])
    return dcg([grades.get(key, 0) for key in ids[:10]]) / ideal if ideal else 1.0


def run_search(url, case):
    start = time.perf_counter()
    result = get_json(f"{url}/v1/search", {"q": case["q"], "limit": 10}, {
        "content-type": "application/json", "x-tenant": case["tenant"], "x-now": case["now"]
    })
    return result, (time.perf_counter() - start) * 1000


class Measurements:
    def __init__(self, label):
        self.label = label
        self.recalls = []
        self.ndcgs = []
        self.latencies = []
        self.hard_pass = 0
        self.hard_total = 0
        self.live_pass = 0
        self.live_total = 0
        self.tenant_leaks = 0
        self.zero_pass = 0
        self.errors = 0

    def record(self, case, response, latency, parsed, reference, grades):
        output = response["results"]
        ids = [item["listing_id"] for item in output]
        if len(ids) > 10 or len(ids) != len(set(ids)):
            self.errors += 1
        self.latencies.append(latency)
        self.recalls.append(len(set(ids) & grades.keys()) / len(grades) if grades else 1.0)
        self.ndcgs.append(ndcg(ids, grades))
        if case.get("expect_empty"):
            self.zero_pass += int(not ids)
        for item in output:
            self.hard_total += 1
            listing = CATALOG.get(item["listing_id"])
            quote = reference.get(item["listing_id"])
            if listing and listing["visibility"] not in ("public", f"private:{case['tenant']}"):
                self.tenant_leaks += 1
            if listing and obeys_structure(listing, parsed, case["tenant"]) and eligible(listing, quote, parsed):
                self.hard_pass += 1
            self.live_total += 1
            if quote and all((
                item["currency"] == quote["currency"],
                item["total"] == quote["total"],
                item["nightly_avg"] == quote["nightly_avg"],
            )):
                self.live_pass += 1
        return len(ids)

    def summary(self):
        latencies = sorted(self.latencies)
        p95 = latencies[math.ceil(len(latencies) * 0.95) - 1] if latencies else 0
        recall = statistics.mean(self.recalls) if self.recalls else 0
        ranking = statistics.mean(self.ndcgs) if self.ndcgs else 0
        zero = self.zero_pass
        print(f"\n--- {self.label} ---")
        print(f"completed={len(latencies)} errors={self.errors} mean_recall@10={recall:.3f} mean_ndcg@10={ranking:.3f}")
        print(f"hard_constraint_pass={self.hard_pass}/{self.hard_total} live_quote_match={self.live_pass}/{self.live_total} unauthorized_private_stays={self.tenant_leaks} impossible_query_empty={zero}/1")
        print(f"p50_latency_ms={statistics.median(latencies) if latencies else 0:.1f} p95_latency_ms={p95:.1f} under_300ms={sum(x < 300 for x in latencies)}/{len(latencies)}")
        return {"recall": recall, "ndcg": ranking, "hard_pass": self.hard_pass,
                "hard_total": self.hard_total, "live_pass": self.live_pass,
                "live_total": self.live_total, "p95": p95}


def main():
    cases = [json.loads(line) for line in (ROOT / "eval/queries.jsonl").read_text().splitlines() if line.strip()]
    assert len(cases) == 20, f"Expected 20 queries, found {len(cases)}"
    before = Measurements("BEFORE: original word-match (initial commit be0a955)")
    after = Measurements("AFTER: hybrid search + live inventory")

    for case in cases:
        try:
            new, new_latency = run_search(SEARCH, case)
            old, old_latency = run_search(BASELINE, case) if BASELINE else (None, 0)
            # Both are assessed against the hybrid parser's disclosed intent, NOT the
            # original's unstructured 'words' output. This ensures the same hard rules.
            parsed = new["understood"]
            all_ids = set(case["judgments"]) | {x["listing_id"] for x in new["results"]}
            if old:
                all_ids.update(x["listing_id"] for x in old["results"])
            reference = live_quotes(sorted(all_ids), parsed) if all_ids else {}
            grades = {
                lid: grade for lid, grade in case["judgments"].items()
                if lid in CATALOG and obeys_structure(CATALOG[lid], parsed, case["tenant"])
                and eligible(CATALOG[lid], reference.get(lid), parsed)
            }
            new_count = after.record(case, new, new_latency, parsed, reference, grades)
            if old:
                old_count = before.record(case, old, old_latency, parsed, reference, grades)
                print(f"{case['id']:<31} BEFORE R@10={before.recalls[-1]:.2f} nDCG={before.ndcgs[-1]:.2f} n={old_count:2} | AFTER R@10={after.recalls[-1]:.2f} nDCG={after.ndcgs[-1]:.2f} n={new_count:2}")
            else:
                print(f"{case['id']:<31} R@10={after.recalls[-1]:.2f} nDCG@10={after.ndcgs[-1]:.2f} results={new_count:2} latency={new_latency:.0f}ms")
        except Exception as exc:
            after.errors += 1
            if BASELINE:
                before.errors += 1
            print(f"{case['id']:<31} ERROR {type(exc).__name__}: {exc}")

    print("\n--- SAME 20 QUERIES, SAME LABELS, SAME LIVE INVENTORY ---")
    if BASELINE:
        b = before.summary()
    a = after.summary()
    if BASELINE:
        print(f"\nDELTA recall@10={a['recall'] - b['recall']:+.3f} nDCG@10={a['ndcg'] - b['ndcg']:+.3f} "
              f"(p95 cost={a['p95'] - b['p95']:+.1f}ms).")
        print("Caveat: baseline serves stale prices without checking live inventory, so its faster latency is not equivalent work.")


if __name__ == "__main__":
    main()
