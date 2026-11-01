# Convex mechanism divergence records

- [Scoped app-generation supervision](./app-owner-recovery.md): preserve Source's committer stop and durable reconstruction through a portable scoped supervisor and Cloudflare host adapter.

- [Caller retry after proven noncommit](./native-proven-noncommit-retry.md): selected Product and protected retry behavior requires authenticated manual reclaim after proven noncommit; automatic callback replay remains forbidden.

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

The [native ordinary-index observation record](./native-ordinary-index-observations.md)
defines the selected implemented and validated indexed Payload replacement. It keeps
Source event dependencies intact and specifies the necessary direct-native
capture/terminal-membership difference.
The [native command budget record](./native-command-budgets.md) specifies shared
request charging and bounded retained data for that same connected replacement.

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

## Shared schema translation

- [Application registration admission](./application-registration-admission.md): trusted fresh executor provenance extends the existing logical schema lifecycle; interrupted preparation and exact program publication share Core enforcement.
- [Bounded schema/index worker lifetime](./cloudflare-schema-worker-lifetime.md).
- [Live Worker table mapping](./worker-table-mapping.md).
- [Drizzle physical maintenance](./drizzle-physical-maintenance.md).

- [Local model migration lineage](./model-migration-lineage.md).

- [Effect stack tracing in the hardened Worker](./worker-effect-stack-trace.md).

## Source wire and retained identities

- [Validator identity generations for retained Cloudflare artifacts](./validator-authenticated-identities.md): narrow stored CoreProgram byte projection and authenticated fresh encoding 2 implemented; external/native retained-store cutover gates remain.

## Selected native extensions

- [Native relational foreign keys](./native-relational-foreign-keys.md): declared native-key integrity and frozen bounded delete closure; specified, implementation/proof open.
- [Native conditional uniqueness](./native-conditional-uniqueness.md): eligibility separate from nullable business keys; specified, implementation/proof open.
- [Native relational query plans](./native-relational-query-plans.md): admitted Medusa plans through shared Core indexes/observations; specified, implementation/proof open.
- [Native durable events and delivery](./native-durable-event-delivery.md): authenticated private logical records in the same root/outcome; specified, implementation/proof open.
- [Protected historical outcome recovery](./native-protected-outcome-recovery.md): committed-first recovery with historical native disclosure authority; specified, implementation/proof open.
- [Protected native Worker context](./native-protected-worker-context.md): confined native calls over the unchanged CoreV6 kernel and shared artifact generator; implemented, actual Worker proof open.
- [Installed native source binding selection](./native-source-binding-selection.md): authenticated logical source withdrawal retains data and historical recovery while denying fresh runtime authority; specified, implementation/proof open.
- [Native many membership derivation](./native-reference-memberships.md): selected fresh many/join profiles implemented through confined logical records and ordinary indexes, with paired native/integrity/recovery proof; broader acceptance remains open.
- [Native strong-reference integrity](./native-strong-references.md): selected optional-one late liveness/restrict validation, shared reverse indexes and ordered-save proof implemented; broader native gates remain.
- [Confined Payload preference cleanup](./native-payload-preference-cleanup.md): logical installed model, opaque deletion evidence and native lifecycle authority implemented for selected consumers; broader lifecycle/hosting gates remain.
- [Native source initialization outcomes](./native-source-initialization.md): actual producer seed/readiness and known-failure retry use existing Core native outcomes; selected fresh contract implemented.
- [Native null-predicate index lowering](./native-null-partial-index.md): selected native active-row access through an authenticated equality-null prefix over a Source index; bounded lowering implemented.
- [Native index page observations](./native-index-page-observations.md): Currency's examined windows preserve Source prefix/EOF ownership in the native profile; selected page/count path implemented.
- [Native schema source composition](./native-schema-composition.md): one authenticated bundle before the existing Source lifecycle; selected fresh multi-source contract implemented.
- [Confined native root participation](./native-root-participation.md): explicit source children over one kernel/lifetime/outcome; selected private mixed path implemented.
- [Native relational row values](./native-relational-row-values.md): existing authenticated row semantics move to one shared value owner before Currency cutover; no additional physical schema or native runtime activation is implied.
- [Authenticated native write ownership](./native-write-ownership.md): selected fresh scalar policy implemented through shared schema/transaction owners; broader native and retained-data gates remain.
- [Native declarative uniqueness](./native-unique-constraints.md): required-text subset implemented over source indexes/dependencies/acceptance; general constraint gates remain.
- [Direct native read visibility](./native-direct-read-visibility.md): selected direct-command and fixed-read profiles implemented; wider native and hosting gates remain.
- [Native Promise completion and cancellation](./native-promise-draining.md): actual foreign Promise draining and complete failure preservation at the Payload/request-lifetime owners; selected proof and review gates remain.
- [Native accepted-state durability dependencies](./native-dependent-save-order.md): selective prerequisite durability is implemented for unpublished slot transitions, retaining independent saves and atomic FIFO batches; broader profile/performance gates remain.
