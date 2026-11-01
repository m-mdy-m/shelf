# Shelf — Architecture

## Architectural shape

Start as an independently distributable **modular application with explicit ports and adapters**. Do not split every feature into a process or microservice.

```text
Shelf
├── Application shells
│   ├── Web / PWA
│   ├── Desktop (Windows / macOS / Linux)
│   └── Mobile (Android / iOS)
├── Shared UI packages
│   ├── Reader UI
│   ├── PDF.js adapter
│   ├── Selection / annotation UI
│   └── AI Companion UI
├── Application core
│   ├── Library and document lifecycle
│   ├── Reading progress and sessions
│   ├── Bookmarks and annotations
│   ├── AI context and jobs
│   └── Import / export
├── Ports
│   ├── Document access
│   ├── Persistence
│   ├── AI generation / streaming
│   ├── Secure credentials
│   └── Notifications
└── Platform adapters
    ├── Desktop local runtime
    ├── Browser storage and file APIs
    ├── Native mobile APIs
    └── Local / cloud AI providers
```

## Module boundaries

- Reader packages MUST NOT depend on shell-specific or provider-specific internals.
- Domain/application code MUST NOT import React, PDF.js internals, SQLite drivers, or Capacitor APIs.
- PDF.js stays behind a Shelf-owned PdfDocumentAdapter.
- UI shells call typed application use cases; UI does not own persistence, annotation policy, or AI routing.
- Platform-specific behavior stays behind ports/adapters.
- Provider credentials stay in a trusted local/native backend or OS secure store, never in browser JavaScript or logs.
- A module may not query another module's private database tables.
- Shared packages must have a narrow purpose and public API; avoid an unbounded common or utils package.

## Standalone runtime modes

### Standalone local
The product starts without an account or remote server. Core reading, local metadata, and annotations use the device's storage adapter. AI is optional and may use a configured local or cloud provider.

### Connected provider
A user may configure a remote AI endpoint. This connection is task-scoped and does not make document storage or basic reading remote.

### Multi-device sync (future)
Sync is a separate optional service, not a hidden requirement of AI or Reader. It needs conflict rules, deletion semantics, encryption, device authorization, and a recovery model before implementation.

## Runtime topology

### Desktop
- Reuse the shared React/TypeScript UI.
- Provide local application services and SQLite through a packaged local runtime.
- Decide whether Go is shipped as a sidecar or via another package layout before release automation.
- Any local HTTP API binds to loopback and uses origin/CSRF protection and strict request validation.

### Mobile
- Capacitor may host shared Web UI.
- A WebView that only connects to a remote server is not a standalone offline app.
- Standalone mobile requires native document access and durable local persistence.
- Do not assume arbitrary Go daemons can run indefinitely on iOS or Android.
- Use native APIs for document pickers, secure storage, share sheets, local notifications, and lifecycle.

## Contracts

Version commands/events for document import/open/close, progress updates, annotation CRUD, AI submit/stream/cancel, citation resolution, export/import, and local reminders. Use stable opaque IDs; paths and platform URIs are locators, not document identity.

Potential links:
- shelf://document/{documentId}?page={pageNumber}
- shelf://annotation/{annotationId}
- shelf://ai-job/{jobId}

## Dependency direction

```text
Shells -> UI packages -> Application use cases -> Domain contracts
                                      ^                |
                                      |                v
                             Platform adapters <- Ports
```

The domain defines required capabilities; adapters implement them.

## Extraction readiness

A module is ready to move into a separately published package only when its API is documented/versioned, it has no private cross-module imports, tests run in isolation, dependencies are behind ports, and standalone configuration/failure states are defined. Prove the boundary before creating another repository.
