# Caller retry after proven noncommit

Status: **Selected shared request policy, owner-backed Product/protected retry
and connected proof complete; broader consumer migration remains open.**
Owner: [Native Product and protected consumers](../slices/16-native-product-links-and-references.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`application_function_runner/mod.rs::write_mutation_status` records successful
session outcomes. A failed mutation does not permanently consume its request
key. Native callbacks cannot inherit automatic Application replay, but this does
not forbid a caller explicitly retrying a proven uncommitted operation.

The existing [Product conflict contract](../../../../roadmaps/shared-logical-storage/11-product-storage-cutover.md)
requires a stale Collection/Category request to fail, then permits an explicit
same-key invocation against a fresh snapshot. Protected save callers also have
an explicit failed-attempt retry with fresh authority. These are selected
behavior, unlike the displaced SQL/journal attempt representation.

The shared request owner must admit an optional authenticated
`retryProvenNoncommit` root policy, included in its captured root identity. Omitted
policy preserves existing frozen profiles. Reuse the existing revision-fenced
claim replacement only for a matching explicitly aborted request with proven
noncommit. A recovered failed record after full successor fencing and outcome
reconciliation also proves noncommit; unresolved/busy attempts do not.
Committed outcomes replay; busy and uncertain outcomes reconcile before any
body starts. Every new body requires current program, native and principal
authority. Do not add callback loops, adapter retry engines or fresh-key
workarounds. A stale claim cannot abort a reclaimed attempt.

The existing [request owner](../../../../packages/persistence-postgres/src/core/database.ts)
authenticates the optional policy in historical/live root identity and reuses
revision-fenced claim replacement. The
[app supervisor](../../../../packages/persistence-postgres/src/core/applicationOwner.ts)
supplies complete fencing, drain and outcome reconciliation after a persistence
stop; the [native facade](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeOwnerHost.ts)
does not retry callbacks. The private SQL-command `statementFailure` spelling
is replaced by the current shared `resourceFailure` projection, preserving the
original SQLSTATE/full Cause, actual rollback and uncertain-outcome distinction.

Prove matching manual retry after conflict and settled SQL rollback, once-only
callbacks within each invocation, changed correlation refusal, competing claims,
stale claim fencing, committed replay, fenced absence versus unresolved
uncertainty and unchanged default profiles on both database lanes. No new physical storage or general
native effect replay is selected.
