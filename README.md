# combined-status-check-action

This action allows you to combine a bunch of individual status checks into one required check. This is useful for third-party statuses that may be dynamically created, and would be tedious to require individually.

## Usage

```yaml
- uses: etsy/combined-status-check@v1
  with:
    status-regex: "^Some Third Party"
```

See [`action.yml`](./action.yml) for all available options.
