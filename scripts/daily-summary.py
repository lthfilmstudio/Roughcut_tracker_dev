#!/usr/bin/env python3
"""每日剪輯日報：撈指定日期有變動的場次，組訊息推到 Telegram。

跑在 GitHub Actions cron（台北 23:38）。需要三個環境變數：
- SUPABASE_SERVICE_ROLE_KEY（繞過 RLS 讀全部專案）
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

可選參數 / 環境變數：
- --date YYYY-MM-DD 或 SUMMARY_DATE 環境變數：指定要撈哪一天（台北日期）。
  預設用「現在的台北日期」，但過午夜手動補跑就會錯位，這時用 --date 補昨天。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
SUPABASE_URL = "https://ntxqnvgpvshqwodagupt.supabase.co"


def env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"[fatal] missing env: {name}", file=sys.stderr)
        sys.exit(1)
    return val


SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
BOT_TOKEN = env("TELEGRAM_BOT_TOKEN")
CHAT_ID = env("TELEGRAM_CHAT_ID")


def supabase_get(path: str, params: list[tuple[str, str]]) -> list[dict]:
    qs = urllib.parse.urlencode(params)
    url = f"{SUPABASE_URL}/rest/v1/{path}?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[supabase] HTTP {e.code} on {path}: {body}", file=sys.stderr)
        raise


def fmt_secs(s: int | None) -> str:
    if not s:
        return "00:00"
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def fmt_pages(p) -> str:
    if p is None:
        return "0"
    return f"{float(p):g}"


def telegram_send(text: str) -> None:
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    body = urllib.parse.urlencode(
        {
            "chat_id": CHAT_ID,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": "true",
        }
    ).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
        if not result.get("ok"):
            print(f"[telegram] send failed: {result}", file=sys.stderr)
            sys.exit(1)


def resolve_target_date() -> date:
    """決定要撈哪一天（台北日期）。優先序：CLI --date > SUMMARY_DATE env > 現在的台北日期。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="台北日期 YYYY-MM-DD，預設今天")
    args = parser.parse_args()
    raw = args.date or os.environ.get("SUMMARY_DATE", "").strip() or None
    if raw:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    return datetime.now(TAIPEI).date()


def main() -> None:
    target = resolve_target_date()
    today_start = datetime.combine(target, datetime.min.time(), tzinfo=TAIPEI)
    tomorrow_start = today_start + timedelta(days=1)
    today_iso = today_start.isoformat()
    tomorrow_iso = tomorrow_start.isoformat()
    weekday_zh = "一二三四五六日"[today_start.weekday()]
    date_label = today_start.strftime("%m-%d") + f"（{weekday_zh}）"

    scenes_today = supabase_get(
        "scenes",
        [
            ("updated_at", f"gte.{today_iso}"),
            ("updated_at", f"lt.{tomorrow_iso}"),
            (
                "select",
                "id,scene_key,roughcut_length_secs,pages,status,created_at,updated_at,episode_id,"
                "episodes(ep_key,project_id,projects(id,name,type))",
            ),
            ("order", "scene_key.asc"),
        ],
    )

    if not scenes_today:
        text = f"📽 剪輯日報 {date_label}\n\n今日無更新 💤"
        telegram_send(text)
        print(f"[ok] no updates today; sent idle notice")
        return

    # 累計用：每個被影響的 episode 撈全部場次
    affected_eps = {s["episode_id"] for s in scenes_today}
    ep_totals: dict[str, dict] = {}
    for ep_id in affected_eps:
        all_scenes = supabase_get(
            "scenes",
            [
                ("episode_id", f"eq.{ep_id}"),
                ("select", "roughcut_length_secs,pages"),
            ],
        )
        ep_totals[ep_id] = {
            "total_scenes": len(all_scenes),
            "cut_scenes": sum(1 for s in all_scenes if s.get("roughcut_length_secs")),
            "total_secs": sum(s.get("roughcut_length_secs") or 0 for s in all_scenes),
        }

    # 依 episode 分組
    by_ep: dict[str, dict] = defaultdict(
        lambda: {"new": [], "modified": [], "ep_meta": None}
    )
    for s in scenes_today:
        ep_id = s["episode_id"]
        bucket = by_ep[ep_id]
        if bucket["ep_meta"] is None:
            ep = s.get("episodes") or {}
            proj = ep.get("projects") or {}
            bucket["ep_meta"] = {
                "ep_key": ep.get("ep_key", "?"),
                "proj_name": proj.get("name", "?"),
                "proj_type": proj.get("type", "?"),
            }
        if s["created_at"] >= today_iso:
            bucket["new"].append(s)
        else:
            bucket["modified"].append(s)

    # 組訊息
    lines = [f"📽 剪輯日報 {date_label}", ""]
    grand_new = 0
    grand_mod = 0
    grand_secs = 0
    grand_pages = 0.0

    # 排序：依專案名 + ep_key
    def sort_key(item):
        meta = item[1]["ep_meta"]
        return (meta["proj_name"], meta["ep_key"])

    for ep_id, bucket in sorted(by_ep.items(), key=sort_key):
        meta = bucket["ep_meta"]
        ep_key = meta["ep_key"]
        if meta["proj_type"] == "film" or ep_key == "Scenes":
            label = f"《{meta['proj_name']}》"
        else:
            label = f"《{meta['proj_name']}》{ep_key}"
        lines.append(f"▎{label}")

        if bucket["new"]:
            keys = "、".join(s["scene_key"] for s in bucket["new"])
            lines.append(f"  ✚ 新增 {len(bucket['new'])} 場：{keys}")
            grand_new += len(bucket["new"])
        if bucket["modified"]:
            keys = "、".join(s["scene_key"] for s in bucket["modified"])
            lines.append(f"  ⟳ 修改 {len(bucket['modified'])} 場：{keys}")
            grand_mod += len(bucket["modified"])

        # 今日新增數據（只算 new，避免重複算 modified）
        today_secs = sum(
            s.get("roughcut_length_secs") or 0 for s in bucket["new"]
        )
        today_pages = sum(float(s["pages"]) for s in bucket["new"] if s.get("pages"))
        if bucket["new"]:
            lines.append(
                f"  +{fmt_secs(today_secs)} / +{fmt_pages(today_pages)} 頁"
            )
        grand_secs += today_secs
        grand_pages += today_pages

        tot = ep_totals[ep_id]
        lines.append(
            f"  累計 {tot['cut_scenes']}/{tot['total_scenes']} 場・{fmt_secs(tot['total_secs'])}"
        )
        lines.append("")

    lines.append(
        f"📊 今日合計：{grand_new} 新增・{grand_mod} 修改・{fmt_secs(grand_secs)}・{fmt_pages(grand_pages)} 頁"
    )

    text = "\n".join(lines).rstrip()
    telegram_send(text)
    print(f"[ok] sent summary: {grand_new} new, {grand_mod} modified across {len(by_ep)} episodes")


if __name__ == "__main__":
    main()
