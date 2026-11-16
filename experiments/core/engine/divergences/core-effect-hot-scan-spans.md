# Keep named scan spans without rebuilding stack capture

Design status **Accepted for the selected slice**. See the
[owning slice](../slices/core-hot-path-reuse.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` has statically defined
snapshot and persistence methods, with per-operation state and a named
physical PostgreSQL index-scan span. The TypeScript owners use Effect for
structured scope, interruption and failures. The installed Effect release
captures a definition stack and a call stack for each named `Effect.fn`.

Hoist methods with stable implementations to their database, persistence or
transport owner and pass current borrow parameters explicitly. Use a lazy
internal scan function and attach the same named span without a separate stack
frame capture at profiled scan boundaries. Schema forwarding methods use the
existing named state lookup. This changes diagnostic stack detail at those
internal calls. The span boundary, Effect error channel, interruption and
owner resource guarantees remain.

Preserve exact snapshot, retentions, parent span/context and driver checkout
behavior in focused tests. Remeasure the complete graph and retain timing
and separate profiling evidence.

The same named-span-without-stack-capture form applies to the per-request
Medusa adapter command, service, repository, module, link, query, local-graph
and workflow wrappers, to the Core transaction, database, committer,
scope-exclusion, relational-read, schema-model, persistence and event-store
wrappers counted on a Product create or read, and to the native commerce hosts
and `MedusaWorkflow.region` and `frame`. Span name, parent, error
channel, interruption and the named `CurrentStackFrame` entry remain; only the
call and definition source-location strings are lost. Cold registration,
schema, maintenance and recovery paths keep full stack capture.
