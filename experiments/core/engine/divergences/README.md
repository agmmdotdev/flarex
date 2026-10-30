# Convex mechanism divergence records

Status: **Required record format for the authorized core refactor**.
The default is to copy or translate the pinned Convex mechanism as closely as
possible. Every necessary mechanism difference gets its own Markdown record in
this directory before the affected implementation. Use a descriptive filename
and the [_template.md](./_template.md) fields; link it from the owning slice and
this index.

The reference is Convex revision
`db914cf06e2b06ee985646611b9e12ed7a770318`. Follow the
[source and divergence rules](../../REFERENCES.md#source-and-divergence-rules)
and [replacement workflow](../REFACTOR.md#convex-guided-replacement-workflow).
Read its actual owner, callers and relevant tests. The accepted
[translation target](../REFACTOR.md#core-and-physical-schema-translation-plan)
includes the physical persistence schema. Preserve the pinned mechanism unless
DO/runtime constraints or required native behavior establish a concrete reason
to differ. Existing optimizations, layouts or product-policy choices are not
automatic exceptions; resolve an observable guarantee conflict at its scoped
decision owner before affected runtime edits. Earlier divergence records retain
their current-runtime gates while their mechanisms are reassessed for translation.

The [reference upgrade](../CONVEX-REFERENCE-UPGRADE.md) changes active source
contracts and owners. Existing records retain their inspected pin, implementation
status and current-runtime gates. Reassess affected mechanisms and update their
source mapping before the next slice; this index does not re-certify old findings.

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
| [Canonical app DO routing](./single-app-owner-routing.md) | Bounded shared fresh query/mutation owner implemented; canonical admission and writer closure adapt process ownership to DO lifecycle. Managed-host and wider profile gates remain open. |
| [Application query RPC transport](./application-query-stream-transport.md) | Finite Worker chunks preserve one snapshot query and complete terminal lifetime; source logical bounds and authenticated cursors remain translated. Required host/capacity gates remain open. |
| [Transaction operation exclusion](./transaction-operation-exclusion.md) | TypeScript adaptation of Rust exclusive mutable transaction access; concurrent patches and unfinished finalization controls, host admission limits still open. |
| [Private signed-grant authority](./application-grant-authority.md) | Selected fresh-target adaptation / Implemented / Unmeasured. One logical scope epoch and profile enforcement over translated core; actual app-DO readiness remains gated. |
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
| [Exact original finite preparation](./finite-preparation-handoff.md) | Selected adaptation / Implemented for existing finite consumers / Unmeasured. Preserve genuine original binding/head/selection identity through existing executing finite consumers; remove active reselection. |
| [Execution-group catalog coverage](./application-execution-group.md) | Selected correction / Implemented for existing finite consumers / Unmeasured. Add the verified canonical function-catalog digest to the existing group; reconcile existing observations through maintenance and preserve stored attempts/outcomes. |
| [Maintained relation readiness](./maintained-relation-readiness.md) | Source challenge complete / Replacement not started / Unmeasured. Reuse exact current maintained identities with truthful historical children; standalone Payload writer closure and fresh rollback provenance remain prerequisites. |
| [Native Application relation maintenance](./native-application-relation-maintenance.md) | Bounded source-CMS replacement implemented / Unmeasured. Original Application relation authority joins native publication while logical data schema, existing locks and single publisher remain distinct. |
| [Empty Application source projection](./empty-application-source-projection.md) | Bounded publisher correction implemented / Unmeasured. Keep canonical empty Application evidence without inventing a serving table; native policy and missing-root refusals remain. |
| [Retained Application attempt retirement](./retained-application-attempt-retirement.md) | Policy and three-way source challenge complete / Retained lifecycle direction selected; runtime unstarted / Unmeasured. Reconcile under existing fencing, retain original evidence and project explicit non-success only after settlement. |
| [Cross-domain Application relation maintenance](./cross-domain-application-relation-maintenance.md) | Implemented bounded joint writer. One genuine retained relation pair reaches the existing Application/Payload/Currency materializer and publisher. Historical coverage, maintained readiness and complete-flow capacity remain open. |

| Record | Design / implementation / measurement status |
| --- | --- |
| [App-owner execution and coordination runtime](./app-owner-runtime.md) | Accepted runtime placement design / Unstarted / Unmeasured; records the existing DO host adaptation and its CPU/concurrency limits. |
| [System logical schema installation](./system-logical-schema-installation.md) | Current-code experiment checkpointed; target implementation contract superseded / Partial uncommitted / Required gates unmet. Reconcile its authority/readiness invariants with translated bootstrap and physical persistence. |

No new mechanism divergence is accepted or claimed implemented by creating this
index. Add each focused record here when the corresponding slice establishes
its need; keep proposed, accepted, implemented and measured status distinct.

Each record must explain **why** the Convex mechanism cannot be used directly
and **how** our replacement is or will be implemented. After implementation,
replace plans with exact executing owners/symbols and link the relevant source
and Git evidence. Keep validation receipts and chronology in Git rather than
maintaining a competing completion log here.

## Snapshot and page-cache translation

- [Synchronous TypeScript weighted page-cache maintenance](./typescript-weighted-page-cache.md): pinned TinyLFU policy with synchronous JS maintenance.
- [Explicit DO cache and admission budgets](./do-cache-and-admission-budgets.md): private workload settings; production capacity remains unselected.
