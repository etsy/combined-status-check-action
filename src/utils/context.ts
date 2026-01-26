import * as github from '@actions/github'
// eslint-disable-next-line import/no-unresolved
import {PullRequestEvent, CheckRunEvent} from '@octokit/webhooks-types'
import {Octokit} from './types'

/**
 * Extract the commit SHA from the current GitHub context.
 */
export function getSHAFromContext(ctx: typeof github.context): string {
  if (ctx.eventName === 'pull_request') {
    const pullRequestEvent = ctx.payload as PullRequestEvent
    return pullRequestEvent.pull_request.head.sha
  } else if (ctx.eventName === 'check_run') {
    const checkRunEvent = ctx.payload as CheckRunEvent
    return checkRunEvent.check_run.head_sha
  } else {
    return ctx.sha
  }
}

/**
 * Extract the branch name from the current GitHub context.
 * Returns null if the branch cannot be determined (e.g., for tag events).
 */
export function getBranchFromContext(
  ctx: typeof github.context
): string | null {
  if (ctx.eventName === 'pull_request') {
    const pullRequestEvent = ctx.payload as PullRequestEvent
    return pullRequestEvent.pull_request.head.ref
  } else if (ctx.eventName === 'check_run') {
    const checkRunEvent = ctx.payload as CheckRunEvent
    // check_run events include the branch in check_run.check_suite.head_branch
    return checkRunEvent.check_run.check_suite?.head_branch ?? null
  } else if (ctx.ref && ctx.ref.startsWith('refs/heads/')) {
    // Extract branch name from ref like "refs/heads/feature/my-branch"
    return ctx.ref.substring('refs/heads/'.length)
  } else {
    // For other event types (tags, etc.), return null
    return null
  }
}

/**
 * Get the pull request number from the current GitHub context.
 * Returns null if not in a pull request context.
 */
export function getPullRequestNumberFromContext(
  ctx: typeof github.context
): number | null {
  if (ctx.eventName === 'pull_request') {
    const pullRequestEvent = ctx.payload as PullRequestEvent
    return pullRequestEvent.pull_request.number
  }
  return null
}

/**
 * Information about a pull request associated with a check run.
 */
export interface PullRequestInfo {
  number: number
  headSha: string
  headRef: string
}

/**
 * Get pull requests associated with a check_run event.
 * The check_run payload includes a pull_requests array, but it may be empty
 * for cross-fork PRs. Falls back to API lookup if needed.
 */
export async function getPullRequestsForCheckRun(
  octokit: Octokit,
  ctx: typeof github.context
): Promise<PullRequestInfo[]> {
  if (ctx.eventName !== 'check_run') {
    return []
  }

  const checkRunEvent = ctx.payload as CheckRunEvent
  const pullRequests = checkRunEvent.check_run.pull_requests

  // If the payload includes pull requests, use them
  if (pullRequests && pullRequests.length > 0) {
    return pullRequests.map(pr => ({
      number: pr.number,
      headSha: checkRunEvent.check_run.head_sha,
      headRef: pr.head.ref
    }))
  }

  // Fallback: query the API to find PRs associated with this SHA
  const sha = checkRunEvent.check_run.head_sha
  return getPullRequestsForSha(octokit, sha)
}

/**
 * Find pull requests associated with a given commit SHA.
 */
export async function getPullRequestsForSha(
  octokit: Octokit,
  sha: string
): Promise<PullRequestInfo[]> {
  try {
    const response =
      await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        commit_sha: sha
      })

    return response.data.map(pr => ({
      number: pr.number,
      headSha: pr.head.sha,
      headRef: pr.head.ref
    }))
  } catch (error) {
    // If we can't find PRs, return empty array
    return []
  }
}

/**
 * Check if the current check_run event is a self-trigger
 * (i.e., triggered by our own check run completing).
 */
export function isSelfTrigger(
  ctx: typeof github.context,
  ourCheckRunName: string
): boolean {
  if (ctx.eventName !== 'check_run') {
    return false
  }

  const checkRunEvent = ctx.payload as CheckRunEvent
  return checkRunEvent.check_run.name === ourCheckRunName
}

/**
 * Get the action type from the payload (e.g., 'opened', 'synchronize', 'completed').
 */
export function getEventAction(ctx: typeof github.context): string | undefined {
  return ctx.payload.action
}
