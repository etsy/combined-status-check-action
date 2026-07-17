# combined-status-check-action

This action allows you to combine a bunch of individual status checks into one required check. This is useful for third-party statuses that may be dynamically created, and would be tedious to require individually.

## Usage

### Using regex patterns (original mode)

Filter checks by regex pattern - useful for dynamically named checks:

```yaml
- uses: etsy/combined-status-check@v2
  with:
    status-regex: "^Some Third Party"
```

### Using required check runs (explicit mode)

Specify exact check run names that must all appear and succeed:

```yaml
- uses: etsy/combined-status-check@v2
  with:
    required-check-runs: |
      build
      test
      lint
    timeout-seconds: 120
```

This mode:
- Uses exact name matching (not regex)
- Fails if any required check never appears (after timeout)
- Fails immediately if any required check fails
- Cannot be combined with a custom `check-run-regex` or `status-regex`

### Auto-pass for trusted branches

Skip all status checks for branches with a specific prefix:

```yaml
- uses: etsy/combined-status-check@v2
  with:
    auto-pass-branch-prefix: "grimoire-"
    required-check-runs: |
      build
      test
      lint
```

This mode:
- Automatically passes when the branch name starts with the configured prefix (case-sensitive)
- Bypasses all status check validation entirely
- Useful for trusted automated branches that should always pass
- Can be combined with any other mode (regex or required-check-runs)
- Leave empty to disable (default behavior)

**⚠️ Security Note:** This feature completely skips all status checks. Only use it with trusted automated systems where you have full control over branch creation.

See [`action.yml`](./action.yml) for all available options.
