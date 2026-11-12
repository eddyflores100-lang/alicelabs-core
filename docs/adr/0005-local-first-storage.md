# ADR 0005: Local-first persistence

- Status: Accepted
- Decision: Use SQLite for local metadata and an OS-backed credential vault for secrets.
- Rationale: Offline-capable workflows and user control over project data.
- Consequences: Migrations, backup, encryption and recovery must be designed before production release.
