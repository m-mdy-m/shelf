# Shelf backend modules

This module follows the same feature boundaries used by the IDIOS client/server structure:

- `internal/domain` owns platform-neutral Reader records and invariants.
- `internal/application` owns annotation use cases and input validation.
- `internal/ports` defines narrow repository, clock, and ID-generation contracts.
- `internal/adapters/storage/sqlite` implements the repository with `database/sql`.
- `internal/adapters/httpapi` exposes a small typed HTTP adapter for connected local shells.

The SQLite adapter accepts a host-owned `*sql.DB`; it does not choose a driver or start a daemon. Desktop composition can supply its approved SQLite driver, while Web/PWA and native mobile can use their own local adapters against the same application/domain contracts. The core Reader does not require this HTTP adapter or a remote service.

Apply `migrations/0001_reader_annotations.sql` before constructing the SQLite repository. The backend module has no external Go dependencies.

Run its contract and handler tests from this directory:

```sh
go test ./...
```
