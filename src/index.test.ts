import * as core from '@actions/core'
import * as github from '@actions/github'

// Mock the handlers before importing run
jest.mock('./handlers/pull-request', () => ({
  handlePullRequest: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('./handlers/check-run-completed', () => ({
  handleCheckRunCompleted: jest.fn().mockResolvedValue(undefined)
}))
jest.mock('./handlers/scheduled-timeout', () => ({
  handleScheduledTimeout: jest.fn().mockResolvedValue(undefined)
}))

import {run} from './index'
import {handlePullRequest} from './handlers/pull-request'
import {handleCheckRunCompleted} from './handlers/check-run-completed'
import {handleScheduledTimeout} from './handlers/scheduled-timeout'

describe('Event Router', () => {
  let getInputMock: jest.SpyInstance
  let infoMock: jest.SpyInstance
  let warningMock: jest.SpyInstance
  let getOctokitMock: jest.SpyInstance
  let originalContext: typeof github.context

  beforeEach(() => {
    // Save original context
    originalContext = github.context

    // Mock core functions
    getInputMock = jest.spyOn(core, 'getInput')
    infoMock = jest.spyOn(core, 'info').mockImplementation()
    warningMock = jest.spyOn(core, 'warning').mockImplementation()
    jest.spyOn(core, 'setFailed').mockImplementation()

    // Default input mock
    getInputMock.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        token: 'fake-token',
        'check-run-name': 'Combined Status Check',
        'timeout-seconds': '300',
        'status-regex': '^.*$',
        'check-run-regex': '^.*$',
        'required-check-runs': '',
        'auto-pass-branch-prefix': '',
        'initial-delay-seconds': '10',
        'interval-seconds': '2'
      }
      return inputs[name] || ''
    })

    // Mock getOctokit
    getOctokitMock = jest.spyOn(github, 'getOctokit').mockReturnValue({} as any)

    // Reset handler mocks
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
    Object.defineProperty(github, 'context', {
      value: originalContext,
      writable: true
    })
  })

  function setContext(eventName: string, action?: string): void {
    Object.defineProperty(github, 'context', {
      value: {
        eventName,
        sha: 'test-sha',
        ref: 'refs/heads/main',
        repo: {owner: 'test-owner', repo: 'test-repo'},
        payload: {
          action,
          pull_request:
            eventName === 'pull_request'
              ? {head: {sha: 'pr-sha', ref: 'feature-branch'}}
              : undefined,
          check_run:
            eventName === 'check_run'
              ? {name: 'other-check', head_sha: 'check-sha'}
              : undefined
        }
      },
      writable: true
    })
  }

  describe('pull_request events', () => {
    it('routes opened action to handlePullRequest', async () => {
      setContext('pull_request', 'opened')
      await run()
      expect(handlePullRequest).toHaveBeenCalled()
    })

    it('routes synchronize action to handlePullRequest', async () => {
      setContext('pull_request', 'synchronize')
      await run()
      expect(handlePullRequest).toHaveBeenCalled()
    })

    it('routes reopened action to handlePullRequest', async () => {
      setContext('pull_request', 'reopened')
      await run()
      expect(handlePullRequest).toHaveBeenCalled()
    })

    it('ignores closed action', async () => {
      setContext('pull_request', 'closed')
      await run()
      expect(handlePullRequest).not.toHaveBeenCalled()
      expect(infoMock).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring pull_request event')
      )
    })
  })

  describe('check_run events', () => {
    it('routes completed action to handleCheckRunCompleted', async () => {
      setContext('check_run', 'completed')
      await run()
      expect(handleCheckRunCompleted).toHaveBeenCalled()
    })

    it('ignores created action', async () => {
      setContext('check_run', 'created')
      await run()
      expect(handleCheckRunCompleted).not.toHaveBeenCalled()
      expect(infoMock).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring check_run event')
      )
    })
  })

  describe('schedule events', () => {
    it('routes to handleScheduledTimeout', async () => {
      setContext('schedule')
      await run()
      expect(handleScheduledTimeout).toHaveBeenCalled()
    })
  })

  describe('workflow_dispatch events', () => {
    it('routes to handleScheduledTimeout', async () => {
      setContext('workflow_dispatch')
      await run()
      expect(handleScheduledTimeout).toHaveBeenCalled()
    })
  })

  describe('unsupported events', () => {
    it('logs warning for unsupported event type', async () => {
      setContext('issues')
      await run()
      expect(warningMock).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported event type')
      )
    })
  })
})
