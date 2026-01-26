import * as core from '@actions/core'
import * as github from '@actions/github'
import {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods'

// eslint-disable-next-line import/no-unresolved
import {PullRequestEvent} from '@octokit/webhooks-types'

type Status =
  RestEndpointMethodTypes['repos']['getCombinedStatusForRef']['response']['data']['statuses'][0]
type CheckRun =
  RestEndpointMethodTypes['checks']['listForRef']['response']['data']['check_runs'][0]
type Octokit = ReturnType<typeof github.getOctokit>

const DEFAULT_REGEX = '^.*$'

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

export interface RequiredCheckRunResult {
  /** Checks that have completed successfully */
  succeeded: string[]
  /** Checks that are still pending/running */
  pending: string[]
  /** Checks that have failed */
  failed: string[]
  /** Checks that haven't appeared at all */
  missing: string[]
}

/**
 * Fetch check runs and categorize them by required check status.
 */
export async function requiredCheckRunLoopIteration(
  octokit: Octokit,
  sha: string,
  requiredCheckRuns: Set<string>
): Promise<RequiredCheckRunResult> {
  const checkRunsIterator = octokit.paginate.iterator(
    octokit.rest.checks.listForRef,
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref: sha
    }
  )

  // Track check runs by name, keeping only the most recent (highest ID) for each name.
  // GitHub's Check Runs API can return multiple check runs with the same name
  // (e.g., due to re-runs), and the order is not guaranteed to be deterministic.
  const foundChecks = new Map<
    string,
    {id: number; status: string; conclusion: string | null}
  >()

  for await (const response of checkRunsIterator) {
    for (const checkRun of response.data) {
      if (requiredCheckRuns.has(checkRun.name)) {
        const existing = foundChecks.get(checkRun.name)
        // Only update if this check run has a higher ID (more recent)
        if (!existing || checkRun.id > existing.id) {
          foundChecks.set(checkRun.name, {
            id: checkRun.id,
            status: checkRun.status,
            conclusion: checkRun.conclusion
          })
        }
      }
    }
  }

  const succeeded: string[] = []
  const pending: string[] = []
  const failed: string[] = []
  const missing: string[] = []

  for (const name of requiredCheckRuns) {
    const check = foundChecks.get(name)
    if (!check) {
      missing.push(name)
    } else if (check.status !== 'completed') {
      pending.push(name)
    } else if (
      check.conclusion === 'success' ||
      check.conclusion === 'skipped' ||
      check.conclusion === 'neutral'
    ) {
      succeeded.push(name)
    } else {
      failed.push(name)
    }
  }

  core.info(
    `Required checks - succeeded: ${succeeded.length}, pending: ${pending.length}, failed: ${failed.length}, missing: ${missing.length}`
  )

  return {succeeded, pending, failed, missing}
}

async function wait(seconds: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, seconds * 1000)
  })
}

function getSHAFromContext(ctx: typeof github.context): string {
  if (ctx.eventName === 'pull_request') {
    const pullRequestEvent = ctx.payload as PullRequestEvent

    return pullRequestEvent.pull_request.head.sha
  } else {
    return ctx.sha
  }
}

export function getBranchFromContext(ctx: typeof github.context): string | null {
  if (ctx.eventName === 'pull_request') {
    const pullRequestEvent = ctx.payload as PullRequestEvent
    return pullRequestEvent.pull_request.head.ref
  } else if (ctx.ref && ctx.ref.startsWith('refs/heads/')) {
    // Extract branch name from ref like "refs/heads/feature/my-branch"
    return ctx.ref.substring('refs/heads/'.length)
  } else {
    // For other event types (tags, etc.), return null
    return null
  }
}

export async function main(): Promise<void> {
  const githubToken = core.getInput('token', {required: true})
  const initialDelaySeconds: number = parseInt(
    core.getInput('initial-delay-seconds', {required: true})
  )
  const intervalSeconds: number = parseInt(
    core.getInput('interval-seconds', {required: true})
  )
  const timeoutSeconds: number = parseInt(
    core.getInput('timeout-seconds', {required: true})
  )

  const statusRegexInput = core.getInput('status-regex', {required: true})
  const checkRunRegexInput = core.getInput('check-run-regex', {required: true})
  const requiredCheckRunsInput = core.getInput('required-check-runs')

  const requiredCheckRuns = parseRequiredCheckRuns(requiredCheckRunsInput)

  // Validate mutual exclusivity
  validateInputs(statusRegexInput, checkRunRegexInput, requiredCheckRuns)

  const statusRegex = new RegExp(statusRegexInput)
  const checkRunRegex = new RegExp(checkRunRegexInput)

  const sha = getSHAFromContext(github.context)

  core.info(`Executing combined-status-check-action on SHA ${sha}.`)

  // Check for auto-pass branch prefix
  const autoPassBranchPrefix = core.getInput('auto-pass-branch-prefix')

  if (autoPassBranchPrefix) {
    const branchName = getBranchFromContext(github.context)

    if (branchName) {
      core.info(`Detected branch: ${branchName}`)

      if (branchName.startsWith(autoPassBranchPrefix)) {
        core.info(
          `Branch '${branchName}' starts with auto-pass prefix '${autoPassBranchPrefix}'. ` +
          `Skipping status checks and marking as successful.`
        )
        return // Early exit - action succeeds
      } else {
        core.info(
          `Branch '${branchName}' does not match auto-pass prefix '${autoPassBranchPrefix}'. ` +
          `Proceeding with normal status check logic.`
        )
      }
    } else {
      core.info(
        `Could not determine branch name for event type '${github.context.eventName}'. ` +
        `Proceeding with normal status check logic.`
      )
    }
  }

  if (requiredCheckRuns.size > 0) {
    core.info(
      `Using required-check-runs mode with ${
        requiredCheckRuns.size
      } required checks: [${[...requiredCheckRuns].join(', ')}]`
    )
  }

  const octokit = github.getOctokit(githubToken)

  core.info(`Waiting ${initialDelaySeconds} seconds for checks to start...`)

  await wait(initialDelaySeconds)

  await loop(
    octokit,
    sha,
    statusRegex,
    checkRunRegex,
    requiredCheckRuns,
    intervalSeconds,
    timeoutSeconds
  )
}

type PendingStatus = Status & {state: 'pending'}
type CompletedStatus = Status & {state: string}
type FailedStatus = CompletedStatus & {state: 'error' | 'failure'}

function isStatusPending(status: Status): status is PendingStatus {
  return status.state === 'pending'
}

function isStatusFailed(status: CompletedStatus): status is FailedStatus {
  return status.state === 'error' || status.state === 'failure'
}

type PendingCheckRun = CheckRun & {status: string}
type CompletedCheckRun = CheckRun & {status: 'completed'}
type FailedCheckRun = CompletedCheckRun & {
  conclusion: 'cancelled' | 'failure' | 'timed_out'
}

function isCheckRunCompleted(run: CheckRun): run is CompletedCheckRun {
  return run.status === 'completed'
}

function isCheckRunFailed(run: CompletedCheckRun): run is FailedCheckRun {
  return (
    run.conclusion === 'cancelled' ||
    run.conclusion === 'failure' ||
    run.conclusion === 'timed_out'
  )
}

async function loop(
  octokit: Octokit,
  sha: string,
  statusRegex: RegExp,
  checkRunRegex: RegExp,
  requiredCheckRuns: Set<string>,
  intervalSeconds: number,
  timeoutSeconds: number
): Promise<void> {
  let elapsedSeconds = 0
  const useRequiredChecksMode = requiredCheckRuns.size > 0

  core.info('Starting combined status check loop...')

  do {
    if (useRequiredChecksMode) {
      // Required checks mode: only track specific check runs by name
      // Skip status API call since we only care about check runs
      const requiredResult = await requiredCheckRunLoopIteration(
        octokit,
        sha,
        requiredCheckRuns
      )

      // Fail immediately if any required checks have failed
      if (requiredResult.failed.length > 0) {
        core.setFailed(
          `The following required check runs have failed: [${requiredResult.failed.join(
            ', '
          )}].`
        )
        return
      }

      // Check if there are still pending/missing checks
      const hasPendingWork =
        requiredResult.pending.length > 0 || requiredResult.missing.length > 0

      if (hasPendingWork) {
        if (requiredResult.pending.length > 0) {
          core.info(
            `The following required check runs are pending: [${requiredResult.pending.join(
              ', '
            )}].`
          )
        }
        if (requiredResult.missing.length > 0) {
          core.info(
            `The following required check runs have not appeared yet: [${requiredResult.missing.join(
              ', '
            )}].`
          )
        }

        core.info(
          `Waiting for ${requiredResult.pending.length} pending checks and ${requiredResult.missing.length} missing checks. Checking again in ${intervalSeconds} seconds.`
        )

        await wait(intervalSeconds)
        elapsedSeconds += intervalSeconds
        continue
      }

      core.info(
        `All ${requiredCheckRuns.size} required check runs have completed successfully.`
      )
      return
    } else {
      // Original regex mode
      const [statusLoopResult, checkRunLoopResult] = await Promise.all([
        combinedStatusLoopIteration(octokit, sha, statusRegex),
        checkRunLoopIteration(octokit, sha, checkRunRegex)
      ])

      const [pendingStatuses, completedStatuses] = statusLoopResult
      const [pendingCheckRuns, completedCheckRuns] = checkRunLoopResult

      if (pendingStatuses.length || pendingCheckRuns.length) {
        const statusNames = pendingStatuses.map(status => status.context)
        const checkRunNames = pendingCheckRuns.map(run => run.name)

        core.info(
          `The following statuses are pending: [${statusNames.join(', ')}].`
        )
        core.info(
          `The following check runs are pending: [${checkRunNames.join(', ')}].`
        )

        core.info(
          `Waiting for ${pendingStatuses.length} statuses and ${pendingCheckRuns.length} check runs to complete, checking again in ${intervalSeconds} seconds.`
        )

        await wait(intervalSeconds)

        elapsedSeconds += intervalSeconds

        continue
      }

      const failedStatuses = completedStatuses
        .filter(isStatusFailed)
        .map(status => status.context)

      const failedCheckRuns = completedCheckRuns
        .filter(isCheckRunFailed)
        .map(run => run.name)

      if (failedStatuses.length) {
        core.setFailed(
          `The following statuses have failed: [${failedStatuses.join(', ')}].`
        )
      }

      if (failedCheckRuns.length) {
        core.setFailed(
          `The following check runs have failed: [${failedCheckRuns.join(
            ', '
          )}].`
        )
      }

      core.info('All statuses and check runs have completed.')

      return
    }
  } while (elapsedSeconds < timeoutSeconds)

  if (useRequiredChecksMode) {
    // Provide more specific timeout message for required checks mode
    const result = await requiredCheckRunLoopIteration(
      octokit,
      sha,
      requiredCheckRuns
    )
    if (result.missing.length > 0) {
      core.setFailed(
        `Action timed out after ${timeoutSeconds} seconds. The following required check runs never appeared: [${result.missing.join(
          ', '
        )}].`
      )
    } else if (result.pending.length > 0) {
      core.setFailed(
        `Action timed out after ${timeoutSeconds} seconds. The following required check runs are still pending: [${result.pending.join(
          ', '
        )}].`
      )
    } else {
      core.setFailed(`Action timed out after ${timeoutSeconds} seconds.`)
    }
  } else {
    core.setFailed(`Action timed out after ${timeoutSeconds} seconds.`)
  }
}

async function combinedStatusLoopIteration(
  octokit: Octokit,
  sha: string,
  regex: RegExp
): Promise<[PendingStatus[], CompletedStatus[]]> {
  const combinedStatusIterator = octokit.paginate.iterator(
    octokit.rest.repos.getCombinedStatusForRef,
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref: sha
    }
  )

  let totalStatuses = 0
  let filteredStatuses = 0

  const pendingStatuses: PendingStatus[] = []
  const completedStatuses: CompletedStatus[] = []

  for await (const response of combinedStatusIterator) {
    totalStatuses += response.data.statuses.length

    for (const status of response.data.statuses) {
      if (!regex.test(status.context)) {
        continue
      }

      filteredStatuses++

      if (isStatusPending(status)) {
        pendingStatuses.push(status)
      } else {
        completedStatuses.push(status)
      }
    }
  }

  core.info(
    `Found ${totalStatuses} total statuses, keeping ${filteredStatuses}.`
  )

  return [pendingStatuses, completedStatuses]
}

async function checkRunLoopIteration(
  octokit: Octokit,
  sha: string,
  regex: RegExp
): Promise<[PendingCheckRun[], CompletedCheckRun[]]> {
  const checkRunsIterator = octokit.paginate.iterator(
    octokit.rest.checks.listForRef,
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref: sha
    }
  )

  let totalCheckRuns = 0

  // Track check runs by name, keeping only the most recent (highest ID) for each name.
  // GitHub's Check Runs API can return multiple check runs with the same name
  // (e.g., due to re-runs), and the order is not guaranteed to be deterministic.
  const checkRunsByName = new Map<string, CheckRun>()

  for await (const response of checkRunsIterator) {
    totalCheckRuns += response.data.length

    for (const checkRun of response.data) {
      if (!regex.test(checkRun.name)) {
        continue
      }

      const existing = checkRunsByName.get(checkRun.name)
      // Only update if this check run has a higher ID (more recent)
      if (!existing || checkRun.id > existing.id) {
        checkRunsByName.set(checkRun.name, checkRun)
      }
    }
  }

  const pendingCheckRuns: PendingCheckRun[] = []
  const completedCheckRuns: CompletedCheckRun[] = []

  for (const checkRun of checkRunsByName.values()) {
    if (isCheckRunCompleted(checkRun)) {
      completedCheckRuns.push(checkRun)
    } else {
      pendingCheckRuns.push(checkRun)
    }
  }

  core.info(
    `Found ${totalCheckRuns} total check runs, keeping ${checkRunsByName.size} unique.`
  )

  return [pendingCheckRuns, completedCheckRuns]
}

// Only run main() when not in test environment
if (process.env.NODE_ENV !== 'test') {
  try {
    // eslint-disable-next-line github/no-then
    main().catch(err => {
      core.setFailed(err)
    })
  } catch (err) {
    core.setFailed(String(err))
  }
}
