import {
  parseRequiredCheckRuns,
  validateInputs,
  RequiredCheckRunResult,
  getBranchFromContext
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

describe('getBranchFromContext', () => {
  it('should extract branch from pull_request event', () => {
    const mockContext = {
      eventName: 'pull_request',
      payload: {
        pull_request: {
          head: {
            ref: 'feature/test-branch'
          }
        }
      }
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe('feature/test-branch')
  })

  it('should extract branch from push event with refs/heads/ prefix', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/heads/main',
      payload: {}
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe('main')
  })

  it('should extract branch with slashes in name', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/heads/feature/my-branch',
      payload: {}
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe('feature/my-branch')
  })

  it('should return null for tag events', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/tags/v1.0.0',
      payload: {}
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe(null)
  })

  it('should return null when ref is undefined', () => {
    const mockContext = {
      eventName: 'workflow_dispatch',
      ref: undefined,
      payload: {}
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe(null)
  })

  it('should return null for release events', () => {
    const mockContext = {
      eventName: 'release',
      ref: 'refs/tags/v2.0.0',
      payload: {}
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe(null)
  })

  it('should handle grimoire- prefix branch from pull request', () => {
    const mockContext = {
      eventName: 'pull_request',
      payload: {
        pull_request: {
          head: {
            ref: 'grimoire-test-123'
          }
        }
      }
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe('grimoire-test-123')
  })

  it('should handle grimoire- prefix branch from push', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/heads/grimoire-auto-branch',
      payload: {}
    } as any

    const result = getBranchFromContext(mockContext)
    expect(result).toBe('grimoire-auto-branch')
  })
})
