import { describe, expect, it } from 'vitest'
import { symbolFor } from '@/shared/formatting/format'

describe('shared/formatting/symbolFor', () => {
  it('maps common currencies', () => {
    expect(symbolFor('CNY')).toBe('¥')
    expect(symbolFor('USD')).toBe('$')
    expect(symbolFor('EUR')).toBe('€')
    expect(symbolFor('GBP')).toBe('£')
  })

  it('falls back to code', () => {
    expect(symbolFor('XXX')).toBe('XXX')
  })
})
