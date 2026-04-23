# Supabase 遷移 PoC

這個資料夾是把 Roughcut Tracker 從 Google Sheet 搬到 Supabase 的起點。

## 檔案

- `schema.sql` — 建立資料表、權限、索引的 SQL 腳本
- `README.md` — 你現在讀的這份

## 怎麼用

### 1. 建 Supabase 專案
1. 到 [supabase.com](https://supabase.com) 用 Google 登入
2. 點「New project」
3. 區域選 **Northeast Asia (Tokyo)**（離台灣最近）
4. 設定 Database password（記下來，之後不太會用到）
5. 等專案 provision 完成（約 1–2 分鐘）

### 2. 跑 schema
1. 進專案 → 左側選單 → **SQL Editor**
2. 貼上 `schema.sql` 全部內容
3. 點右下「Run」
4. 應該會看到「Success. No rows returned」

### 3. 驗證結構
- 左側選單 → **Table Editor**
- 應該看到 6 張表：`projects`、`episodes`、`scenes`、`episode_meta`、`project_members`、`super_admins`
- 點任一張表可以直接看內容（現在都是空的）

### 4. 開啟 Google 登入
1. 左側選單 → **Authentication** → **Providers**
2. 找到「Google」→ 開啟
3. 按指示去 Google Cloud Console 建 OAuth credentials
4. 把 Client ID / Secret 貼回 Supabase

### 5. 新增第一個 super_admin
這步要在自己先登入一次後做：
1. 用 Google 登入（會自動在 `auth.users` 產生一筆）
2. 回 SQL Editor 跑：
   ```sql
   insert into super_admins (user_id)
   select id from auth.users where email = 'lthfilmstudio@gmail.com';
   ```

## 這份 schema 做了 / 沒做什麼

### 做了
- 6 張表完整定義
- RLS（Row Level Security）第一版：super_admin 全權、成員只看自己的專案、editor 可寫 scenes
- 索引（查詢不會卡）
- updated_at 自動更新

### 還沒做
- **資料遷移**：把 Google Sheet 現有資料倒進來（要寫 Node 腳本）
- **前端改造**：`src/services/` 下要新增 `supabaseService.ts` 實作 `DataService` interface
- **細緻權限**：RLS 目前是骨架，實際跑起來可能還要調整
- **Auth 前端**：登入流程要從 Google OAuth gapi 改成 Supabase Auth

## 關鍵設計決定

| 決定 | 原因 |
|---|---|
| 總覽不存，即時算 | 避免「統計和實際不同步」的 bug |
| 長度存秒數整數 | 加總運算單純，`stats.ts` 現有的 `toSecs`/`fromSecs` 直接用 |
| 場次順序用 `row_order` 欄位 | 維持 9A 排在 9 後面的手調順序，不靠 scene_key 解析 |
| 拿掉應用密碼 | 改用 email 權限表，新增/移除使用者更乾淨 |

## 和現有 Google Sheet 的對照

| Google Sheet | Supabase |
|---|---|
| Meta Sheet → Projects 分頁 | `projects` 表 |
| 專案 Sheet 的 Tab 2~N | `episodes` 表 + `scenes` 表 |
| 專案 Sheet 的 `_meta` tab | `episode_meta` 表 |
| Google Drive 共用清單 | `project_members` 表 |
| Google OAuth（Gmail） | Supabase Auth（內建 Google 登入） |
| Tab 1 總覽 | ❌ 不存，即時從 `scenes` 算 |

## 下一步

由 Nalin 決定推進順序：
1. **建 Supabase 專案 + 跑 schema** — 1 小時內可完成，驗證結構無誤
2. **寫遷移腳本** — 把現有 Google Sheet 資料灌進 Supabase（一次性）
3. **寫 `SupabaseService`** — 新增一個實作，取代 `GoogleSheetsService`
4. **切換 auth** — 前端登入改用 Supabase Auth
5. **正式切換日** — 部署新版，通知使用者重新登入
