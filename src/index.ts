import * as core from '@actions/core'
import * as github from '@actions/github'
import {getInputs} from './utils/inputs'
import {getEventAction} from './utils/context'
import {handlePullRequest} from './handlers/pull-request'
import {handleCheckRunCompleted} from './handlers/check-run-completed'
import {handleScheduledTimeout} from './handlers/scheduled-timeout'

/**
 * Main entry point for the combined-status-check-action.
 *
 * This action uses an event-driven architecture:
 * - pull_request events: Create an in_progress check run with metadata
 * - check_run.completed events: Re-evaluate and update our check run
 * - schedule events: Enforce timeouts for stale check runs
 */
async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const octokit = github.getOctokit(inputs.token)
    const eventName = github.context.eventName
    const action = getEventAction(github.context)

    core.info(`Event: ${eventName}${action ? ` (action: ${action})` : ''}`)

    switch (eventName) {
      case 'pull_request':
        // Handle PR opened, synchronize (new commits), or reopened
        if (
          action === 'opened' ||
          action === 'synchronize' ||
          action === 'reopened'
        ) {
          await handlePullRequest(octokit, inputs)
        } else {
          core.info(
            `Ignoring pull_request event with action "${action}". ` +
              `Only opened, synchronize, and reopened are handled.`
          )
        }
        break

      case 'check_run':
        // Handle when other check runs complete
        if (action === 'completed') {
          await handleCheckRunCompleted(octokit, inputs)
        } else {
          core.info(
            `Ignoring check_run event with action "${action}". ` +
              `Only completed is handled.`
          )
        }
        break

      case 'schedule':
        // Handle scheduled runs for timeout enforcement
        await handleScheduledTimeout(octokit, inputs)
        break

      case 'workflow_dispatch':
        // Manual trigger - run timeout check (useful for testing)
        core.info('workflow_dispatch event: running timeout check')
        await handleScheduledTimeout(octokit, inputs)
        break

      default:
        core.warning(
          `Unsupported event type: ${eventName}. ` +
            `This action supports: pull_request, check_run, schedule, workflow_dispatch`
        )
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(String(error))
    }
  }
}

// Only run when not in test environment
if (process.env.NODE_ENV !== 'test') {
  run()
}

// Export for testing
export {run}
