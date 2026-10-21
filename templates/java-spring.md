
## Java / Spring Boot checklist
Pay special attention to:
- `@Transactional` boundaries: propagation, self-invocation through proxies, read-only transactions, work done after commit
- thread safety of singleton beans and shared mutable state; race conditions
- database performance: N+1 queries, missing fetch joins or indexes, unbounded result sets
- resource leaks: streams, connections, executors
- exception handling: swallowed exceptions, rollback rules for checked exceptions
- backward compatibility and API contract changes (DTOs, endpoints, serialization)
- integration test coverage for persistence and web layers
- dependency injection issues: circular dependencies, field injection, bean scope mismatches
- security: input validation, authorization checks, injection, secrets in code or logs
