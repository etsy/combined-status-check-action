import {
  parseRequiredCheckRuns,
  validateInputs,
  RequiredCheckRunResult,
  getBranchFromContext,
  main
} from './main'
import * as core from '@actions/core'
import * as github from '@actions/github'

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

describe('main() auto-pass integration', () => {
  let getInputMock: jest.SpyInstance
  let infoMock: jest.SpyInstance
  let originalContext: typeof github.context

  beforeEach(() => {
    // Use fake timers to prevent actual delays
    jest.useFakeTimers()

    // Mock core.getInput
    getInputMock = jest.spyOn(core, 'getInput')

    // Mock core.info to track log messages
    infoMock = jest.spyOn(core, 'info').mockImplementation()

    // Save original context
    originalContext = github.context
  })

  afterEach(() => {
    // Restore timers
    jest.useRealTimers()

    // Restore mocks
    getInputMock.mockRestore()
    infoMock.mockRestore()

    // Restore context
    Object.defineProperty(github, 'context', {
      value: originalContext,
      writable: true
    })
  })

  it('should skip status checks when branch matches auto-pass prefix', async () => {
    // Setup: Configure inputs for auto-pass scenario
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'token': 'fake-token',
        'initial-delay-seconds': '10',
        'interval-seconds': '2',
        'timeout-seconds': '300',
        'status-regex': '^.*$',
        'check-run-regex': '^.*$',
        'required-check-runs': '',
        'auto-pass-branch-prefix': 'grimoire-'
      }
      return inputs[name] || ''
    })

    // Mock github.context for a pull request with grimoire- branch
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'pull_request',
        sha: 'abc123def456',
        ref: 'refs/heads/grimoire-test-branch',
        repo: {
          owner: 'test-owner',
          repo: 'test-repo'
        },
        payload: {
          pull_request: {
            head: {
              ref: 'grimoire-test-branch',
              sha: 'abc123def456'
            }
          }
        }
      },
      writable: true
    })

    // Execute: Run main()
    await main()

    // Verify: Check that the correct info messages were logged
    expect(infoMock).toHaveBeenCalledWith(
      'Executing combined-status-check-action on SHA abc123def456.'
    )
    expect(infoMock).toHaveBeenCalledWith('Detected branch: grimoire-test-branch')
    expect(infoMock).toHaveBeenCalledWith(
      "Branch 'grimoire-test-branch' starts with auto-pass prefix 'grimoire-'. " +
      "Skipping status checks and marking as successful."
    )

    // Verify: Confirm that we did NOT proceed to the normal check logic
    // (these messages would appear if the auto-pass didn't work)
    const allInfoCalls = infoMock.mock.calls.map(call => call[0])
    expect(allInfoCalls).not.toContain(
      expect.stringContaining('Using required-check-runs mode')
    )
    expect(allInfoCalls).not.toContain(
      expect.stringContaining('Waiting')
    )
    expect(allInfoCalls).not.toContain(
      expect.stringContaining('Starting combined status check loop')
    )
  })

  it('should proceed with normal checks when branch does not match prefix', async () => {
    // Setup: Configure inputs with auto-pass prefix
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'token': 'fake-token',
        'initial-delay-seconds': '0', // No delay for testing
        'interval-seconds': '1',
        'timeout-seconds': '1', // Short timeout for testing
        'status-regex': '^.*$',
        'check-run-regex': '^.*$',
        'required-check-runs': '',
        'auto-pass-branch-prefix': 'grimoire-'
      }
      return inputs[name] || ''
    })

    // Mock github.context for a PR with non-matching branch
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'pull_request',
        sha: 'abc123def456',
        ref: 'refs/heads/feature-branch',
        repo: {
          owner: 'test-owner',
          repo: 'test-repo'
        },
        payload: {
          pull_request: {
            head: {
              ref: 'feature-branch',
              sha: 'abc123def456'
            }
          }
        }
      },
      writable: true
    })

    // Mock github.getOctokit to return empty results (all checks passing)
    const mockRepos = {
      getCombinedStatusForRef: jest.fn()
    }
    const mockChecks = {
      listForRef: jest.fn()
    }
    const mockOctokit = {
      paginate: {
        iterator: jest.fn().mockImplementation((endpoint: any, _params: any) => {
          // Paginated combined status responses
          if (endpoint === mockRepos.getCombinedStatusForRef) {
            return (async function* () {
              yield { data: { statuses: [] } }
            })()
          }
          // Paginated check run responses
          if (endpoint === mockChecks.listForRef) {
            return (async function* () {
              yield { data: [] }
            })()
          }
          // Default: empty array-shaped data
          return (async function* () {
            yield { data: [] }
          })()
        })
      },
      rest: {
        repos: mockRepos,
        checks: mockChecks
      }
    }
    jest.spyOn(github, 'getOctokit').mockReturnValue(mockOctokit as any)

    // Execute: Run main() with fake timers
    const mainPromise = main()
    jest.runAllTimers()
    await mainPromise

    // Verify: Check that we logged the non-match message
    expect(infoMock).toHaveBeenCalledWith('Detected branch: feature-branch')
    expect(infoMock).toHaveBeenCalledWith(
      "Branch 'feature-branch' does not match auto-pass prefix 'grimoire-'. " +
      "Proceeding with normal status check logic."
    )

    // Verify: Confirm that we DID proceed to normal logic
    const allInfoCalls = infoMock.mock.calls.map(call => call[0])
    expect(allInfoCalls).toContain('Starting combined status check loop...')
  })

  it('should proceed with normal checks when auto-pass prefix is empty', async () => {
    // Setup: Configure inputs WITHOUT auto-pass prefix
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'token': 'fake-token',
        'initial-delay-seconds': '0', // No delay for testing
        'interval-seconds': '1',
        'timeout-seconds': '1', // Short timeout for testing
        'status-regex': '^.*$',
        'check-run-regex': '^.*$',
        'required-check-runs': '',
        'auto-pass-branch-prefix': '' // Empty - feature disabled
      }
      return inputs[name] || ''
    })

    // Mock github.context
    Object.defineProperty(github, 'context', {
      value: {
        eventName: 'pull_request',
        sha: 'abc123def456',
        ref: 'refs/heads/any-branch',
        repo: {
          owner: 'test-owner',
          repo: 'test-repo'
        },
        payload: {
          pull_request: {
            head: {
              ref: 'any-branch',
              sha: 'abc123def456'
            }
          }
        }
      },
      writable: true
    })

    // Mock github.getOctokit to return empty results (all checks passing)
    const mockOctokit = {
      paginate: {
        iterator: jest.fn().mockReturnValue((async function* () {
          yield {data: {statuses: []}}
        })())
      },
      rest: {
        repos: {
          getCombinedStatusForRef: jest.fn()
        },
        checks: {
          listForRef: jest.fn()
        }
      }
    }
    jest.spyOn(github, 'getOctokit').mockReturnValue(mockOctokit as any)

    // Execute: Run main() with fake timers
    const mainPromise = main()
    jest.runAllTimers()
    await mainPromise

    // Verify: Should NOT log any branch detection messages
    const allInfoCalls = infoMock.mock.calls.map(call => call[0])
    expect(allInfoCalls).not.toContain(expect.stringContaining('Detected branch'))
    expect(allInfoCalls).not.toContain(expect.stringContaining('auto-pass prefix'))

    // Verify: Should proceed directly to normal logic
    expect(allInfoCalls).toContain('Starting combined status check loop...')
  })
})
