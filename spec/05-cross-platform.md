# Shelf — Cross-platform strategy

## Targets

| Platform | Initial shell | Native/local requirements |
|---|---|---|
| Windows | Desktop | File picker, local DB, notifications, secure credentials |
| macOS | Desktop | Open/save panels, sandbox-aware file access, Keychain |
| Linux | Desktop | File picker, local DB, desktop notifications, secret service where available |
| Android | Capacitor/native | Storage Access Framework, local persistence, share sheet, local notifications |
| iOS | Capacitor/native | UIDocumentPicker/security-scoped access, local persistence, Keychain, share sheet, local notifications |

PWA is an additional delivery option, not equivalent to a fully offline native app.

## Shared code

Share domain/application contracts, React/TypeScript Reader UI where practical, PDF adapter contract, annotation model, AI context/citation contracts, and validation fixtures.

## Native adapters

Keep document pickers and persistent permissions, import/copy/range access, secure credentials, local DB lifecycle/backup, notifications, share/open-in, app lifecycle, packaging, and permission prompts behind platform adapters.

## Local-first acceptance

Standalone Shelf MUST:
- Open an authorized/imported PDF offline.
- Save progress, bookmarks, highlights, and notes offline.
- Restore records after termination/reboot.
- Report missing files and expired permissions.
- Export user-created records without an account or server.

Local documents do not imply offline AI; a configured local model is required.

## Mobile constraints

Android and iOS do not guarantee arbitrary background execution. AI tasks must be cancellable and resumable when provider protocol allows, without promising unrestricted background completion. Use OS local-notification facilities; remote push is optional.

## Delivery

Design all five platforms from day one; release in stages after real OS/device tests. Document the build/signing matrix and exact supported OS/architecture ranges before 1.0.
