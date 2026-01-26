import {parseRequiredCheckRuns, validateInputs, DEFAULT_REGEX} from './inputs'

describe('parseRequiredCheckRuns', () => {
  it('returns empty set for empty string', () => {
    const result = parseRequiredCheckRuns('')
    expect(result.size).toBe(0)
  })

  it('returns empty set for whitespace-only string', () => {
    const result = parseRequiredCheckRuns('   \n  \n   ')
    expect(result.size).toBe(0)
  })

  it('parses a single check run name', () => {
    const result = parseRequiredCheckRuns('build')
    expect(result.size).toBe(1)
    expect(result.has('build')).toBe(true)
  })

  it('parses multiple check run names', () => {
    const result = parseRequiredCheckRuns('build\ntest\nlint')
    expect(result.size).toBe(3)
    expect(result.has('build')).toBe(true)
    expect(result.has('test')).toBe(true)
    expect(result.has('lint')).toBe(true)
  })

  it('trims whitespace from check run names', () => {
    const result = parseRequiredCheckRuns('  build  \n  test  ')
    expect(result.size).toBe(2)
    expect(result.has('build')).toBe(true)
    expect(result.has('test')).toBe(true)
  })

  it('filters out empty lines', () => {
    const result = parseRequiredCheckRuns('build\n\n\ntest\n')
    expect(result.size).toBe(2)
    expect(result.has('build')).toBe(true)
    expect(result.has('test')).toBe(true)
  })

  it('handles Windows-style line endings', () => {
    const result = parseRequiredCheckRuns('build\r\ntest')
    expect(result.size).toBe(2)
    expect(result.has('build')).toBe(true)
    expect(result.has('test')).toBe(true)
  })

  it('deduplicates repeated names', () => {
    const result = parseRequiredCheckRuns('build\ntest\nbuild')
    expect(result.size).toBe(2)
  })
})

describe('validateInputs', () => {
  it('allows empty required checks with default regexes', () => {
    expect(() =>
      validateInputs(DEFAULT_REGEX, DEFAULT_REGEX, new Set())
    ).not.toThrow()
  })

  it('allows empty required checks with custom status regex', () => {
    expect(() =>
      validateInputs('^test-.*$', DEFAULT_REGEX, new Set())
    ).not.toThrow()
  })

  it('allows empty required checks with custom check-run regex', () => {
    expect(() =>
      validateInputs(DEFAULT_REGEX, '^test-.*$', new Set())
    ).not.toThrow()
  })

  it('allows required checks with default regexes', () => {
    expect(() =>
      validateInputs(DEFAULT_REGEX, DEFAULT_REGEX, new Set(['build', 'test']))
    ).not.toThrow()
  })

  it('throws when custom status-regex and required checks are provided', () => {
    expect(() =>
      validateInputs('^test-.*$', DEFAULT_REGEX, new Set(['build', 'test']))
    ).toThrow('Cannot use both required-check-runs and a custom status-regex')
  })

  it('throws when custom check-run-regex and required checks are provided', () => {
    expect(() =>
      validateInputs(DEFAULT_REGEX, '^test-.*$', new Set(['build', 'test']))
    ).toThrow(
      'Cannot use both required-check-runs and a custom check-run-regex'
    )
  })
})
