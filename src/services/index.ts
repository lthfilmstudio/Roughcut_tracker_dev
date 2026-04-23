import type { DataService } from './dataService'
import { SupabaseService } from './supabaseService'

/**
 * 取得 DataService 實作。
 * Dev 站全面走 Supabase，token 參數保留相容既有呼叫但內部不使用。
 */
export function getDataService(_token?: string | null): DataService {
  return new SupabaseService()
}

export type { DataService } from './dataService'
