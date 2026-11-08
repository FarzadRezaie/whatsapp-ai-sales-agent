import { describe, expect, it } from 'vitest'
import { isValidImagePath, parseList, parsePrice, validateProductInput } from './validate'

const ACC = '11111111-2222-3333-4444-555555555555'

describe('parsePrice', () => {
  it('accepts numbers, grouped strings and Persian / Arabic-Indic digits', () => {
    expect(parsePrice(1200)).toBe(1200)
    expect(parsePrice('1,200')).toBe(1200)
    expect(parsePrice(' 2 500 ')).toBe(2500)
    expect(parsePrice('۱۲۰۰')).toBe(1200)
    expect(parsePrice('٣٥٠٠')).toBe(3500)
    expect(parsePrice('99.5')).toBe(99.5)
  })
  it('rejects negatives, text and absurd values', () => {
    expect(parsePrice(-1)).toBeNull()
    expect(parsePrice('abc')).toBeNull()
    expect(parsePrice('12a')).toBeNull()
    expect(parsePrice('1.234')).toBeNull()
    expect(parsePrice(1e12)).toBeNull()
    expect(parsePrice(null)).toBeNull()
  })
})

describe('parseList', () => {
  it('splits on commas, Persian commas and newlines, trims and de-dupes', () => {
    expect(parseList('S, M ,L، XL\nM')).toEqual(['S', 'M', 'L', 'XL'])
    expect(parseList(['Red', 'red', ' Blue '])).toEqual(['Red', 'Blue'])
    expect(parseList('')).toEqual([])
    expect(parseList(undefined)).toEqual([])
  })
  it('rejects non-strings and over-long items', () => {
    expect(parseList([1, 2])).toBeNull()
    expect(parseList('x'.repeat(31))).toBeNull()
    expect(parseList(42)).toBeNull()
  })
})

describe('isValidImagePath', () => {
  it("only accepts paths in the caller's own account folder", () => {
    expect(isValidImagePath(`account-${ACC}/1-shirt.jpg`, ACC)).toBe(true)
    expect(isValidImagePath(`account-other/1.jpg`, ACC)).toBe(false)
    expect(isValidImagePath(`${ACC}/1.jpg`, ACC)).toBe(false)
    expect(isValidImagePath(`account-${ACC}/../x.jpg`, ACC)).toBe(false)
    expect(isValidImagePath(`https://evil.example/x.jpg`, ACC)).toBe(false)
    expect(isValidImagePath(`/account-${ACC}/x.jpg`, ACC)).toBe(false)
  })
})

describe('validateProductInput', () => {
  const full = {
    category: '  Men  shirts ',
    name: 'White shirt',
    price: '1,200',
    sizes: 'S, M',
    colors: ['White'],
    image_path: `account-${ACC}/a.jpg`,
  }

  it('normalises a full create payload with defaults', () => {
    const r = validateProductInput(full, ACC, false)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({
      category: 'Men shirts',
      name: 'White shirt',
      description: null,
      price: 1200,
      currency: 'AFN',
      sizes: ['S', 'M'],
      colors: ['White'],
      in_stock: true,
      stock_note: null,
      image_path: `account-${ACC}/a.jpg`,
      is_active: true,
    })
  })

  it('requires category, name and a valid price on create', () => {
    expect(validateProductInput({ ...full, category: ' ' }, ACC, false)).toEqual({ ok: false, error: 'categoryRequired' })
    expect(validateProductInput({ ...full, name: '' }, ACC, false)).toEqual({ ok: false, error: 'nameRequired' })
    expect(validateProductInput({ ...full, price: 'free' }, ACC, false)).toEqual({ ok: false, error: 'priceInvalid' })
    expect(validateProductInput(null, ACC, false)).toEqual({ ok: false, error: 'invalidBody' })
    expect(validateProductInput([], ACC, false)).toEqual({ ok: false, error: 'invalidBody' })
  })

  it("rejects another account's photo path", () => {
    expect(
      validateProductInput({ ...full, image_path: 'account-x/a.jpg' }, ACC, false),
    ).toEqual({ ok: false, error: 'imagePathInvalid' })
  })

  it('partial update returns only the fields sent', () => {
    expect(validateProductInput({ in_stock: false }, ACC, true)).toEqual({
      ok: true,
      value: { in_stock: false },
    })
    expect(validateProductInput({ image_path: null }, ACC, true)).toEqual({
      ok: true,
      value: { image_path: null },
    })
  })
})
