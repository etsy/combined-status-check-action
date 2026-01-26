import * as core from '@actions/core'
import {ActionInputs, Octokit} from '../utils/types'
import {
  findInProgressCheckRuns,
  updateCheckRun
} from '../services/check-run-manager'
import {isTimedOut, evaluateChecks} from '../services/check-evaluator'

/**
 * Handle scheduled events for timeout enforcement.
 *
 * This handler:
 * 1. Lists all open PRs
 * 2. For each PR, finds our in-progress check runs
 * 3. Checks if any have exceeded their timeout
 * 4. Marks timed-out checks as completed with 'timed_out' conclusion
 *
 * This acts as a safety net for cases where no check_run.completed events
 * fire (e.g., all checks are stuck in pending state).
 */
export async function handleScheduledTimeout(
  octokit: Octokit,
  inputs: ActionInputs
): Promise<void> {
  core.info('Handling scheduled timeout check...')

  // Find all in-progress check runs
  const inProgressRuns = await findInProgressCheckRuns(
    octokit,
    inputs.checkRunName
  )

  if (inProgressRuns.length === 0) {
    core.info('No in-progress check runs found. Nothing to do.')
    return
  }

  core.info(`Found ${inProgressRuns.length} in-progress check run(s)`)

  let timedOutCount = 0
  let stillWaitingCount = 0

  for (const run of inProgressRuns) {
    if (!run.metadata) {
      core.warning(
        `Check run ID ${run.checkRunId} for PR #${run.prNumber} has no metadata. Skipping.`
      )
      continue
    }

    if (isTimedOut(run.metadata)) {
      // This check run has timed out
      const elapsed = Math.floor((Date.now() - run.metadata.startTime) / 1000)
      core.info(
        `Check run ID ${run.checkRunId} for PR #${run.prNumber} has timed out ` +
          `(${elapsed}s elapsed, timeout: ${run.metadata.timeoutSeconds}s)`
      )

      // Do a final evaluation to get the current state for the summary
      const result = await evaluateChecks(
        octokit,
        run.sha,
        run.metadata,
        inputs.checkRunName
      )

      // The evaluateChecks already returns timed_out when timeout is exceeded
      await updateCheckRun(octokit, run.checkRunId, result, run.metadata)
      timedOutCount++
    } else {
      const elapsed = Math.floor((Date.now() - run.metadata.startTime) / 1000)
      const remaining = run.metadata.timeoutSeconds - elapsed
      core.info(
        `Check run ID ${run.checkRunId} for PR #${run.prNumber} is still within timeout ` +
          `(${elapsed}s elapsed, ${remaining}s remaining)`
      )
      stillWaitingCount++
    }
  }

  core.info(
    `Scheduled timeout check complete: ${timedOutCount} timed out, ${stillWaitingCount} still waiting`
  )
}
