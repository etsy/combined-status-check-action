import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  Octokit,
  CheckRun,
  RequiredCheckRunResult,
  PendingStatus,
  CompletedStatus,
  PendingCheckRun,
  CompletedCheckRun,
  isStatusPending,
  isCheckRunCompleted,
  isStatusFailed,
  isCheckRunFailed,
  EvaluationResult,
  CheckRunMetadata
} from '../utils/types'

/**
 * Fetch check runs and categorize them by required check status.
 */
export async function evaluateRequiredCheckRuns(
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

/**
 * Fetch and filter statuses based on regex.
 */
export async function evaluateStatuses(
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

/**
 * Fetch and filter check runs based on regex.
 */
export async function evaluateCheckRuns(
  octokit: Octokit,
  sha: string,
  regex: RegExp,
  excludeCheckRunName?: string
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
      // Skip our own check run
      if (excludeCheckRunName && checkRun.name === excludeCheckRunName) {
        continue
      }

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

/**
 * Check if the timeout has been exceeded based on metadata.
 */
export function isTimedOut(metadata: CheckRunMetadata): boolean {
  const deadline = metadata.startTime + metadata.timeoutSeconds * 1000
  return Date.now() > deadline
}

/**
 * Evaluate all checks and return the result.
 * This is the main evaluation function that determines the final conclusion.
 */
export async function evaluateChecks(
  octokit: Octokit,
  sha: string,
  metadata: CheckRunMetadata,
  ourCheckRunName: string
): Promise<EvaluationResult> {
  // Check timeout first (hybrid approach - immediate timeout detection)
  if (isTimedOut(metadata)) {
    const elapsed = Math.floor((Date.now() - metadata.startTime) / 1000)
    return {
      conclusion: 'timed_out',
      summary: `Timed out after ${elapsed} seconds (timeout: ${metadata.timeoutSeconds}s)`,
      details: 'The required checks did not complete within the timeout period.'
    }
  }

  if (metadata.mode === 'required-check-runs') {
    const requiredChecks = new Set(metadata.requiredChecks || [])
    const result = await evaluateRequiredCheckRuns(octokit, sha, requiredChecks)

    // Fail immediately if any required checks have failed
    if (result.failed.length > 0) {
      return {
        conclusion: 'failure',
        summary: `Required checks failed: ${result.failed.join(', ')}`,
        details: formatRequiredChecksDetails(result)
      }
    }

    // Still waiting if there are pending or missing checks
    if (result.pending.length > 0 || result.missing.length > 0) {
      return {
        conclusion: 'in_progress',
        summary: formatPendingSummary(result),
        details: formatRequiredChecksDetails(result)
      }
    }

    // All checks succeeded
    return {
      conclusion: 'success',
      summary: `All ${requiredChecks.size} required checks passed`,
      details: formatRequiredChecksDetails(result)
    }
  } else {
    // Regex mode
    const statusRegex = new RegExp(metadata.statusRegex || '^.*$')
    const checkRunRegex = new RegExp(metadata.checkRunRegex || '^.*$')

    const [
      [pendingStatuses, completedStatuses],
      [pendingCheckRuns, completedCheckRuns]
    ] = await Promise.all([
      evaluateStatuses(octokit, sha, statusRegex),
      evaluateCheckRuns(octokit, sha, checkRunRegex, ourCheckRunName)
    ])

    // Check for pending items
    if (pendingStatuses.length > 0 || pendingCheckRuns.length > 0) {
      const pendingStatusNames = pendingStatuses.map(s => s.context)
      const pendingCheckRunNames = pendingCheckRuns.map(r => r.name)
      return {
        conclusion: 'in_progress',
        summary: `Waiting for ${pendingStatuses.length} statuses and ${pendingCheckRuns.length} check runs`,
        details: formatRegexModeDetails(
          pendingStatusNames,
          pendingCheckRunNames,
          [],
          []
        )
      }
    }

    // Check for failures
    const failedStatuses = completedStatuses.filter(isStatusFailed)
    const failedCheckRuns = completedCheckRuns.filter(isCheckRunFailed)

    if (failedStatuses.length > 0 || failedCheckRuns.length > 0) {
      const failedStatusNames = failedStatuses.map(s => s.context)
      const failedCheckRunNames = failedCheckRuns.map(r => r.name)
      return {
        conclusion: 'failure',
        summary: `${failedStatuses.length} statuses and ${failedCheckRuns.length} check runs failed`,
        details: formatRegexModeDetails(
          [],
          [],
          failedStatusNames,
          failedCheckRunNames
        )
      }
    }

    // All checks passed
    return {
      conclusion: 'success',
      summary: `All ${completedStatuses.length} statuses and ${completedCheckRuns.length} check runs passed`
    }
  }
}

function formatPendingSummary(result: RequiredCheckRunResult): string {
  const parts: string[] = []
  if (result.pending.length > 0) {
    parts.push(`${result.pending.length} pending`)
  }
  if (result.missing.length > 0) {
    parts.push(`${result.missing.length} missing`)
  }
  return `Waiting for checks: ${parts.join(', ')}`
}

function formatRequiredChecksDetails(result: RequiredCheckRunResult): string {
  const lines: string[] = []
  if (result.succeeded.length > 0) {
    lines.push(`Succeeded: ${result.succeeded.join(', ')}`)
  }
  if (result.pending.length > 0) {
    lines.push(`Pending: ${result.pending.join(', ')}`)
  }
  if (result.missing.length > 0) {
    lines.push(`Missing: ${result.missing.join(', ')}`)
  }
  if (result.failed.length > 0) {
    lines.push(`Failed: ${result.failed.join(', ')}`)
  }
  return lines.join('\n')
}

function formatRegexModeDetails(
  pendingStatuses: string[],
  pendingCheckRuns: string[],
  failedStatuses: string[],
  failedCheckRuns: string[]
): string {
  const lines: string[] = []
  if (pendingStatuses.length > 0) {
    lines.push(`Pending statuses: ${pendingStatuses.join(', ')}`)
  }
  if (pendingCheckRuns.length > 0) {
    lines.push(`Pending check runs: ${pendingCheckRuns.join(', ')}`)
  }
  if (failedStatuses.length > 0) {
    lines.push(`Failed statuses: ${failedStatuses.join(', ')}`)
  }
  if (failedCheckRuns.length > 0) {
    lines.push(`Failed check runs: ${failedCheckRuns.join(', ')}`)
  }
  return lines.join('\n')
}
