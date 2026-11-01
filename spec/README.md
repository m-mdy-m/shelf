# Shelf specification

This directory is the normative product and engineering specification. It defines what Shelf must do, how its boundaries are shaped, and what evidence is required before a capability can be called complete.

| Document | Scope |
|---|---|
| [00 — Product brief](00-product-brief.md) | Vision, users, scope, MVP, and success measures |
| [01 — Architecture](01-architecture.md) | Runtime shape, modules, ports, adapters, and boundaries |
| [02 — Reader engine](02-reader-engine.md) | PDF rendering, navigation, search, selection, and annotations |
| [03 — AI Companion](03-ai-companion.md) | Local/cloud inference, routing, source grounding, and cancellation |
| [04 — Data model](04-data-model.md) | Entities, identity, anchors, migrations, and export |
| [05 — Cross-platform](05-cross-platform.md) | Windows, macOS, Linux, Android, and iOS |
| [06 — Quality and security](06-quality-security.md) | Testing, performance, privacy, accessibility, and release gates |
| [07 — Roadmap](07-roadmap.md) | Delivery phases and exit criteria |
| [08 — Work plan](08-github-work-plan.md) | GitHub issues, labels, milestones, and dependency map |

## Product decisions

1. The first implementation is the PDF Reader.
2. Local and cloud AI are both supported, optional, and selectable per task.
3. Windows, macOS, Linux, Android, and iOS are design targets from day one; release is staged and evidence-based.
4. Standalone/local-first reading does not require an account or remote server.
5. Documents, reading state, and annotations remain local by default.
6. PDF.js is used behind a product-owned adapter.
7. The application starts as a modular system with explicit ports/adapters, not a microservice fleet.
8. The legacy catalog is preserved under archive/ and is not the new application schema.

## How to use this specification

- Read the Product Brief before adding user-facing scope.
- Read Architecture before introducing a new package, process, or dependency.
- Use the Reader and AI specifications for behavior and edge cases.
- Use the Cross-platform and Quality specifications for native behavior and release evidence.
- Record material changes as an ADR under docs/decisions/ and update the relevant normative page.

## Requirement language

- **MUST** — required for acceptance or release.
- **SHOULD** — strong default; deviations need a documented reason.
- **MAY** — optional capability.

Implementation and tests are authoritative for current behavior. When they differ from this specification, document the discrepancy and update the spec; do not leave it ambiguous.
