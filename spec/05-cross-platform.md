# Shelf — Cross-platform strategy

## Targets

| Platform | Initial shell | Native/local requirements |
|---|---|---|
| Windows | Desktop | File picker, local DB, notifications, secure credentials |
| macOS | Desktop | Open/save panels, sandbox-aware file access, Keychain |
| Linux | Desktop | File picker, local DB, desktop notifications, secret service where available |
| Android | Capacitor/native | Storage Access Framework, local persistence, share sheet, local notifications |
| iOS | Capacitor/native | UIDocumentPicker/security-scoped access, local persistence, Keychain, share sheet, local notifications |

PWA is an additional option, not equivalent to a fully offline native app.

## Shared
Application/domain contracts, React/TypeScript Reader UI where practical, PDF adapter contract, annotation model, AI context/citation contracts, validation fixtures.

## Native adapters
Document picker and persistent permissions, import/copy/range access, secure credentials, local DB lifecycle/backup, notifications, share/open-in, lifecycle, packaging, and permission prompts.

## Local-first acceptance
Standalone Shelf must open an authorized/imported PDF offline, save progress/bookmarks/highlights/notes offline, restore after termination/reboot, report missing files/expired permissions, and export records without IDIOS. Local documents do not imply offline AI; a configured local model is required.

## Mobile constraints
Android/iOS do not guarantee arbitrary background execution. AI tasks must be cancellable and resumable when provider protocol allows, without promising unrestricted background completion. Use OS local-notification facilities; remote push is optional.

## Delivery
Design all platforms from day one; release in stages after real device/OS tests. Build/signing matrix and exact supported OS/architecture ranges must be documented before 1.0.
