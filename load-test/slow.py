#!/usr/bin/env python3
"""Reads PostgreSQL's log with auto_explain on, and prints each kind of slow query once, with its slowest plan."""
import re, sys

entries = re.split(r"(?m)^(?=\d{4}-\d\d-\d\d .*? LOG: )", sys.stdin.read())
worst = {}
for e in entries:
    m = re.search(r"duration: ([\d.]+) ms  plan:", e)
    if not m:
        continue
    text = re.sub(r"(?s)Query Parameters:.*?\n", "", e)
    q = re.search(r"Query Text: (.*)", text)
    key = re.sub(r"\s+", " ", q.group(1)) if q else e[:200]
    n, ms, _ = worst.get(key, (0, 0, ""))
    d = float(m.group(1))
    worst[key] = (n + 1, max(ms, d), text if d > ms else worst[key][2])
for key, (n, ms, text) in sorted(worst.items(), key=lambda kv: -kv[1][0] * kv[1][1])[:14]:
    print(f"\n=== {n} times, slowest {ms:.0f} ms")
    for line in text.splitlines()[1:40]:
        print(line[:260])
