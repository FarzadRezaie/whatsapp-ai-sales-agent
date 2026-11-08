import { describe, expect, it } from 'vitest'
import { currentUsageMonth, isOverMonthlyCap } from './monthly-usage'

describe('currentUsageMonth', () => {
  it('uses the UTC month', () => {
    expect(currentUsageMonth(new Date('2026-11-30T23:30:00Z'))).toBe('2026-11-01')
    // 1 Dec 02:00 in Kabul is still 30 Nov in UTC.
    expect(currentUsageMonth(new Date('2026-11-30T21:30:00Z'))).toBe('2026-11-01')
    expect(currentUsageMonth(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12-01')
  })
})

describe('isOverMonthlyCap', () => {
  const usage = (total: number) => ({ month: '2026-11-01', botMessages: total, agentMessages: 0, total })
  it('is false with no cap or unknown usage', () => {
    expect(isOverMonthlyCap(null, usage(5000))).toBe(false)
    expect(isOverMonthlyCap(undefined, usage(5000))).toBe(false)
    expect(isOverMonthlyCap(100, null)).toBe(false)
  })
  it('is true at or above the cap', () => {
    expect(isOverMonthlyCap(1000, usage(999))).toBe(false)
    expect(isOverMonthlyCap(1000, usage(1000))).toBe(true)
    expect(isOverMonthlyCap(1000, usage(1500))).toBe(true)
  })
})
