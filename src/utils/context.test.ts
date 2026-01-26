import {getBranchFromContext, getSHAFromContext, isSelfTrigger} from './context'

describe('getSHAFromContext', () => {
  it('extracts SHA from pull_request event', () => {
    const mockContext = {
      eventName: 'pull_request',
      sha: 'context-sha',
      payload: {
        pull_request: {
          head: {
            sha: 'pr-head-sha'
          }
        }
      }
    } as any

    expect(getSHAFromContext(mockContext)).toBe('pr-head-sha')
  })

  it('extracts SHA from check_run event', () => {
    const mockContext = {
      eventName: 'check_run',
      sha: 'context-sha',
      payload: {
        check_run: {
          head_sha: 'check-run-sha'
        }
      }
    } as any

    expect(getSHAFromContext(mockContext)).toBe('check-run-sha')
  })

  it('uses context SHA for other events', () => {
    const mockContext = {
      eventName: 'push',
      sha: 'push-sha',
      payload: {}
    } as any

    expect(getSHAFromContext(mockContext)).toBe('push-sha')
  })
})

describe('getBranchFromContext', () => {
  it('extracts branch from pull_request event', () => {
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

    expect(getBranchFromContext(mockContext)).toBe('feature/test-branch')
  })

  it('extracts branch from check_run event', () => {
    const mockContext = {
      eventName: 'check_run',
      payload: {
        check_run: {
          check_suite: {
            head_branch: 'check-run-branch'
          }
        }
      }
    } as any

    expect(getBranchFromContext(mockContext)).toBe('check-run-branch')
  })

  it('extracts branch from push event with refs/heads/ prefix', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/heads/main',
      payload: {}
    } as any

    expect(getBranchFromContext(mockContext)).toBe('main')
  })

  it('extracts branch with slashes in name', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/heads/feature/my-branch',
      payload: {}
    } as any

    expect(getBranchFromContext(mockContext)).toBe('feature/my-branch')
  })

  it('returns null for tag events', () => {
    const mockContext = {
      eventName: 'push',
      ref: 'refs/tags/v1.0.0',
      payload: {}
    } as any

    expect(getBranchFromContext(mockContext)).toBe(null)
  })

  it('returns null when ref is undefined', () => {
    const mockContext = {
      eventName: 'workflow_dispatch',
      ref: undefined,
      payload: {}
    } as any

    expect(getBranchFromContext(mockContext)).toBe(null)
  })

  it('handles grimoire- prefix branch from pull request', () => {
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

    expect(getBranchFromContext(mockContext)).toBe('grimoire-test-123')
  })
})

describe('isSelfTrigger', () => {
  it('returns true when check_run name matches our name', () => {
    const mockContext = {
      eventName: 'check_run',
      payload: {
        check_run: {
          name: 'Combined Status Check'
        }
      }
    } as any

    expect(isSelfTrigger(mockContext, 'Combined Status Check')).toBe(true)
  })

  it('returns false when check_run name does not match', () => {
    const mockContext = {
      eventName: 'check_run',
      payload: {
        check_run: {
          name: 'build'
        }
      }
    } as any

    expect(isSelfTrigger(mockContext, 'Combined Status Check')).toBe(false)
  })

  it('returns false for non-check_run events', () => {
    const mockContext = {
      eventName: 'pull_request',
      payload: {}
    } as any

    expect(isSelfTrigger(mockContext, 'Combined Status Check')).toBe(false)
  })
})
