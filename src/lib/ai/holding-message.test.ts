import { describe, expect, it } from 'vitest'
import {
  containsArabicScript,
  DEFAULT_HOLDING_MESSAGE_DARI,
  DEFAULT_HOLDING_MESSAGE_EN,
  holdingMessageFor,
} from './holding-message'

describe('holdingMessageFor', () => {
  it("prefers the shop's own message", () => {
    expect(holdingMessageFor('  Wait a moment  ', 'سلام')).toBe('Wait a moment')
  })
  it('falls back to Dari for Arabic-script customers', () => {
    expect(holdingMessageFor(null, 'قیمتش چند است؟')).toBe(DEFAULT_HOLDING_MESSAGE_DARI)
  })
  it('falls back to English otherwise (incl. Dari typed in Latin letters)', () => {
    expect(holdingMessageFor('', 'chand ast?')).toBe(DEFAULT_HOLDING_MESSAGE_EN)
    expect(holdingMessageFor(undefined, '')).toBe(DEFAULT_HOLDING_MESSAGE_EN)
  })
})

describe('containsArabicScript', () => {
  it('detects Arabic-script letters only', () => {
    expect(containsArabicScript('hello سلام')).toBe(true)
    expect(containsArabicScript('hello 123')).toBe(false)
  })
})
