#!/usr/bin/env python3
"""每日剪輯日報：跟上次推播比，把有變動的專案/集數推到 Telegram。

跑在 GitHub Actions cron（台北 23:38）。需要三個環境變數：
- SUPABASE_SERVICE_ROLE_KEY（繞過 RLS 讀全部專案 + 讀寫 summary_state）
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

舊版按「今天 = 台北日期」切，cron 跨午夜延遲就會算錯日。
新版改成跟 summary_state 表存的「上次推播當下的快照」比 diff，
不再依賴執行當下的時鐘。

訊息規則：
- 只列出「跟上次推播比有變動」的專案，整個沒動的專案不顯示
- 每個專案顯示：新增/修改場次、本集累積（+delta）、全劇累積（+delta）
- 全部沒動就推「自上次推播無變動 💤」
- 不管有沒有變動，每天都會推一則
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

TAIPEI = timezone(timedelta(hours=8))
SUPABASE_URL = "https://ntxqnvgpvshqwodagupt.supabase.co"
STATE_ID = "singleton"


def env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        print(f"[fatal] missing env: {name}", file=sys.stderr)
        sys.exit(1)
    return val


SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
BOT_TOKEN = env("TELEGRAM_BOT_TOKEN")
CHAT_ID = env("TELEGRAM_CHAT_ID")


def supabase_request(
    method: str,
    path: str,
    params: list[tuple[str, str]] | None = None,
    body: dict | list | None = None,
    extra_headers: dict | None = None,
) -> list[dict] | dict | None:
    qs = urllib.parse.urlencode(params) if params else ""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if qs:
        url += f"?{qs}"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        print(f"[supabase] HTTP {e.code} on {method} {path}: {body_text}", file=sys.stderr)
        raise


def supabase_get(path: str, params: list[tuple[str, str]]) -> list[dict]:
    return supabase_request("GET", path, params=params)  # type: ignore[return-value]


def fmt_secs(s: int | None) -> str:
    if not s:
        return "00:00"
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def fmt_delta_secs(delta: int) -> str:
    """正數加 +、負數加 -、0 不顯示括號內容（呼叫端決定要不要顯示）"""
    if delta == 0:
        return "0"
    sign = "+" if delta > 0 else "−"
    return f"{sign}{fmt_secs(abs(delta))}"


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


def load_state() -> tuple[datetime, dict]:
    """讀 summary_state；如果第一次跑（表存在但沒人寫過），用一個遠古時間 + 空 snapshot 起步。"""
    rows = supabase_get(
        "summary_state",
        [("id", f"eq.{STATE_ID}"), ("select", "last_push_at,snapshot")],
    )
    if not rows:
        # 沒料就插一筆初始的，下次再讀
        supabase_request(
            "POST",
            "summary_state",
            body={"id": STATE_ID},
            extra_headers={"Prefer": "return=minimal"},
        )
        return datetime(2000, 1, 1, tzinfo=timezone.utc), {}
    row = rows[0]
    last_push_at = datetime.fromisoformat(row["last_push_at"].replace("Z", "+00:00"))
    snapshot = row.get("snapshot") or {}
    return last_push_at, snapshot


def save_state(snapshot: dict) -> None:
    """更新 last_push_at = now()、snapshot 換成這次推播後的全貌。"""
    supabase_request(
        "PATCH",
        "summary_state",
        params=[("id", f"eq.{STATE_ID}")],
        body={
            "last_push_at": datetime.now(timezone.utc).isoformat(),
            "snapshot": snapshot,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        extra_headers={"Prefer": "return=minimal"},
    )


def fetch_all_scenes() -> list[dict]:
    """撈所有 scenes + 帶上 episode + project 資訊。一次撈完不分頁（規模還很小）。"""
    return supabase_get(
        "scenes",
        [
            (
                "select",
                "id,scene_key,roughcut_length_secs,pages,status,"
                "created_at,updated_at,episode_id,"
                "episodes(ep_key,project_id,projects(id,name,type))",
            ),
            ("order", "scene_key.asc"),
        ],
    )


def build_episode_totals(scenes: list[dict]) -> dict[str, dict]:
    """從所有 scenes 算每個 episode 的累積：總長、剪過幾場、共幾場。"""
    totals: dict[str, dict] = defaultdict(
        lambda: {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
    )
    for s in scenes:
        ep_id = s["episode_id"]
        t = totals[ep_id]
        t["total_scenes"] += 1
        if s.get("roughcut_length_secs"):
            t["cut_scenes"] += 1
            t["total_secs"] += int(s["roughcut_length_secs"])
    return dict(totals)


def main() -> None:
    last_push_at, prev_snapshot = load_state()
    last_push_iso = last_push_at.isoformat()
    prev_eps = (prev_snapshot or {}).get("episodes", {})

    all_scenes = fetch_all_scenes()
    curr_ep_totals = build_episode_totals(all_scenes)

    # 找出有變動的 episode：累積數字跟上次 snapshot 不同
    changed_ep_ids: set[str] = set()
    for ep_id, curr in curr_ep_totals.items():
        prev = prev_eps.get(ep_id) or {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
        if (
            curr["total_secs"] != prev.get("total_secs", 0)
            or curr["cut_scenes"] != prev.get("cut_scenes", 0)
            or curr["total_scenes"] != prev.get("total_scenes", 0)
        ):
            changed_ep_ids.add(ep_id)
    # 也要抓「上次有、這次完全消失」的 episode（被刪光）
    for ep_id in prev_eps:
        if ep_id not in curr_ep_totals:
            changed_ep_ids.add(ep_id)

    # 組訊息標題（用當下台北日期）
    now_taipei = datetime.now(TAIPEI)
    weekday_zh = "一二三四五六日"[now_taipei.weekday()]
    date_label = now_taipei.strftime("%m-%d") + f"（{weekday_zh}）"

    if not changed_ep_ids:
        text = f"📽 剪輯日報 {date_label}\n\n（自上次推播無變動）💤"
        telegram_send(text)
        # 即使無變動也更新 last_push_at（snapshot 沒變）
        save_state({"episodes": curr_ep_totals})
        print("[ok] no changes since last push; sent idle notice")
        return

    # 把變動的 scenes（updated_at > last_push_at）撈出來，分成新增/修改
    changed_scenes_by_ep: dict[str, dict] = defaultdict(
        lambda: {"new": [], "modified": [], "ep_meta": None}
    )
    for s in all_scenes:
        if s["episode_id"] not in changed_ep_ids:
            continue
        if s["updated_at"] <= last_push_iso:
            # 雖然這集有變動，但這場本身沒動（可能是同集其他場動了）
            # 還是要記 ep_meta 給後面組訊息用
            ep = s.get("episodes") or {}
            proj = ep.get("projects") or {}
            bucket = changed_scenes_by_ep[s["episode_id"]]
            if bucket["ep_meta"] is None:
                bucket["ep_meta"] = {
                    "ep_key": ep.get("ep_key", "?"),
                    "proj_id": proj.get("id"),
                    "proj_name": proj.get("name", "?"),
                    "proj_type": proj.get("type", "?"),
                }
            continue
        ep = s.get("episodes") or {}
        proj = ep.get("projects") or {}
        bucket = changed_scenes_by_ep[s["episode_id"]]
        if bucket["ep_meta"] is None:
            bucket["ep_meta"] = {
                "ep_key": ep.get("ep_key", "?"),
                "proj_id": proj.get("id"),
                "proj_name": proj.get("name", "?"),
                "proj_type": proj.get("type", "?"),
            }
        if s["created_at"] > last_push_iso:
            bucket["new"].append(s)
        else:
            bucket["modified"].append(s)

    # 算每個專案「現在的全劇累積」+「上次的全劇累積」
    # 先把 ep_id → proj_id 的對照表建起來（從變動的 ep + 全部 ep）
    ep_to_proj: dict[str, str] = {}
    proj_meta: dict[str, dict] = {}
    for s in all_scenes:
        ep = s.get("episodes") or {}
        proj = ep.get("projects") or {}
        proj_id = proj.get("id")
        if proj_id:
            ep_to_proj[s["episode_id"]] = proj_id
            if proj_id not in proj_meta:
                proj_meta[proj_id] = {
                    "name": proj.get("name", "?"),
                    "type": proj.get("type", "?"),
                }

    def proj_totals(ep_totals: dict[str, dict], proj_id: str) -> dict:
        out = {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
        for ep_id, t in ep_totals.items():
            if ep_to_proj.get(ep_id) == proj_id:
                out["total_secs"] += t.get("total_secs", 0)
                out["cut_scenes"] += t.get("cut_scenes", 0)
                out["total_scenes"] += t.get("total_scenes", 0)
        return out

    # 依專案分組要列的 episodes
    proj_to_eps: dict[str, list[str]] = defaultdict(list)
    for ep_id in changed_ep_ids:
        proj_id = ep_to_proj.get(ep_id)
        if proj_id:
            proj_to_eps[proj_id].append(ep_id)

    # 組訊息
    lines = [f"📽 剪輯日報 {date_label}", ""]
    grand_delta_secs = 0

    # 排序：依專案名 + ep_key
    sorted_projs = sorted(
        proj_to_eps.items(),
        key=lambda kv: proj_meta.get(kv[0], {}).get("name", ""),
    )

    displayed_projects = 0
    for proj_id, ep_ids in sorted_projs:
        pmeta = proj_meta.get(proj_id, {"name": "?", "type": "?"})
        # 過濾掉「還沒剪任何一場」的集數（cut_scenes=0），避免 0/N 場・00:00 雜訊
        ep_ids_sorted = sorted(
            [eid for eid in ep_ids if curr_ep_totals.get(eid, {}).get("cut_scenes", 0) > 0],
            key=lambda eid: (changed_scenes_by_ep[eid]["ep_meta"] or {}).get("ep_key", ""),
        )
        # 整個專案的變動全部都是「未開剪的新集數」就跳過，連標題都不印
        if not ep_ids_sorted:
            continue
        displayed_projects += 1

        for ep_id in ep_ids_sorted:
            bucket = changed_scenes_by_ep[ep_id]
            meta = bucket["ep_meta"] or {"ep_key": "?", "proj_name": pmeta["name"], "proj_type": pmeta["type"]}
            ep_key = meta["ep_key"]
            if pmeta["type"] == "film" or ep_key == "Scenes":
                label = f"《{pmeta['name']}》"
            else:
                label = f"《{pmeta['name']}》{ep_key}"
            lines.append(f"▎{label}")

            if bucket["new"]:
                keys = "、".join(s["scene_key"] for s in bucket["new"])
                lines.append(f"  ✚ 新增 {len(bucket['new'])} 場：{keys}")
            if bucket["modified"]:
                keys = "、".join(s["scene_key"] for s in bucket["modified"])
                lines.append(f"  ⟳ 修改 {len(bucket['modified'])} 場：{keys}")

            curr_t = curr_ep_totals.get(ep_id, {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0})
            prev_t = prev_eps.get(ep_id) or {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
            ep_delta = curr_t["total_secs"] - prev_t.get("total_secs", 0)
            delta_str = f"（{fmt_delta_secs(ep_delta)}）" if ep_delta != 0 else ""
            lines.append(
                f"  本集 {curr_t['cut_scenes']}/{curr_t['total_scenes']} 場・"
                f"{fmt_secs(curr_t['total_secs'])}{delta_str}"
            )

        # 全劇累積（這個專案的所有 ep 加總，跟上次比）
        # 加一條空行做視覺分隔，避免黏在最後一集後面看起來像那一集的數字
        curr_proj = proj_totals(curr_ep_totals, proj_id)
        prev_proj = proj_totals(prev_eps, proj_id)
        proj_delta = curr_proj["total_secs"] - prev_proj["total_secs"]
        grand_delta_secs += proj_delta
        proj_delta_str = f"（{fmt_delta_secs(proj_delta)}）" if proj_delta != 0 else ""
        lines.append("")
        lines.append(
            f"🎬 全劇 {curr_proj['cut_scenes']}/{curr_proj['total_scenes']} 場・"
            f"{fmt_secs(curr_proj['total_secs'])}{proj_delta_str}"
        )
        lines.append("")

    # 過濾後沒專案能顯示（變動全是新增未剪集數），改走「無變動」訊息
    if displayed_projects == 0:
        text = f"📽 剪輯日報 {date_label}\n\n（自上次推播無變動）💤"
        telegram_send(text)
        save_state({"episodes": curr_ep_totals})
        print("[ok] all changes filtered out (no cut activity); sent idle notice")
        return

    # 總結那一行
    if grand_delta_secs != 0:
        lines.append(f"📊 自上次推播：{fmt_delta_secs(grand_delta_secs)} 初剪")
    else:
        lines.append("📊 自上次推播：場次有變動但總長未變")

    text = "\n".join(lines).rstrip()
    telegram_send(text)
    save_state({"episodes": curr_ep_totals})
    print(
        f"[ok] sent diff summary: {displayed_projects} projects displayed "
        f"({len(changed_ep_ids)} eps changed total), grand_delta={grand_delta_secs}s"
    )


if __name__ == "__main__":
    main()
