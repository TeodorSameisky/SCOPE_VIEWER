import { describe, expect, it } from 'vitest'
import { LastResults } from './lastResults'

describe('LastResults', () => {
  it('gives the current result, not pending', () => {
    const { keep } = new LastResults<number>()
    expect(keep('CH1', 5)).toEqual({ value: 5, pending: false })
  })

  it('gives the last result, pending, while the next one is not there', () => {
    const { keep } = new LastResults<number>()
    keep('CH1', 5)
    expect(keep('CH1', undefined)).toEqual({ value: 5, pending: true })
    expect(keep('CH1', undefined)).toEqual({ value: 5, pending: true })
    // the new one replaces it
    expect(keep('CH1', 7)).toEqual({ value: 7, pending: false })
    expect(keep('CH1', undefined)).toEqual({ value: 7, pending: true })
  })

  it('has nothing to give for a key it has not seen', () => {
    const { keep } = new LastResults<number>()
    keep('CH1', 5)
    expect(keep('CH2', undefined)).toEqual({ value: undefined, pending: true })
  })

  it('keeps each key apart', () => {
    const { keep } = new LastResults<string>()
    keep('FFT1', 'a')
    keep('FFT2', 'b')
    expect(keep('FFT1', undefined).value).toBe('a')
    expect(keep('FFT2', undefined).value).toBe('b')
  })

  it('does not give a last result that no longer fits what is asked for', () => {
    const { keep } = new LastResults<{ window: string }>()
    keep('FFT1', { window: 'hann' })
    expect(keep('FFT1', undefined, (last) => last.window === 'hann').value).toEqual({ window: 'hann' })
    expect(keep('FFT1', undefined, (last) => last.window === 'flatTop')).toEqual({ value: undefined, pending: true })
  })

  it('stores a result of 0 or an empty string like any other (only undefined is "not there")', () => {
    const { keep } = new LastResults<number>()
    expect(keep('k', 0)).toEqual({ value: 0, pending: false })
    expect(keep('k', undefined)).toEqual({ value: 0, pending: true })
  })
})
