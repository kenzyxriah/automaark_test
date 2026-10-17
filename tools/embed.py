"""The offline embedding in tools/embed.mjs, in Python (same concepts, same numbers).

    from tools.embed import embed
    embed("cosy log cabin with a hot tub")  # 24 floats
"""
import json
import math
import os
import re

with open(os.path.join(os.path.dirname(__file__), "concepts.json"), encoding="utf-8") as f:
    CONCEPTS = json.load(f)
KEYS = list(CONCEPTS)
WORD = {}
for i, k in enumerate(KEYS):
    for w in CONCEPTS[k]:
        WORD.setdefault(w, []).append(i)


def embed(text):
    v = [0.0] * len(KEYS)
    for w in re.split(r"[^a-z0-9-]+", str(text).lower()):
        for i in WORD.get(w) or WORD.get(re.sub(r"s$", "", w)) or []:
            v[i] += 1
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [round(x / norm, 4) for x in v]
