import * as core from '@actions/core'
import * as github from '@actions/github'
import {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods'
import {PullRequestEvent} from '@octokit/webhooks-types'

type Status = RestEndpointMethodTypes['repos']['getCombinedStatusForRef']['response']['data']['statuses'][0]
type CheckRun = RestEndpointMethodTypes['checks']['listForRef']['response']['data']['check_runs'][0]
type Octokit = ReturnType<typeof github.getOctokit>

async function wait(seconds: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return new Promise<void>((resolve, reject) => {
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

async function main(): Promise<void> {
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

  const statusRegex = new RegExp(
    core.getInput('status-regex', {required: true})
  )
  const checkRunRegex = new RegExp(
    core.getInput('check-run-regex', {required: true})
  )

  const sha = getSHAFromContext(github.context)

  core.info(`Executing combined-status-check-action on SHA ${sha}.`)

  const octokit = github.getOctokit(githubToken)

  core.info(`Waiting ${initialDelaySeconds} seconds for checks to start...`)

  await wait(initialDelaySeconds)

  await loop(
    octokit,
    sha,
    statusRegex,
    checkRunRegex,
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
  intervalSeconds: number,
  timeoutSeconds: number
): Promise<void> {
  let elapsedSeconds = 0

  core.info('Starting combined status check loop...')

  do {
    const [statusLoopResult, checkRunLoopResult] = await Promise.all([
      combinedStatusLoopIteration(octokit, sha, statusRegex),
      checkRunLoopIteration(octokit, sha, checkRunRegex)
    ])

    const [pendingStatuses, completedStatuses] = statusLoopResult
    const [pendingCheckRuns, completedCheckRuns] = checkRunLoopResult

    if (pendingStatuses.length || pendingCheckRuns.length) {
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
      core.error(
        `The following statuses have failed: ${failedStatuses.join(', ')}`
      )
      core.error(
        `The following check runs have failed: ${failedCheckRuns.join(', ')}`
      )

      return
    }

    core.info('All statuses and check runs have completed successfully.')
    return
  } while (elapsedSeconds < timeoutSeconds)

  core.error(`Action timed out after ${timeoutSeconds} seconds.`)
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

  let totalStatuses = 0,
    filteredStatuses = 0

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

  let totalCheckRuns = 0,
    filteredCheckRuns = 0

  const pendingCheckRuns: PendingCheckRun[] = []
  const completedCheckRuns: CompletedCheckRun[] = []

  for await (const response of checkRunsIterator) {
    totalCheckRuns += response.data.length

    for (const checkRun of response.data) {
      if (!regex.test(checkRun.name)) {
        continue
      }

      filteredCheckRuns++

      if (isCheckRunCompleted(checkRun)) {
        completedCheckRuns.push(checkRun)
      } else {
        pendingCheckRuns.push(checkRun)
      }
    }
  }

  core.info(
    `Found ${totalCheckRuns} total check runs, keeping ${filteredCheckRuns}.`
  )

  return [pendingCheckRuns, completedCheckRuns]
}

try {
  // eslint-disable-next-line github/no-then
  main().catch(err => {
    core.error(err)
  })
} catch (err) {
  core.error(String(err))
}
