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
import re
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


def fmt_ep_short(ep_key: str) -> str:
    """ep05 → 5、ep10 → 10、Scenes → Scenes（film fallback）"""
    if not ep_key.startswith("ep"):
        return ep_key
    try:
        return str(int(ep_key[2:]))
    except ValueError:
        return ep_key


_SCENE_NUM_RE = re.compile(r"^(\d+)(.*)$")


def fmt_scene_key(scene_key: str) -> str:
    """場次數字部分補零到 2 位；字母尾保留：8 → 08、28ins → 28ins、9A → 09A"""
    m = _SCENE_NUM_RE.match(scene_key)
    if not m:
        return scene_key
    return f"{m.group(1).zfill(2)}{m.group(2)}"


def fmt_scene_full(ep_key: str, scene_key: str, proj_type: str) -> str:
    """series：「{ep_short}-{scene_key_padded}」；film：「{scene_key_padded}」"""
    sk = fmt_scene_key(scene_key)
    if proj_type == "film" or ep_key == "Scenes":
        return sk
    return f"{fmt_ep_short(ep_key)}-{sk}"


def scene_sort_key(full_key: str) -> tuple:
    """排序：先 ep number、再 scene number、再字母尾"""
    if "-" in full_key:
        ep_part, scene_part = full_key.split("-", 1)
    else:
        ep_part, scene_part = "", full_key
    try:
        ep_num = int(ep_part) if ep_part else 0
    except ValueError:
        ep_num = 0
    m = _SCENE_NUM_RE.match(scene_part)
    if m:
        return (ep_num, int(m.group(1)), m.group(2))
    return (ep_num, 0, scene_part)


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


def load_state() -> tuple[datetime, dict, dict]:
    """讀 summary_state。回傳 (last_push_at, prev_eps, prev_scenes)。
    第一次跑（表存在但沒人寫過）→ 遠古時間 + 兩個空 dict。
    舊版 snapshot 沒 scenes 欄位 → prev_scenes 為 {}，第一次 schema 升級不會爆量
    （因為 is_just_cut / is_adjusted 都另有 updated_at > last_push_iso 守門）。
    """
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
        return datetime(2000, 1, 1, tzinfo=timezone.utc), {}, {}
    row = rows[0]
    last_push_at = datetime.fromisoformat(row["last_push_at"].replace("Z", "+00:00"))
    snapshot = row.get("snapshot") or {}
    return last_push_at, snapshot.get("episodes", {}) or {}, snapshot.get("scenes", {}) or {}


def with_latest_message(snapshot: dict, text: str, sent_at_iso: str) -> dict:
    """把最新 Telegram 推播文字也留在 snapshot 裡，給私人入口網站讀。"""
    return {
        **snapshot,
        "latest_message": {
            "text": text,
            "sent_at": sent_at_iso,
        },
    }


def save_state(snapshot: dict, text: str) -> None:
    """更新 last_push_at = now()、snapshot 換成這次推播後的全貌。"""
    now_iso = datetime.now(timezone.utc).isoformat()
    supabase_request(
        "PATCH",
        "summary_state",
        params=[("id", f"eq.{STATE_ID}")],
        body={
            "last_push_at": now_iso,
            "snapshot": with_latest_message(snapshot, text, now_iso),
            "updated_at": now_iso,
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
    last_push_at, prev_eps, prev_scenes = load_state()
    last_push_iso = last_push_at.isoformat()

    all_scenes = fetch_all_scenes()
    curr_ep_totals = build_episode_totals(all_scenes)

    # 把所有 scene 用 ep_id / proj_id 索引、建 meta map
    ep_to_proj: dict[str, str] = {}
    ep_meta_by_id: dict[str, dict] = {}
    proj_meta: dict[str, dict] = {}
    for s in all_scenes:
        ep = s.get("episodes") or {}
        proj = ep.get("projects") or {}
        proj_id = proj.get("id")
        if not proj_id:
            continue
        ep_to_proj[s["episode_id"]] = proj_id
        if s["episode_id"] not in ep_meta_by_id:
            ep_meta_by_id[s["episode_id"]] = {
                "ep_key": ep.get("ep_key", "?"),
                "proj_id": proj_id,
            }
        if proj_id not in proj_meta:
            proj_meta[proj_id] = {
                "name": proj.get("name", "?"),
                "type": proj.get("type", "?"),
            }

    # 三類分桶（per-project）
    new_by_proj: dict[str, list[str]] = defaultdict(list)        # 新增場號（推播後新建）
    cut_by_proj: dict[str, list[str]] = defaultdict(list)        # 已初剪（status: 非已初剪 → 已初剪）
    adjusted_by_proj: dict[str, list[str]] = defaultdict(list)   # 已調整（已是已初剪、長度/備註等變動）

    # 建這次的 scene snapshot（給下次跑當 prev_scenes）
    curr_scenes: dict[str, dict] = {}

    for s in all_scenes:
        ep = s.get("episodes") or {}
        proj = ep.get("projects") or {}
        proj_id = proj.get("id")
        if not proj_id:
            continue
        sid = s["id"]
        curr_status = s.get("status") or ""
        curr_scenes[sid] = {
            "status": curr_status,
            "secs": int(s.get("roughcut_length_secs") or 0),
        }

        prev = prev_scenes.get(sid)
        prev_status = (prev or {}).get("status") or ""
        full_key = fmt_scene_full(ep.get("ep_key", "?"), s.get("scene_key", "?"), proj.get("type", "?"))

        is_new = s.get("created_at", "") > last_push_iso
        # 「狀態變成已初剪」要排除新建（新建那筆走「新增場」），且必須有實際更新
        is_just_cut = (
            not is_new
            and s.get("updated_at", "") > last_push_iso
            and prev_status != "已初剪"
            and curr_status == "已初剪"
        )
        # 「已調整」= 已存在 + 推播後有變動 + 不是剛變成已初剪
        is_adjusted = (
            not is_new
            and not is_just_cut
            and s.get("updated_at", "") > last_push_iso
        )

        if is_new:
            new_by_proj[proj_id].append(full_key)
        elif is_just_cut:
            cut_by_proj[proj_id].append(full_key)
        elif is_adjusted:
            adjusted_by_proj[proj_id].append(full_key)

    def proj_totals(ep_totals: dict[str, dict], proj_id: str) -> dict:
        out = {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
        for ep_id, t in ep_totals.items():
            if ep_to_proj.get(ep_id) == proj_id:
                out["total_secs"] += t.get("total_secs", 0)
                out["cut_scenes"] += t.get("cut_scenes", 0)
                out["total_scenes"] += t.get("total_scenes", 0)
        return out

    # 找出有「ep 累積變動」的 ep（用來決定要列哪些集行）
    changed_ep_ids: set[str] = set()
    for ep_id, curr in curr_ep_totals.items():
        prev = prev_eps.get(ep_id) or {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
        if (
            curr["total_secs"] != prev.get("total_secs", 0)
            or curr["cut_scenes"] != prev.get("cut_scenes", 0)
            or curr["total_scenes"] != prev.get("total_scenes", 0)
        ):
            changed_ep_ids.add(ep_id)
    for ep_id in prev_eps:
        if ep_id not in curr_ep_totals:
            changed_ep_ids.add(ep_id)

    # 訊息標題
    now_taipei = datetime.now(TAIPEI)
    weekday_zh = "一二三四五六日"[now_taipei.weekday()]
    date_label = now_taipei.strftime("%m-%d") + f"（{weekday_zh}）"

    # 哪些專案要顯示：三類任一非空，或 ep 有累積變動且 cut_scenes>0
    proj_ids_with_changes: set[str] = set()
    proj_ids_with_changes.update(new_by_proj)
    proj_ids_with_changes.update(cut_by_proj)
    proj_ids_with_changes.update(adjusted_by_proj)
    for ep_id in changed_ep_ids:
        pid = ep_to_proj.get(ep_id)
        if pid and curr_ep_totals.get(ep_id, {}).get("cut_scenes", 0) > 0:
            proj_ids_with_changes.add(pid)

    # 完全沒任何變動 → idle 訊息
    if not proj_ids_with_changes:
        text = f"📽 剪輯日報 {date_label}\n\n（自上次推播無變動）💤"
        telegram_send(text)
        save_state({"episodes": curr_ep_totals, "scenes": curr_scenes}, text)
        print("[ok] no changes since last push; sent idle notice")
        return

    lines = [f"📽 剪輯日報 {date_label}", ""]
    grand_delta_secs = 0
    displayed_projects = 0

    sorted_proj_ids = sorted(
        proj_ids_with_changes,
        key=lambda pid: proj_meta.get(pid, {}).get("name", ""),
    )

    for proj_id in sorted_proj_ids:
        pmeta = proj_meta.get(proj_id, {"name": "?", "type": "?"})

        # 該專案要列的 ep（過濾未開剪 cut_scenes=0）
        eps_for_proj = sorted(
            [
                eid for eid in changed_ep_ids
                if ep_to_proj.get(eid) == proj_id
                and curr_ep_totals.get(eid, {}).get("cut_scenes", 0) > 0
            ],
            key=lambda eid: ep_meta_by_id.get(eid, {}).get("ep_key", ""),
        )

        new_keys = sorted(new_by_proj.get(proj_id, []), key=scene_sort_key)
        cut_keys = sorted(cut_by_proj.get(proj_id, []), key=scene_sort_key)
        adj_keys = sorted(adjusted_by_proj.get(proj_id, []), key=scene_sort_key)

        # 三類都空且無 ep 可列 → 跳過
        if not new_keys and not cut_keys and not adj_keys and not eps_for_proj:
            continue
        displayed_projects += 1

        # 專案標題（不含 ep_key）
        lines.append(f"▎《{pmeta['name']}》")

        # 三類場次列表
        if new_keys or cut_keys or adj_keys:
            lines.append("")
            if new_keys:
                lines.append(f"新增場：{'、'.join(new_keys)}")
            if cut_keys:
                lines.append(f"已初剪：{'、'.join(cut_keys)}")
            if adj_keys:
                lines.append(f"已調整：{'、'.join(adj_keys)}")

        # 集行（series 才列；film 直接跳全劇）
        if pmeta["type"] != "film" and eps_for_proj:
            lines.append("")
            for ep_id in eps_for_proj:
                ep_key = ep_meta_by_id.get(ep_id, {}).get("ep_key", "?")
                curr_t = curr_ep_totals.get(ep_id, {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0})
                prev_t = prev_eps.get(ep_id) or {"total_secs": 0, "cut_scenes": 0, "total_scenes": 0}
                ep_delta = curr_t["total_secs"] - prev_t.get("total_secs", 0)
                delta_str = f"（{fmt_delta_secs(ep_delta)}）" if ep_delta != 0 else ""
                lines.append(
                    f"{ep_key}：本集 {curr_t['cut_scenes']}/{curr_t['total_scenes']} 場・"
                    f"{fmt_secs(curr_t['total_secs'])}{delta_str}"
                )

        # 全劇行
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

    if displayed_projects == 0:
        text = f"📽 剪輯日報 {date_label}\n\n（自上次推播無變動）💤"
        telegram_send(text)
        save_state({"episodes": curr_ep_totals, "scenes": curr_scenes}, text)
        print("[ok] all changes filtered out (no cut activity); sent idle notice")
        return

    # 總結行（保留）
    if grand_delta_secs != 0:
        lines.append(f"📊 自上次推播：{fmt_delta_secs(grand_delta_secs)} 初剪")
    else:
        lines.append("📊 自上次推播：場次有變動但總長未變")

    text = "\n".join(lines).rstrip()
    telegram_send(text)
    save_state({"episodes": curr_ep_totals, "scenes": curr_scenes}, text)
    print(
        f"[ok] sent diff summary: {displayed_projects} projects "
        f"(new={sum(len(v) for v in new_by_proj.values())}, "
        f"cut={sum(len(v) for v in cut_by_proj.values())}, "
        f"adj={sum(len(v) for v in adjusted_by_proj.values())}), "
        f"grand_delta={grand_delta_secs}s"
    )


if __name__ == "__main__":
    main()
