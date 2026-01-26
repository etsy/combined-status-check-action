import {isTimedOut} from './check-evaluator'
import {CheckRunMetadata} from '../utils/types'

describe('isTimedOut', () => {
  it('returns false when within timeout', () => {
    const metadata: CheckRunMetadata = {
      startTime: Date.now() - 100 * 1000, // 100 seconds ago
      timeoutSeconds: 300, // 5 minute timeout
      mode: 'required-check-runs',
      requiredChecks: ['build']
    }

    expect(isTimedOut(metadata)).toBe(false)
  })

  it('returns true when timeout exceeded', () => {
    const metadata: CheckRunMetadata = {
      startTime: Date.now() - 400 * 1000, // 400 seconds ago
      timeoutSeconds: 300, // 5 minute timeout (exceeded)
      mode: 'required-check-runs',
      requiredChecks: ['build']
    }

    expect(isTimedOut(metadata)).toBe(true)
  })

  it('returns true when exactly at timeout boundary', () => {
    const metadata: CheckRunMetadata = {
      startTime: Date.now() - 300 * 1000 - 1, // Just past 300 seconds
      timeoutSeconds: 300,
      mode: 'required-check-runs',
      requiredChecks: ['build']
    }

    expect(isTimedOut(metadata)).toBe(true)
  })

  it('handles short timeouts', () => {
    const metadata: CheckRunMetadata = {
      startTime: Date.now() - 2 * 1000, // 2 seconds ago
      timeoutSeconds: 1, // 1 second timeout
      mode: 'required-check-runs',
      requiredChecks: ['build']
    }

    expect(isTimedOut(metadata)).toBe(true)
  })
})
