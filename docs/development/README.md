# Development

## Requirements

- Node.js **22.16.0** (see `.nvmrc`).
- npm **10.9.x**.
- Python **3.12 or newer** for the repository validation task graph.
- Git.

Go is required only when working on the local backend or the PSX/GIX tooling; the application foundation does not yet build a backend binary.

## First-time setup

From the repository root:

```sh
npm ci
```

The checked-in lockfile pins the TypeScript compiler and the web workspace. Do not use `npm install` for CI or clean-clone verification.

## Quality gates

Run the same checks locally that run in GitHub Actions:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Or run the complete sequence:

```sh
npm run ci
```

The production web shell is written to `dist/web/`. To inspect it locally, run:

```sh
python -m http.server 4173 --directory dist/web
```

Then open `http://localhost:4173`.

## Pipeline task graph

The repository-level task graph remains the entry point for project validation:

```sh
make setup
make check
make ci
```

`make setup` installs the pinned Pipeline CLI and runs `npm ci`. The Pipeline graph runs repository-manifest checks, Python script compilation, and the application quality gates.

## Architecture rules

- Keep the web shell independent of backend internals and native platform APIs.
- Keep shared packages independent of app shells and backend implementation details.
- Domain code must not import UI frameworks, PDF renderer internals, storage drivers, or platform SDKs.
- Put cross-layer communication behind typed application contracts and ports.
- Record material runtime or packaging choices as ADRs under `docs/decisions/`.

The architecture and package directories are deliberately established before feature code is added. A directory existing in the scaffold is not evidence that its feature is implemented.


## Reader data backup and restore

Shelf can export a versioned JSON backup of the portable Reader records: document
metadata, reading progress, bookmarks, highlights, notes, and quotes. Export reads
these stores in one IndexedDB readonly transaction. Restore validates the complete
bundle before opening a single readwrite transaction; a failed restore is rolled
back rather than leaving a partial library.

Backups intentionally exclude PDF bytes, browser file handles, opaque filesystem or
content-URI locators, credentials, and provider secrets. Restoring on another browser
or device restores the Reader metadata and saved work, not the underlying PDF files
or OS permissions. Re-link original files or import the PDFs again to read them.
Existing same-device source records are retained only when their document IDs are
also present in the restored bundle.

The JSON format is identified by `format: "shelf-reader-data"` and a numeric
`version`. Import rejects unsupported versions, duplicate record IDs, malformed
page geometry/progress, and saved items whose document is absent. IndexedDB schema
version 4 adds update-time indexes while retaining the version 3 stores and records.
