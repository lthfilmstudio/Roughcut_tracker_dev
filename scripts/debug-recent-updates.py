#!/usr/bin/env python3
"""一次性診斷：列出最近 7 天 4 張主要表的 updated_at 分布。
不送 Telegram，純印 stdout 給 Actions log 看。
完事就刪。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
SUPABASE_URL = "https://ntxqnvgpvshqwodagupt.supabase.co"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TABLES = [
    ("projects", "id"),
    ("episodes", "id"),
    ("scenes", "id"),
    ("episode_meta", "episode_id,key"),
]


def fetch(path: str, params: list[tuple[str, str]]) -> list[dict]:
    qs = urllib.parse.urlencode(params)
    url = f"{SUPABASE_URL}/rest/v1/{path}?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


now = datetime.now(TAIPEI)
today = now.date()
days = [today - timedelta(days=d) for d in range(7)]

print(f"=== now (Taipei): {now.isoformat()} ===\n")

for tbl, id_cols in TABLES:
    print(f"## {tbl}")
    start = datetime.combine(today - timedelta(days=6), datetime.min.time(), tzinfo=TAIPEI)
    end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=TAIPEI)
    rows = fetch(
        tbl,
        [
            ("updated_at", f"gte.{start.isoformat()}"),
            ("updated_at", f"lt.{end.isoformat()}"),
            ("select", f"{id_cols},updated_at"),
            ("order", "updated_at.desc"),
            ("limit", "500"),
        ],
    )
    by_day: dict[str, int] = defaultdict(int)
    for r in rows:
        ts = datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))
        d = ts.astimezone(TAIPEI).date().isoformat()
        by_day[d] += 1
    print(f"  total rows in last 7 days: {len(rows)}")
    for d in sorted(by_day.keys(), reverse=True):
        print(f"    {d}: {by_day[d]}")
    if rows:
        print(f"  latest 3 updated_at (UTC):")
        for r in rows[:3]:
            id_disp = "+".join(str(r.get(c, "")) for c in id_cols.split(","))
            print(f"    {r['updated_at']}  {id_disp}")
    print()
