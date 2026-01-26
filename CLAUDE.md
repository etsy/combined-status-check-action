# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Action (TypeScript) that combines multiple status checks into one required check. It polls GitHub's status and check run APIs to monitor a PR/commit's checks, waiting for them to complete before marking the combined check as passed or failed.

## Build, Test, and Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run tests
npm test

# Run all checks (build, format, lint, test, package)
npm run all

# Format code
npm run format

# Check formatting without modifying files
npm run format-check

# Lint code
npm run lint

# Package action for distribution (uses @vercel/ncc)
npm run package
```

### Running a Single Test

Jest is configured to run tests matching `**/*.test.ts`. To run a single test file or test case:

```bash
# Run a specific test file
npx jest src/main.test.ts

# Run tests matching a pattern
npx jest -t "parseRequiredCheckRuns"

# Run tests in watch mode
npx jest --watch
```

## Architecture

### Core Components

**`src/main.ts`**: Single main file containing all logic (~550 lines)
- Entry point: `main()` function (runs unless `NODE_ENV=test`)
- Two operational modes controlled by inputs:
  - **Regex mode**: Uses `status-regex` and `check-run-regex` to filter checks
  - **Required checks mode**: Uses `required-check-runs` for explicit check names (mutually exclusive with custom regex)

### Key Functions

- **`main()`**: Entry point that reads inputs, validates them, and delegates to the polling loop
- **`loop()`**: Main polling loop that checks status/check runs at intervals until timeout or completion
  - Branches behavior based on `requiredCheckRuns.size > 0`
- **`requiredCheckRunLoopIteration()`**: Fetches and categorizes required checks into succeeded/pending/failed/missing
- **`combinedStatusLoopIteration()`**: Fetches GitHub commit statuses (for regex mode)
- **`checkRunLoopIteration()`**: Fetches GitHub check runs (for regex mode)
- **`getBranchFromContext()`**: Extracts branch name from PR or push events (supports auto-pass feature)
- **`parseRequiredCheckRuns()`**: Parses newline-separated check names into a Set
- **`validateInputs()`**: Ensures required-check-runs isn't used with custom regexes

### Check Run Deduplication Strategy

Both `requiredCheckRunLoopIteration()` and `checkRunLoopIteration()` deduplicate check runs by name, keeping only the **highest ID** (most recent) for each name. This handles GitHub's re-run behavior where multiple check runs with the same name can exist.

### Auto-Pass Branch Prefix Feature

The `auto-pass-branch-prefix` input allows bypassing all status checks for branches starting with a specific prefix (e.g., `grimoire-`). When enabled:
1. Branch name is extracted via `getBranchFromContext()`
2. If branch starts with prefix (case-sensitive), action exits successfully immediately
3. Security note: Only use with trusted automated systems

## Action Inputs (action.yml)

- **`token`**: GitHub token (defaults to `${{ github.token }}`)
- **`initial-delay-seconds`**: Wait time before first check (default: 10)
- **`interval-seconds`**: Polling interval (default: 2)
- **`timeout-seconds`**: Max wait time (default: 300)
- **`status-regex`**: Filter statuses by context (default: `^.*$`)
- **`check-run-regex`**: Filter check runs by name (default: `^.*$`)
- **`required-check-runs`**: Newline-separated list of required check names (cannot be used with custom regexes)
- **`auto-pass-branch-prefix`**: Branch prefix for auto-success (default: empty/disabled)

## Testing Approach

Tests in `src/main.test.ts` use:
- Jest with ts-jest transformer
- Fake timers (`jest.useFakeTimers()`) to avoid actual delays in tests
- Mocked `@actions/core` and `@actions/github` modules
- Mocked Octokit paginated iterators for API responses

Key test coverage:
- Input parsing and validation
- Branch extraction from various GitHub event types
- Auto-pass integration tests with different branch scenarios
- Required check run result categorization

## GitHub API Usage

Uses `@actions/github` (Octokit) with pagination:
- **`repos.getCombinedStatusForRef`**: Fetches commit statuses
- **`checks.listForRef`**: Fetches check runs for a ref/SHA

Pagination is handled with `octokit.paginate.iterator()` to avoid loading all results into memory.

## Distribution

The action runs using `dist/index.js` (compiled by `@vercel/ncc`). After making changes:
1. Run `npm run all` to build, test, format, lint, and package
2. Commit the updated `dist/` directory
3. The `dist/` directory is tracked in git (not in .gitignore)
