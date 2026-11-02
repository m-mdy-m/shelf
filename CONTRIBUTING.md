# Contributing

Read [spec/README.md](spec/README.md) before implementation. The first delivery is the PDF Reader. Keep domain/application contracts independent from React, PDF.js internals, storage engines, and native APIs.

## Git flow
Shelf uses [m-mdy-m/gix](https://github.com/m-mdy-m/gix) with `main` and `develop` base branches.

- `gix feature start <name>` — work from `develop`.
- `gix bugfix start <name>` — fixes based on `develop`.
- `gix hotfix start <name>` — urgent production fixes based on `main`.
- `gix release start <version>` — release preparation.

Finish topic branches with the matching `gix ... finish` command. Do not merge feature work directly into `main`; open a PR and link the related Issue.

## Checks
Install pnpm 12.17.0 and the pinned shared task runner with `make setup`; run `make check` / `make ci`. Use `psx check` for structure and `gix doctor` for flow diagnostics. Install dependencies with `pnpm install --frozen-lockfile`.

## Pull requests
Keep PRs focused. Link the Issue and list only the checks and platforms actually tested.
