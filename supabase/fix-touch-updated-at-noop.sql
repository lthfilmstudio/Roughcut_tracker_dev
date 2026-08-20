-- 修：touch_updated_at() 原本不管資料有沒有真的變都會蓋 updated_at（2026-08-21）
--
-- 症狀：EpisodeDetail / useEpisodesCache 只要「一集裡有一場」格式跟資料庫
-- 存的不一樣（例如 2026-08-17 commit 4ab0ee8 改了時長補零規則），就會把
-- 整集場次一次 upsert 回去；因為 trigger 不分青紅皂白蓋 updated_at，導致
-- 整集甚至整個專案的場次全部被戳成「剛改過」，隔天 Telegram 日報就把它們
-- 全部誤判成「已調整」。
--
-- 已在 production（ntxqnvgpvshqwodagupt）用 apply_migration 套用過，
-- 這份檔案只是把 schema.sql 的定義同步、留紀錄。

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  if new is distinct from old then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
