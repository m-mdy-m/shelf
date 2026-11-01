# ADR 0001: Desktop local-runtime packaging

- **Status:** Proposed; implementation choice deferred
- **Date:** 2026-11-01
- **Decision owners:** Shelf maintainers

## Context

The desktop application needs local application services and durable SQLite storage. The UI must remain reusable across Windows, macOS, and Linux, while the runtime must start reliably, stop cleanly, and work without a hosted service.

The architecture currently prefers Go for application services, but the final packaging relationship between the desktop shell and the Go runtime has not been validated on all three operating systems.

## Options

1. **Managed Go sidecar.** The desktop shell starts a bundled Go executable, waits for a health check, and terminates it with the application.
2. **Embedded Go runtime.** Bind the Go service into the desktop host through a native integration layer. This reduces process management but increases platform-specific build and debugging complexity.
3. **Remote-only service.** Run the application service outside the desktop process. This conflicts with the standalone and offline product requirements and is not an acceptable default.

## Interim direction

Keep application services behind typed ports and keep the UI independent of the runtime transport. Do not introduce a remote-service dependency or expose a public network listener.

A managed local sidecar is the preferred option to investigate first, not a final packaging commitment. Any local HTTP transport must bind to loopback only, validate its origin and requests, use an ephemeral per-launch credential, and expose a health endpoint that does not disclose document data.

## Validation required before release

- Build and sign the runtime for Windows, macOS, and Linux.
- Verify startup ordering, readiness timeout, crash reporting, shutdown, and orphan-process cleanup.
- Confirm loopback binding and per-launch authentication.
- Verify database location, backup, upgrades, and recovery.
- Compare the sidecar against an embedded prototype for installer size, startup cost, and support burden.

The packaging decision must be revisited before desktop release automation is considered complete.
