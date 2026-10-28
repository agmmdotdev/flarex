# Convex mechanism divergence records

Status: **Required record format for the authorized core refactor**.
The default is to copy or translate the pinned Convex mechanism as closely as
possible. Every necessary mechanism difference gets its own Markdown record in
this directory before the affected implementation. Use a descriptive filename
and the [_template.md](./_template.md) fields; link it from the owning slice and
this index.

The reference is Convex revision
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. Follow the
[source and divergence rules](../../REFERENCES.md#source-and-divergence-rules)
and [replacement workflow](../REFACTOR.md#convex-guided-replacement-workflow).
Read its actual owner, callers and relevant tests. Preserve its mechanism unless
runtime constraints, required native semantics or accepted product obligations
establish a concrete reason to differ.

## When a record is required

Record a changed algorithm, storage representation with different required
operations or guarantees, synchronization/ordering rule, validity/retention rule,
failure/retry/recovery path, authority boundary or observable behavior. Describe
how the chosen TypeScript/DO/PostgreSQL mechanism preserves the required
invariants and which costs or capabilities differ. Plain symbol renaming or
language syntax alone does not need a separate divergence record.

Old plumbing, fewer adapter edits, fixture convenience and implementation
preference alone are insufficient reasons. A new divergence is not justified
merely because the current core already differs. Compare keeping, adapting and
replacing the actual responsible logic.

Routine adaptation that preserves accepted guarantees can be decided within an
authorized slice and recorded here. If the difference changes an unresolved
guarantee, mark the record proposed and pause the affected path for the required
decision. A document, passing test or worker agreement does not grant itself
acceptance. Continue independent work within settled scope.

## Existing accepted difference references

Existing accepted decisions remain at their owners; do not imply they have been
implemented or reopen them merely to fill this directory. When a slice implements
one, create its focused record with the actual source mapping, replacement and
evidence, retaining the accepted decision link.

| Existing record | Responsibility to inspect |
| --- | --- |
| [Refactor reference and integration seams](../REFACTOR.md#convex-as-the-development-reference) | TypeScript/runtime representations, existing core reuse and native behavior without a Convex equivalent. |
| [Commit mechanism and necessary differences](../01-commit-coordination.md#pinned-convex-mechanism-and-necessary-differences) | App DO coordination, PostgreSQL durable authority, save/publication order and recovery adaptations. |
| [Snapshot mechanism](../02-timestamped-snapshots.md#pinned-convex-mechanism) | Safe versioned reads through local state and PostgreSQL fallback. |
| [Operation lifetime differences](../02-operation-lifetime.md#pinned-sources-and-necessary-differences) | Native operation boundaries, deadline/retry ownership and replay eligibility. |
| [Authorization differences](../02-read-authorization.md#pinned-sources-and-necessary-differences) | Tracked snapshot permissions, result reuse and separate engine-grant revocation. |
| [Read freshness differences](../02-read-after-write.md#pinned-sources-and-necessary-differences) | Owner readiness/recovery and client timestamp direction. |
| [Index readiness differences](../02-index-readiness.md#pinned-sources-and-necessary-differences) | Ordinary-index lifecycle, deployment gating and local coverage distinction. |

## Focused implementation records

| Record | Current scope |
| --- | --- |
| [Operation-local cache storage](./operation-cache-storage.md) | Connected Application query cache implemented; complete-request performance and wider DO milestone open. |
| [Completed query cache handoff](./query-cache-transfer.md) | Selected next contract; exclusive concurrent-query checkout, consumption, negative-evidence reset and matching limits; runtime unstarted. |
| [PostgreSQL cache refresh](./postgres-cache-refresh.md) | Selected next contract; guarded durable-feed/history reconstruction at exactly the admitted timestamp; runtime unstarted. |

| Record | Design / implementation / measurement status |
| --- | --- |
| [App-owner execution and coordination runtime](./app-owner-runtime.md) | Accepted runtime placement design / Unstarted / Unmeasured; records the existing DO host adaptation and its CPU/concurrency limits. |

No new mechanism divergence is accepted or claimed implemented by creating this
index. Add each focused record here when the corresponding slice establishes
its need; keep proposed, accepted, implemented and measured status distinct.

Each record must explain **why** the Convex mechanism cannot be used directly
and **how** our replacement is or will be implemented. After implementation,
replace plans with exact executing owners/symbols and link the relevant source
and Git evidence. Keep validation receipts and chronology in Git rather than
maintaining a competing completion log here.
