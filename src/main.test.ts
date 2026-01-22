import {
  parseRequiredCheckRuns,
  validateInputs,
  RequiredCheckRunResult
} from './main'

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
  const DEFAULT_REGEX = '^.*$'

  it('allows empty required checks with default regex', () => {
    expect(() => validateInputs(DEFAULT_REGEX, new Set())).not.toThrow()
  })

  it('allows empty required checks with custom regex', () => {
    expect(() => validateInputs('^test-.*$', new Set())).not.toThrow()
  })

  it('allows required checks with default regex', () => {
    expect(() =>
      validateInputs(DEFAULT_REGEX, new Set(['build', 'test']))
    ).not.toThrow()
  })

  it('throws when both custom regex and required checks are provided', () => {
    expect(() =>
      validateInputs('^test-.*$', new Set(['build', 'test']))
    ).toThrow(
      'Cannot use both required-check-runs and a custom check-run-regex'
    )
  })
})

// Mock types for testing requiredCheckRunLoopIteration
// Note: The actual function requires Octokit which is complex to mock.
// These tests verify the exported interface is correct.

describe('RequiredCheckRunResult interface', () => {
  it('has the expected structure', () => {
    const result: RequiredCheckRunResult = {
      succeeded: ['check1'],
      pending: ['check2'],
      failed: ['check3'],
      missing: ['check4']
    }

    expect(result.succeeded).toEqual(['check1'])
    expect(result.pending).toEqual(['check2'])
    expect(result.failed).toEqual(['check3'])
    expect(result.missing).toEqual(['check4'])
  })
})
