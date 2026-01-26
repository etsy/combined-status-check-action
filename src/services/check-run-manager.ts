import * as core from '@actions/core'
import * as github from '@actions/github'
import {
  Octokit,
  CheckRunMetadata,
  EvaluationResult,
  EvaluationConclusion
} from '../utils/types'

const METADATA_MARKER = '<!-- combined-status-check-metadata:'
const METADATA_MARKER_END = ':metadata-end -->'

/**
 * Encode metadata into a format that can be stored in the check run output.
 */
export function encodeMetadata(metadata: CheckRunMetadata): string {
  const json = JSON.stringify(metadata)
  return `${METADATA_MARKER}${json}${METADATA_MARKER_END}`
}

/**
 * Decode metadata from the check run output.
 * Returns null if no valid metadata is found.
 */
export function decodeMetadata(text: string | null): CheckRunMetadata | null {
  if (!text) {
    return null
  }

  const startIndex = text.indexOf(METADATA_MARKER)
  if (startIndex === -1) {
    return null
  }

  const jsonStart = startIndex + METADATA_MARKER.length
  const endIndex = text.indexOf(METADATA_MARKER_END, jsonStart)
  if (endIndex === -1) {
    return null
  }

  const json = text.substring(jsonStart, endIndex)
  try {
    return JSON.parse(json) as CheckRunMetadata
  } catch {
    core.warning(`Failed to parse check run metadata: ${json}`)
    return null
  }
}

/**
 * Create a new check run in "in_progress" status with metadata.
 * Returns the check run ID.
 */
export async function createCheckRun(
  octokit: Octokit,
  sha: string,
  name: string,
  metadata: CheckRunMetadata
): Promise<number> {
  const metadataText = encodeMetadata(metadata)

  const response = await octokit.rest.checks.create({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    name,
    head_sha: sha,
    status: 'in_progress',
    started_at: new Date(metadata.startTime).toISOString(),
    output: {
      title: 'Waiting for checks to complete',
      summary: 'Monitoring required checks...',
      text: metadataText
    }
  })

  core.info(
    `Created check run "${name}" (ID: ${response.data.id}) for SHA ${sha}`
  )
  return response.data.id
}

/**
 * Update an existing check run with new status and conclusion.
 */
export async function updateCheckRun(
  octokit: Octokit,
  checkRunId: number,
  result: EvaluationResult,
  metadata?: CheckRunMetadata
): Promise<void> {
  const metadataText = metadata ? encodeMetadata(metadata) : undefined

  // Map our conclusion to GitHub's check run conclusion
  const isComplete = result.conclusion !== 'in_progress'
  const status = isComplete ? 'completed' : 'in_progress'
  const conclusion = isComplete
    ? mapConclusion(
        result.conclusion as Exclude<EvaluationConclusion, 'in_progress'>
      )
    : undefined

  await octokit.rest.checks.update({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    check_run_id: checkRunId,
    status,
    conclusion,
    completed_at: isComplete ? new Date().toISOString() : undefined,
    output: {
      title: result.summary,
      summary: result.details || result.summary,
      text: metadataText
    }
  })

  core.info(
    `Updated check run ID ${checkRunId}: ${status}${
      conclusion ? ` (${conclusion})` : ''
    }`
  )
}

/**
 * Map our internal conclusion to GitHub's check run conclusion.
 */
function mapConclusion(
  conclusion: Exclude<EvaluationConclusion, 'in_progress'>
): 'success' | 'failure' | 'timed_out' {
  return conclusion
}

/**
 * Find our check run for a given SHA.
 * Returns the most recent (highest ID) check run with our name.
 */
export async function findOurCheckRun(
  octokit: Octokit,
  sha: string,
  checkRunName: string
): Promise<{id: number; metadata: CheckRunMetadata | null} | null> {
  const checkRunsIterator = octokit.paginate.iterator(
    octokit.rest.checks.listForRef,
    {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      ref: sha,
      check_name: checkRunName
    }
  )

  let latestCheckRun: {id: number; text: string | null} | null = null

  for await (const response of checkRunsIterator) {
    for (const checkRun of response.data) {
      if (checkRun.name === checkRunName) {
        if (!latestCheckRun || checkRun.id > latestCheckRun.id) {
          latestCheckRun = {
            id: checkRun.id,
            text: checkRun.output?.text ?? null
          }
        }
      }
    }
  }

  if (!latestCheckRun) {
    return null
  }

  const metadata = decodeMetadata(latestCheckRun.text)
  return {
    id: latestCheckRun.id,
    metadata
  }
}

/**
 * Find all our in-progress check runs across all open PRs.
 * Used by the scheduled timeout handler.
 */
export async function findInProgressCheckRuns(
  octokit: Octokit,
  checkRunName: string
): Promise<
  {
    checkRunId: number
    sha: string
    prNumber: number
    metadata: CheckRunMetadata | null
  }[]
> {
  const results: {
    checkRunId: number
    sha: string
    prNumber: number
    metadata: CheckRunMetadata | null
  }[] = []

  // List all open PRs
  const prsIterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    state: 'open'
  })

  for await (const prResponse of prsIterator) {
    for (const pr of prResponse.data) {
      const sha = pr.head.sha

      // Find our check run for this PR's HEAD SHA
      const checkRun = await findOurCheckRun(octokit, sha, checkRunName)
      if (checkRun) {
        // Check if it's still in_progress by looking at the status
        const checkRunsResponse = await octokit.rest.checks.listForRef({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          ref: sha,
          check_name: checkRunName
        })

        const ourRun = checkRunsResponse.data.check_runs.find(
          r => r.id === checkRun.id
        )
        if (ourRun && ourRun.status === 'in_progress') {
          results.push({
            checkRunId: checkRun.id,
            sha,
            prNumber: pr.number,
            metadata: checkRun.metadata
          })
        }
      }
    }
  }

  return results
}
