import { describe, expect, it } from 'vitest'
import { isValidEmail } from '@/shared/validation'
import { validateContact, validateQty } from '@/features/checkout/validation'

describe('shared/validation', () => {
  it('validates email', () => {
    expect(isValidEmail('buyer@example.com')).toBe(true)
    expect(isValidEmail('bad')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('a@b.c')).toBe(true)
  })
})

describe('features/checkout/validation', () => {
  it('validates contact and qty', () => {
    expect(validateContact('buyer@example.com')).toBeNull()
    expect(validateContact('bad')).toBe('invalid-email')
    expect(validateQty(2, 1, 10)).toBeNull()
    expect(validateQty(0, 1, 10)).toBe('qty-too-small')
    expect(validateQty(99, 1, 10)).toBe('qty-too-large')
  })
})
