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
| [Completed query cache handoff](./query-cache-transfer.md) | Bounded Application path implemented; exclusive concurrent-query checkout, invocation-owned completion, negative-evidence reset and matching limits. DO lifecycle and complete-request performance remain open. |
| [PostgreSQL cache refresh](./postgres-cache-refresh.md) | Bounded Application path implemented; guarded durable-feed/history reconstruction at exactly the admitted timestamp. Current publication and live gates remain; no native-cache or throughput claim. |
| [Application query DO host](./application-query-do-host.md) | Bounded local composition implemented; trusted local references, invocation-scoped clients, cold restart and unchanged PostgreSQL authority. Full coordinator and native hosting remain open. |
| [PostgreSQL client lifetime](./postgres-client-lifetime.md) | Shared driver observation and release implemented; preserves complete failures and the distinct HTTP/Effect outcome profiles. |
| [Cloudflare PostgreSQL shutdown](./pg-cloudflare-shutdown.md) | Transport task barrier with controlled and actual-host conformance; preserves real failures, ordered end, forced escalation and TLS generations. Direct native TLS negotiation and stalled-write destruction bounds remain unproved. |
| [Local Cloudflare runtime](./cloudflare-local-runtime.md) | Source-corrected default workerd integrated with bounded local host proof; no hosted deployment or capacity claim. |
| [Exact range completion evidence](./range-completion-evidence.md) | Newly executed finite/durable producer correction implemented; preserves exact N+1 completion, selected-body dependencies and accounting. Old journal cutover and the full pending replacement remain open. |
| [Incremental pending indexes](./incremental-pending-indexes.md) | Selected bounded adaptation / Implemented / Unmeasured; lazy current-position trees with accepted written-ID suppression preserve fallible key timing. Protected canonical/attempt views retain native evidence. Private reference projection remains a named retained consumer. |
| [Application nested failure](./application-nested-failure.md) | Accepted current invocation-sticky profile / Existing runtime and genuine Standard durability witness implemented / Unmeasured. A caught rejected child still fails the root; Convex handler rollback is a separate future guarantee choice. |
| [Application operation admission](./application-operation-admission.md) | Selected existing guarantee / Bounded connected replacement implemented / Unmeasured. Genuine header-only admission precedes local values, replay and evaluation; compound ownership, minimal lifecycle evidence and complete failures preserve existing profile contracts. |

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
