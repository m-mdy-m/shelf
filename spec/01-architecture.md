# Shelf — Architecture

## Shape
Start as an independently distributable **modular application with explicit ports and adapters**, not a fleet of microservices.

```text
Shelf
├── Application shells: Web/PWA | Desktop (Win/macOS/Linux) | Mobile (Android/iOS)
├── Shared UI: Reader | PDF adapter | Selection/Annotations | AI Companion
├── Application core: Library | Progress | Annotations | AI Context/Jobs | Export
├── Ports: Document Access | Persistence | AI | Secure Credentials | Notifications
└── Adapters: Go+SQLite | Browser storage/file APIs | Capacitor Native | Local/Cloud Providers | IDIOS
```

## Boundary rules
- Reader packages MUST NOT import IDIOS-private modules.
- Domain/application code MUST NOT import React, PDF.js internals, SQLite drivers, or Capacitor APIs.
- PDF.js stays behind a Shelf-owned `PdfDocumentAdapter`.
- Shells call typed use cases; UI does not own persistence or provider policy.
- Platform differences remain in adapters.
- Provider credentials remain in trusted backend/native secure storage, never browser JS or logs.
- Shelf never queries another product's private database.

## Operating modes
- **Standalone:** no IDIOS executable, account, or server required; local reading and annotations work offline.
- **IDIOS-integrated:** optional, versioned adapters reuse shared AI/Notes/Graph/Notifications when available, with graceful fallback.
- **Multi-device sync (future):** optional service with explicit conflict, deletion, encryption, and device authorization rules.

## Runtime
Desktop: React/TypeScript UI plus local application services and SQLite. Decide whether Go ships as a sidecar or another package layout before release automation. Any local HTTP API binds to loopback and needs origin/CSRF protection.

Mobile: Capacitor can host the shared UI, but a remote-server-only WebView is not standalone offline Shelf. Native file access and local persistence are required. Do not assume arbitrary Go daemons can run indefinitely on iOS/Android.

## Contracts
Version commands/events for document import/open/close, progress, annotation CRUD, AI submit/stream/cancel, citation resolution, export/import, and optional IDIOS integration. Use stable opaque IDs; filesystem paths and content URIs are locators only.

## Extraction readiness
A module is extractable from IDIOS only after its API is documented/versioned, it imports no private IDIOS modules, tests run independently, dependencies sit behind ports, and standalone configuration/failures are defined. Prove the boundary before moving code to another repo.
