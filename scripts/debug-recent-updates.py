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

TABLES = ["projects", "episodes", "scenes", "episode_meta"]


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

for tbl in TABLES:
    print(f"## {tbl}")
    # 撈這張表最近 7 天每天的 count（用 updated_at）
    start = datetime.combine(today - timedelta(days=6), datetime.min.time(), tzinfo=TAIPEI)
    end = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=TAIPEI)
    rows = fetch(
        tbl,
        [
            ("updated_at", f"gte.{start.isoformat()}"),
            ("updated_at", f"lt.{end.isoformat()}"),
            ("select", "id,updated_at"),
            ("order", "updated_at.desc"),
            ("limit", "500"),
        ],
    )
    by_day: dict[str, int] = defaultdict(int)
    for r in rows:
        # Supabase 回 UTC 字串，轉台北日期
        ts = datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))
        d = ts.astimezone(TAIPEI).date().isoformat()
        by_day[d] += 1
    print(f"  total rows in last 7 days: {len(rows)}")
    for d in sorted(by_day.keys(), reverse=True):
        print(f"    {d}: {by_day[d]}")
    # 印最近 3 筆 raw updated_at
    if rows:
        print(f"  latest 3 updated_at (UTC):")
        for r in rows[:3]:
            print(f"    {r['updated_at']}  id={r['id']}")
    print()
