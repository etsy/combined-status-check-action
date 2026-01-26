import * as core from '@actions/core'
import * as github from '@actions/github'
import {ActionInputs, Octokit} from '../utils/types'
import {
  getSHAFromContext,
  isSelfTrigger,
  getPullRequestsForCheckRun
} from '../utils/context'
import {findOurCheckRun, updateCheckRun} from '../services/check-run-manager'
import {evaluateChecks} from '../services/check-evaluator'
// eslint-disable-next-line import/no-unresolved
import {CheckRunEvent} from '@octokit/webhooks-types'

/**
 * Handle check_run.completed events.
 *
 * This handler:
 * 1. Filters out self-triggers (our own check run completing)
 * 2. Finds PRs associated with the check run's SHA
 * 3. For each PR, finds our in-progress check run and re-evaluates
 * 4. Updates our check run with the new status
 */
export async function handleCheckRunCompleted(
  octokit: Octokit,
  inputs: ActionInputs
): Promise<void> {
  const sha = getSHAFromContext(github.context)
  const payload = github.context.payload as CheckRunEvent
  const completedCheckName = payload.check_run.name

  core.info(
    `Handling check_run.completed event for "${completedCheckName}" on SHA ${sha}`
  )

  // Self-trigger prevention: skip if this is our own check run
  if (isSelfTrigger(github.context, inputs.checkRunName)) {
    core.info(
      `Skipping: This is our own check run "${inputs.checkRunName}" completing.`
    )
    return
  }

  // Find PRs associated with this SHA
  const pullRequests = await getPullRequestsForCheckRun(octokit, github.context)

  if (pullRequests.length === 0) {
    core.info(`No pull requests found for SHA ${sha}. Skipping evaluation.`)
    return
  }

  core.info(
    `Found ${
      pullRequests.length
    } pull request(s) for SHA ${sha}: [${pullRequests
      .map(pr => `#${pr.number}`)
      .join(', ')}]`
  )

  // Process each PR
  for (const pr of pullRequests) {
    await processCheckRunForPR(octokit, inputs, pr.headSha, pr.number)
  }
}

/**
 * Process a check_run.completed event for a specific PR.
 */
async function processCheckRunForPR(
  octokit: Octokit,
  inputs: ActionInputs,
  sha: string,
  prNumber: number
): Promise<void> {
  core.info(`Processing check run completion for PR #${prNumber} (SHA: ${sha})`)

  // Find our check run for this SHA
  const ourCheckRun = await findOurCheckRun(octokit, sha, inputs.checkRunName)

  if (!ourCheckRun) {
    core.info(
      `No check run "${inputs.checkRunName}" found for SHA ${sha}. ` +
        `This may be a check run for a commit that we haven't processed yet.`
    )
    return
  }

  if (!ourCheckRun.metadata) {
    core.warning(
      `Check run "${inputs.checkRunName}" (ID: ${ourCheckRun.id}) has no metadata. ` +
        `Cannot evaluate without configuration.`
    )
    return
  }

  // Check if our check run is already completed
  const checkRunsResponse = await octokit.rest.checks.listForRef({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    ref: sha,
    check_name: inputs.checkRunName
  })

  const currentCheckRun = checkRunsResponse.data.check_runs.find(
    r => r.id === ourCheckRun.id
  )

  if (currentCheckRun && currentCheckRun.status === 'completed') {
    core.info(
      `Check run "${inputs.checkRunName}" (ID: ${ourCheckRun.id}) is already completed. Skipping.`
    )
    return
  }

  // Re-evaluate all checks
  core.info(
    `Re-evaluating checks for "${inputs.checkRunName}" (ID: ${ourCheckRun.id})`
  )

  const result = await evaluateChecks(
    octokit,
    sha,
    ourCheckRun.metadata,
    inputs.checkRunName
  )

  // Update our check run
  await updateCheckRun(octokit, ourCheckRun.id, result, ourCheckRun.metadata)

  if (result.conclusion === 'success') {
    core.info(`All checks passed for PR #${prNumber}`)
  } else if (result.conclusion === 'failure') {
    core.info(`Some checks failed for PR #${prNumber}: ${result.summary}`)
    // Note: We don't call core.setFailed here because this action run
    // should succeed - we're just updating the check run status
  } else if (result.conclusion === 'timed_out') {
    core.info(`Checks timed out for PR #${prNumber}: ${result.summary}`)
  } else {
    core.info(`Still waiting for checks for PR #${prNumber}: ${result.summary}`)
  }
}
