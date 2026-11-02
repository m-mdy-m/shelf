# Reader compatibility and performance baseline

## Reproduction

Run the repository test suite with the pinned Node.js and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm test
```

The PDF corpus is generated deterministically from
`tests/fixtures/pdf/create-corpus.mjs` and parsed by the locked PDF.js dependency.
The end-to-end test records its timing in CI output with the prefix
`[reader-performance-baseline]`.

## Large-document viewport baseline

The baseline scenario constructs a 50,000-page virtual document and requests
1,000 viewport windows at a fixed scale. It records elapsed wall-clock time,
average and maximum mounted pages, and the configured mounted-page limit (10).

The mounted-page count is the stable invariant. Wall-clock time is recorded as an
observation, not a pass/fail budget, because GitHub-hosted runner hardware and
scheduling vary. Do not set a hard latency threshold until repeated runs on
representative desktop and mobile hardware have been collected.

## Other bounded operations

The suite also covers:

- one PDF source read no larger than 1 MiB;
- text extraction capped at 50,000 text items and 500,000 characters per page;
- a 24-page extracted-text cache and a 24-page-handle cache;
- local search bounded by 2,000 pages, 2,000,000 indexed characters, 100 matches,
  and 256 query characters;
- at most 500 transient interaction markers per page;
- cancelled PDF.js text streams and bounded outline lookup concurrency.

These are implementation limits and regression assertions, not yet measured
cross-device performance service-level objectives.
