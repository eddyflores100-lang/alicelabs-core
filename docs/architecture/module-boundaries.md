# Module boundaries

| Module | Owns | Must not own |
|---|---|---|
| AI Gateway | provider adapters, model catalog, streaming | UI state, project files |
| Intelligence | task classification, routing policy | provider credentials |
| Agent Runtime | agent sessions and tool requests | direct network/OS access |
| Orchestration | task graph and scheduling | provider-specific code |
| Universal Bridge | tool registry and invocation | raw model prompts |
| Workspace | project roots, worktrees, sessions | secrets |
| Memory | scoped retrieval and retention | cross-project implicit access |
| Security | authorization, vault abstraction, audit | provider business logic |
| Storage | persistence implementation | UI components |
