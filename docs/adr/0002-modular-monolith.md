# ADR 0002: Modular monolith

- Status: Accepted
- Decision: Begin with a modular Rust workspace and separate supervised processes only where isolation is required.
- Rationale: Lower operational complexity and clear module boundaries.
- Consequences: Enforce dependency direction through crate boundaries and architecture tests.
