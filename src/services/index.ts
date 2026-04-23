import type { DataService } from './dataService'
import { GoogleSheetsService } from './googleSheetsService'
import { SupabaseService } from './supabaseService'
import { hasSupabaseConfig } from './supabaseClient'

const META_SHEET_ID = import.meta.env.VITE_META_SHEET_ID ?? ''
const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === 'true'

/**
 * 取得 DataService 實作。
 *
 * - 預設走 GoogleSheetsService（相容既有流程）
 * - 設定 VITE_USE_SUPABASE=true 時走 SupabaseService
 *
 * token 參數：
 *   - GoogleSheetsService 會使用（Google OAuth access token）
 *   - SupabaseService 無視（它透過 supabase-js 自己管 session）
 */
export function getDataService(token: string): DataService {
  if (USE_SUPABASE && hasSupabaseConfig()) {
    return new SupabaseService()
  }
  return new GoogleSheetsService(token, META_SHEET_ID)
}

export type { DataService } from './dataService'
