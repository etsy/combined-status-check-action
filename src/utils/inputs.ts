import * as core from '@actions/core'
import {ActionInputs} from './types'

export const DEFAULT_REGEX = '^.*$'
export const DEFAULT_CHECK_RUN_NAME = 'Combined Status Check'

/**
 * Parse a newline-separated list of required check run names into a Set.
 * Trims whitespace and filters out empty lines.
 */
export function parseRequiredCheckRuns(input: string): Set<string> {
  const trimmed = input.trim()
  if (!trimmed) {
    return new Set()
  }

  const names = trimmed
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  return new Set(names)
}

/**
 * Validate that required-check-runs is not used with custom regex inputs.
 * Required checks mode only monitors specific check runs, not statuses,
 * so custom regex filters don't apply.
 */
export function validateInputs(
  statusRegexInput: string,
  checkRunRegexInput: string,
  requiredCheckRuns: Set<string>
): void {
  const hasRequiredChecks = requiredCheckRuns.size > 0
  if (!hasRequiredChecks) {
    return
  }

  if (statusRegexInput !== DEFAULT_REGEX) {
    throw new Error(
      'Cannot use both required-check-runs and a custom status-regex. ' +
        'Required checks mode only monitors check runs, not commit statuses.'
    )
  }

  if (checkRunRegexInput !== DEFAULT_REGEX) {
    throw new Error(
      'Cannot use both required-check-runs and a custom check-run-regex. ' +
        'Please use one or the other.'
    )
  }
}

/**
 * Read and parse all action inputs.
 */
export function getInputs(): ActionInputs {
  const token = core.getInput('token', {required: true})
  const checkRunName = core.getInput('check-run-name') || DEFAULT_CHECK_RUN_NAME
  const timeoutSeconds = parseInt(
    core.getInput('timeout-seconds', {required: true})
  )
  const statusRegex = core.getInput('status-regex', {required: true})
  const checkRunRegex = core.getInput('check-run-regex', {required: true})
  const requiredCheckRunsInput = core.getInput('required-check-runs')
  const autoPassBranchPrefix = core.getInput('auto-pass-branch-prefix')

  // Deprecated inputs (kept for compatibility, may log warnings)
  const initialDelaySecondsInput = core.getInput('initial-delay-seconds')
  const intervalSecondsInput = core.getInput('interval-seconds')

  // Parse initial-delay-seconds, defaulting to 10 for backwards compatibility
  let initialDelaySeconds = 10
  if (initialDelaySecondsInput) {
    initialDelaySeconds = parseInt(initialDelaySecondsInput)
    if (initialDelaySecondsInput !== '10') {
      core.warning(
        'The initial-delay-seconds input is deprecated in v2 event-driven mode. ' +
          'It is only used when initial evaluation is performed on pull_request events.'
      )
    }
  }

  // Parse interval-seconds, defaulting to 2 for backwards compatibility
  let intervalSeconds = 2
  if (intervalSecondsInput) {
    intervalSeconds = parseInt(intervalSecondsInput)
    if (intervalSecondsInput !== '2') {
      core.warning(
        'The interval-seconds input is deprecated in v2 event-driven mode. ' +
          'Polling is no longer performed; the action responds to check_run events instead.'
      )
    }
  }

  const requiredCheckRuns = parseRequiredCheckRuns(requiredCheckRunsInput)

  // Validate mutual exclusivity
  validateInputs(statusRegex, checkRunRegex, requiredCheckRuns)

  return {
    token,
    checkRunName,
    timeoutSeconds,
    statusRegex,
    checkRunRegex,
    requiredCheckRuns,
    autoPassBranchPrefix,
    initialDelaySeconds,
    intervalSeconds
  }
}
