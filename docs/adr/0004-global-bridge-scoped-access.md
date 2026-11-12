# ADR 0004: Global integration registry with scoped grants

- Status: Accepted
- Decision: Register an integration once globally, then grant capabilities to projects and agents independently.
- Rationale: Reuse connections without granting universal access.
- Consequences: Authorization is evaluated on every invocation; credentials remain inside connector adapters.
