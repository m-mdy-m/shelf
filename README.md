<p align="center">
  <img src="apps/web/public/brand/shelf-mark.svg" width="84" height="84" alt="Shelf mark">
</p>

<h1 align="center">Shelf</h1>

<p align="center">
  <strong>Read. Understand. Connect.</strong><br>
  A calm, local-first reading workspace for PDFs and the ideas inside them.
</p>

<p align="center">
  <a href="https://github.com/m-mdy-m/shelf/actions/workflows/ci.yml">CI</a> ·
  <a href="spec/README.md">Specification</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

---

Shelf brings a focused PDF reader, reliable annotations, and a source-grounded AI companion into one portable application. Your documents and reading history stay under your control. Choose a local model, a cloud provider, or no AI at all.

## What Shelf is

- **A reader first.** Navigate, search, select, bookmark, highlight, and take notes without needing an AI provider or an internet connection.
- **An AI companion when requested.** Explain a passage, ask questions, summarize, or translate with explicit provider/model selection and traceable source references.
- **A place to keep what matters.** Preserve quotes, notes, reading progress, and later concepts with links back to the original document.
- **A standalone product.** No account or hosted service is required for core reading.
- **Cross-platform by design.** Windows, macOS, Linux, Android, and iOS are product targets, with native behavior behind platform adapters.

## Product principles

| Principle | Promise |
|---|---|
| Local-first | Reading data stays on the device by default. |
| Source-grounded AI | A citation is trusted only when it resolves to the supplied PDF source. |
| Provider choice | Local and cloud AI are both optional; the user controls remote context sharing. |
| Portable data | Reading progress and annotations can be exported in documented formats. |
| Reader-first UX | AI never blocks basic reading or annotation. |
| Platform honesty | A platform is supported only after its core workflows pass real target tests. |

## Current status

Shelf is in its specification and foundation phase. The repository currently contains the product specification, delivery plan, project metadata, and development scaffolding—not a completed reader implementation.

The former TechShelf catalog is preserved under [archive/](archive/README.md) as historical input. It is not the new application's database schema.

## Roadmap

1. **Reader Foundation** — local PDF import, rendering, navigation, search, selection, annotations, and resume.
2. **AI Companion** — local and cloud providers, bounded document context, citations, streaming, and cancellation.
3. **Knowledge & Portability** — quote/note export, deep links, and reviewable concept/flashcard drafts.
4. **Standalone Release** — validated Windows, macOS, Linux, Android, and iOS packages.

See [the full specification](spec/README.md) and [the work plan](spec/08-github-work-plan.md).

## Technology direction

- React + TypeScript for shared interface code.
- Mozilla PDF.js behind a Shelf-owned adapter.
- Go application services and SQLite for the initial desktop/local runtime.
- Capacitor and native adapters for mobile.
- Provider-neutral contracts for local and cloud inference.

These are implementation choices to validate against acceptance criteria; they are not claims of completed platform support.

## Repository map

| Path | Responsibility |
|---|---|
| apps/web/ | Shared web application and public static assets |
| apps/desktop/ | Desktop shell and packaging integration |
| apps/mobile/ | Mobile shell and native integration |
| packages/ | Reusable reader, PDF, annotation, and AI contracts |
| backend/ | Local application runtime, domain, ports, and adapters |
| spec/ | Product and engineering requirements |
| docs/ | Public project docs, developer guides, and ADRs |
| tests/ | Unit, integration, E2E tests, and PDF fixtures |
| archive/ | Preserved legacy catalog files |

## Development

Read [Contributing](CONTRIBUTING.md), [Development docs](docs/development/README.md), and the [Architecture specification](spec/01-architecture.md) before changing project structure.

The project uses [PSX](https://github.com/m-mdy-m/PSX) for repository structure conventions, [GIX](https://github.com/m-mdy-m/gix) for Git flow, and [Pipeline](https://github.com/m-mdy-m/pipeline) for the shared task graph and CI workflow.
