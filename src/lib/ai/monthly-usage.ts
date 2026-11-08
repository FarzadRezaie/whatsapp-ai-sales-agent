import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// This month's outbound message count (migration 063). Meta's free
// allowance and billing are per calendar month in UTC, so the month key
// is the first day of the current UTC month.
// ============================================================

export interface MonthlyUsage {
  /** 'YYYY-MM-01' (UTC). */
  month: string
  botMessages: number
  agentMessages: number
  total: number
}

/** First day of the current UTC month as 'YYYY-MM-01'. */
export function currentUsageMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/**
 * Read the account's counters for the current month. Never throws:
 * on any error it returns null so the caller can decide (the bot treats
 * "unknown" as "not over the cap" — a DB hiccup must not silence it).
 */
export async function loadMonthlyUsage(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<MonthlyUsage | null> {
  const month = currentUsageMonth(now)
  try {
    const { data, error } = await db
      .from('account_message_usage')
      .select('bot_messages, agent_messages')
      .eq('account_id', accountId)
      .eq('month', month)
      .maybeSingle()
    if (error) {
      console.error('[monthly usage] load failed:', error.message)
      return null
    }
    const bot = Number(data?.bot_messages ?? 0)
    const agent = Number(data?.agent_messages ?? 0)
    return { month, botMessages: bot, agentMessages: agent, total: bot + agent }
  } catch (err) {
    console.error('[monthly usage] load threw:', err)
    return null
  }
}

/** True when a cap is set and this month's total has reached it. */
export function isOverMonthlyCap(
  cap: number | null | undefined,
  usage: MonthlyUsage | null,
): boolean {
  if (!cap || cap <= 0 || !usage) return false
  return usage.total >= cap
}
