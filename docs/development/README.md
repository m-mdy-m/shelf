# Development guide

Shelf is being built as a modular cross-platform application. The repository begins specification-first; implementation commands will become meaningful as the respective toolchains land.

## First steps

1. Read [the product brief](../../spec/00-product-brief.md).
2. Read [the architecture](../../spec/01-architecture.md).
3. Read the acceptance criteria in the Issue you are implementing.
4. Use a GIX feature or bugfix branch from develop.
5. Keep a change focused and link its Issue in the PR.

## Project tools

- **PSX** checks and creates the agreed repository structure using psx.yml.
- **GIX** manages main/develop and topic branches using .gix/config.
- **Pipeline** is the task graph source of truth in pipeline.toml and the shared CI runner.

Install the pinned Pipeline task runner with make setup. Run make check and make ci. Use psx check for structure checks and gix doctor for branch-flow diagnostics.

## Git flow

- feature/* starts from develop and finishes back into develop.
- bugfix/* starts from develop and finishes back into develop.
- hotfix/* starts from main and finishes into main and develop.
- release/* starts from develop and finishes into main and develop.

Do not push ordinary feature work directly to main. Open a pull request and link the Issue.

## Tests

Use unit tests for domain behavior and validation. Use integration tests for adapters and storage. Use end-to-end tests for user workflows. PDF test files must be redistributable and must not contain private documents.

## Platform claims

Record exactly which platform and device/OS combination was tested. A successful compile is not proof that file picking, permissions, storage, or notifications work on that platform.
