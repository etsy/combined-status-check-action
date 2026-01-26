import * as github from '@actions/github'
import {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods'

// Octokit type
export type Octokit = ReturnType<typeof github.getOctokit>

// GitHub API types
export type Status =
  RestEndpointMethodTypes['repos']['getCombinedStatusForRef']['response']['data']['statuses'][0]
export type CheckRun =
  RestEndpointMethodTypes['checks']['listForRef']['response']['data']['check_runs'][0]

// Status subtypes
export type PendingStatus = Status & {state: 'pending'}
export type CompletedStatus = Status & {state: string}
export type FailedStatus = CompletedStatus & {state: 'error' | 'failure'}

// Check run subtypes
export type PendingCheckRun = CheckRun & {status: string}
export type CompletedCheckRun = CheckRun & {status: 'completed'}
export type FailedCheckRun = CompletedCheckRun & {
  conclusion: 'cancelled' | 'failure' | 'timed_out'
}

// Type guards
export function isStatusPending(status: Status): status is PendingStatus {
  return status.state === 'pending'
}

export function isStatusFailed(
  status: CompletedStatus
): status is FailedStatus {
  return status.state === 'error' || status.state === 'failure'
}

export function isCheckRunCompleted(run: CheckRun): run is CompletedCheckRun {
  return run.status === 'completed'
}

export function isCheckRunFailed(
  run: CompletedCheckRun
): run is FailedCheckRun {
  return (
    run.conclusion === 'cancelled' ||
    run.conclusion === 'failure' ||
    run.conclusion === 'timed_out'
  )
}

// Required check run evaluation result
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

// Regex mode evaluation result
export interface RegexModeResult {
  pendingStatuses: PendingStatus[]
  completedStatuses: CompletedStatus[]
  pendingCheckRuns: PendingCheckRun[]
  completedCheckRuns: CompletedCheckRun[]
}

// Evaluation mode
export type EvaluationMode = 'required-check-runs' | 'regex'

// Check run metadata stored in output.text
export interface CheckRunMetadata {
  startTime: number
  timeoutSeconds: number
  mode: EvaluationMode
  requiredChecks?: string[]
  statusRegex?: string
  checkRunRegex?: string
}

// Parsed action inputs
export interface ActionInputs {
  token: string
  checkRunName: string
  timeoutSeconds: number
  statusRegex: string
  checkRunRegex: string
  requiredCheckRuns: Set<string>
  autoPassBranchPrefix: string
  // Deprecated inputs (kept for compatibility)
  initialDelaySeconds: number
  intervalSeconds: number
}

// Evaluation result types
export type EvaluationConclusion =
  | 'success'
  | 'failure'
  | 'timed_out'
  | 'in_progress'

export interface EvaluationResult {
  conclusion: EvaluationConclusion
  summary: string
  details?: string
}
