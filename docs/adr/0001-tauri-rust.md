# ADR 0001: Tauri 2 and Rust desktop core

- Status: Accepted
- Decision: Use Tauri 2 for the desktop shell and Rust for native/core services.
- Rationale: Cross-platform distribution, native integration, process control and a typed systems layer.
- Consequences: Must maintain platform-specific packaging and test Linux/macOS/Windows behavior independently.
