import { describe, expect, it } from 'vitest'
import { describeProduct, formatCatalogForPrompt, formatPrice } from './catalog'
import type { Product } from './types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p',
    account_id: 'a',
    category: 'Shirts',
    name: 'White shirt',
    description: null,
    price: 1200,
    currency: 'AFN',
    sizes: [],
    colors: [],
    in_stock: true,
    stock_note: null,
    image_path: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('formatPrice', () => {
  it('groups thousands and drops needless decimals', () => {
    expect(formatPrice(1200, 'AFN')).toBe('1,200 AFN')
    expect(formatPrice(99.5, 'USD')).toBe('99.50 USD')
  })
})

describe('describeProduct', () => {
  it('lists price, sizes, colours, stock and details', () => {
    const text = describeProduct(
      product({
        sizes: ['30', '32'],
        colors: ['Dark blue'],
        in_stock: false,
        stock_note: 'back next week',
        description: 'Slim\n fit',
      }),
    )
    expect(text).toContain('White shirt | category: Shirts | price: 1,200 AFN')
    expect(text).toContain('sizes: 30, 32')
    expect(text).toContain('colors: Dark blue')
    expect(text).toContain('stock: OUT OF STOCK (back next week)')
    expect(text).toContain('details: Slim fit')
  })
})

describe('formatCatalogForPrompt', () => {
  it('returns null for an empty catalog', () => {
    expect(formatCatalogForPrompt([])).toBeNull()
  })
  it('groups products by category', () => {
    const text = formatCatalogForPrompt([
      product({ name: 'A', category: 'Shirts' }),
      product({ name: 'B', category: 'Jackets' }),
      product({ name: 'C', category: 'Shirts' }),
    ]) as string
    expect(text.match(/## Shirts/g)).toHaveLength(1)
    expect(text).toContain('## Jackets')
    expect(text.indexOf('- A')).toBeLessThan(text.indexOf('- C'))
  })
})
