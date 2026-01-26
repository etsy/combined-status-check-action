import * as core from '@actions/core'
import * as github from '@actions/github'
import {ActionInputs, CheckRunMetadata, Octokit} from '../utils/types'
import {getSHAFromContext, getBranchFromContext} from '../utils/context'
import {createCheckRun, updateCheckRun} from '../services/check-run-manager'
import {evaluateChecks} from '../services/check-evaluator'

/**
 * Handle pull_request events (opened, synchronize, reopened).
 *
 * This handler:
 * 1. Checks for auto-pass branch prefix
 * 2. Creates an "in_progress" check run with metadata
 * 3. Optionally performs initial evaluation (for cases where checks already exist)
 */
export async function handlePullRequest(
  octokit: Octokit,
  inputs: ActionInputs
): Promise<void> {
  const sha = getSHAFromContext(github.context)
  const branchName = getBranchFromContext(github.context)

  core.info(`Handling pull_request event for SHA ${sha}`)

  // Check for auto-pass branch prefix
  if (inputs.autoPassBranchPrefix && branchName) {
    core.info(`Detected branch: ${branchName}`)

    if (branchName.startsWith(inputs.autoPassBranchPrefix)) {
      core.info(
        `Branch '${branchName}' starts with auto-pass prefix '${inputs.autoPassBranchPrefix}'. ` +
          `Creating successful check run without evaluating other checks.`
      )

      // Create a successful check run immediately
      await createAutoPassCheckRun(octokit, sha, inputs, branchName)
      return
    } else {
      core.info(
        `Branch '${branchName}' does not match auto-pass prefix '${inputs.autoPassBranchPrefix}'. ` +
          `Proceeding with normal check evaluation.`
      )
    }
  } else if (inputs.autoPassBranchPrefix && !branchName) {
    core.info(
      `Could not determine branch name for event type '${github.context.eventName}'. ` +
        `Proceeding with normal check evaluation.`
    )
  }

  // Determine the evaluation mode
  const useRequiredChecksMode = inputs.requiredCheckRuns.size > 0

  if (useRequiredChecksMode) {
    core.info(
      `Using required-check-runs mode with ${
        inputs.requiredCheckRuns.size
      } required checks: [${[...inputs.requiredCheckRuns].join(', ')}]`
    )
  } else {
    core.info('Using regex mode for check evaluation')
  }

  // Create metadata for the check run
  const metadata: CheckRunMetadata = {
    startTime: Date.now(),
    timeoutSeconds: inputs.timeoutSeconds,
    mode: useRequiredChecksMode ? 'required-check-runs' : 'regex',
    requiredChecks: useRequiredChecksMode
      ? [...inputs.requiredCheckRuns]
      : undefined,
    statusRegex: useRequiredChecksMode ? undefined : inputs.statusRegex,
    checkRunRegex: useRequiredChecksMode ? undefined : inputs.checkRunRegex
  }

  // Create the check run
  const checkRunId = await createCheckRun(
    octokit,
    sha,
    inputs.checkRunName,
    metadata
  )

  // Perform initial evaluation
  // This handles cases where checks from a previous push already exist
  core.info('Performing initial evaluation...')

  const result = await evaluateChecks(
    octokit,
    sha,
    metadata,
    inputs.checkRunName
  )

  if (result.conclusion !== 'in_progress') {
    // We have a final result already
    await updateCheckRun(octokit, checkRunId, result, metadata)
    core.info(`Initial evaluation complete: ${result.conclusion}`)

    if (result.conclusion === 'failure' || result.conclusion === 'timed_out') {
      core.setFailed(result.summary)
    }
  } else {
    // Still waiting for checks
    await updateCheckRun(octokit, checkRunId, result, metadata)
    core.info(
      `Initial evaluation: still waiting. Check run will be updated when checks complete.`
    )
  }
}

/**
 * Create a successful check run for auto-pass branches.
 */
async function createAutoPassCheckRun(
  octokit: Octokit,
  sha: string,
  inputs: ActionInputs,
  branchName: string
): Promise<void> {
  await octokit.rest.checks.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    name: inputs.checkRunName,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    output: {
      title: 'Auto-passed',
      summary: `Branch '${branchName}' matches auto-pass prefix '${inputs.autoPassBranchPrefix}'`,
      text: `This check was automatically passed because the branch name starts with the configured auto-pass prefix.`
    }
  })

  core.info(`Created auto-pass check run for branch '${branchName}'`)
}
