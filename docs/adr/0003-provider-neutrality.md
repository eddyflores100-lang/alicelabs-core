# ADR 0003: Provider-neutral model gateway

- Status: Accepted
- Decision: All model providers implement a shared internal contract; routing policy is separate from adapters.
- Rationale: Avoid vendor lock-in and enable task-aware model selection.
- Consequences: Provider-specific features must be represented as explicit capabilities, not silently flattened.
