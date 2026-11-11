# Convex mechanism divergence records

- [Write-log generation snapshots](./write-log-generation-snapshots.md) reuse immutable committed conflict views until append or retention pruning.

- [Native policy match reuse](./native-policy-match-reuse.md) retains immutable comparison evidence while the live registry owns authority.
- [Core Effect scan spans](./core-effect-hot-scan-spans.md) retain named scan boundaries and hoist stable operations.

- [Exact pages in native admission](./native-admission-exact-pages.md) retain physical provenance for admission at the same published snapshot.

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
- [Transaction-owned schema model reuse](./transaction-schema-model-reuse.md).

## Source wire and retained identities

- [Typed buffers for canonical document IDs](./document-id-typed-buffers.md).
- [Registered Application deployment attempts](./registered-application-source-upgrades.md): independent code attempts share schema proposals; PostgreSQL retains public status and idempotent finish outcomes through source upgrades.
- [Public Application source and activation](./public-application-activation.md): genuine framed source, Core-owned public candidates and profile-aware SDK generation; bounded fresh local path, wider activation gates remain.
- [Validator identity generations for retained Cloudflare artifacts](./validator-authenticated-identities.md): narrow stored CoreProgram byte projection and authenticated fresh encoding 2 implemented; external/native retained-store cutover gates remain.

## Selected native extensions

- [Bounded fixed query targets](./bounded-query-targets.md): scoped Core snapshot/token-refresh source with current metadata fencing; actual live-query host/state cutover remains open.

- [Native off-key non-null indexes](./native-compound-non-null-indexes.md) lower the selected history predicates to ordinary index ranges. Paired verification passed.

- [Native Cart creation generation records](./native-cart-creation-generations.md) preserve generation and compensation facts across native requests. Paired verification passed.

- [Selected native related predicates](./native-related-predicates.md) evaluate the existing closed predicate over two authenticated Core cohorts. Paired verification passed.

- [Native in-flight request joining](./native-inflight-request-joining.md): bounded exact duplicates share a live app-owner execution and captured correlation; Core remains durable authority, no native replay; selected Native17 replacement and paired admitted consumer proof complete.

- [Native explicit set-null intents](./native-set-null-intents.md): authentic post-delete intent and source seal feed prepared/frozen shared FK patches; selected Native17 replacement and paired admitted consumer proof complete.

- [Native event policy commitment](./native-event-policy-commitment.md): stable workflow event storage verifies exact policy through its committed root identity; selected Native17 replacement and paired admitted consumer proof complete.

- [Native REAL values](./native-real-values.md): exact Tax submitted/immediate/cold representation and range behavior through the shared value owner; selected Native17 replacement and paired admitted consumer proof complete.
- [Native reference checkpoints](./native-reference-checkpoints.md): entity-batch validation and source-confined outgoing FK checking before native callbacks, with unchanged final integrity; selected Native17 replacement and paired admitted consumer proof complete.

- [Native relational foreign keys](./native-relational-foreign-keys.md): selected Product native-key integrity, frozen bounded delete closure and Tax checkpoint continuation proved; broader consumers remain open.
- [Native conditional uniqueness](./native-conditional-uniqueness.md): selected Product/Links eligibility, nullable keys and Tax compound-predicate continuation proved; broader consumers remain open.
- [Native relational query plans](./native-relational-query-plans.md): selected Product/Links plans through shared Core indexes/observations proved; broader native consumers remain open.
- [Native durable events and delivery](./native-durable-event-delivery.md): selected authenticated logical business/event/outcome and delivery proof complete; broader native consumers remain open.
- [Protected historical outcome recovery](./native-protected-outcome-recovery.md): selected committed-first historical native disclosure and callback-free recovery proved; wider consumers remain open.
- [Protected native Worker context](./native-protected-worker-context.md): selected confined CoreV6 calls proved through actual local Workers; broader managed hosting remains open.
- [Installed native source binding selection](./native-source-binding-selection.md): selected withdrawal/retention/historical recovery proved; broader native consumers remain open.
- [Native many membership derivation](./native-reference-memberships.md): selected fresh many/join profiles implemented through confined logical records and ordinary indexes, with paired native/integrity/recovery proof; broader acceptance remains open.
- [Native strong-reference integrity](./native-strong-references.md): selected optional-one late liveness/restrict validation, shared reverse indexes and ordered-save proof implemented; broader native gates remain.
- [Confined Payload preference cleanup](./native-payload-preference-cleanup.md): logical installed model, opaque deletion evidence and native lifecycle authority implemented for selected consumers; broader lifecycle/hosting gates remain.
- [Native source initialization outcomes](./native-source-initialization.md): actual producer seed/readiness and known-failure retry use existing Core native outcomes; selected fresh contract implemented.
- [Native null-predicate index lowering](./native-null-partial-index.md): selected native active-row access through an authenticated equality prefix over a full ordinary Source index; bounded null-plus-text owner/native index and complete selected Native18 consumer proof implemented and reviewed.
- [Native non-null index backing](./native-non-null-index-backing.md) records authenticated aliases over ordinary field indexes. The selected Order producer and bounded paired proof are complete.
- [Native generated serials](./native-generated-serials.md) records the descending ordinary-index maximum for required native generated values. The neutral owner and both direct Order consumers passed paired acceptance.
- [Native inferred reverse indexes](./native-inferred-reverse-indexes.md): admitted native composite-key suffix access lowers to authenticated ordinary Source indexes; implemented with paired neutral owner, genuine history and complete selected consumer proof; wider lifecycle gates remain.
- [Native declared equality indexes](./native-declared-equality-indexes.md): unconditional scalar declarations map to ordinary Source indexes with existing identities retained; paired owner, complete Native20 consumer and connected proof implemented; wider lifecycle gates remain.
- [Native PostgreSQL candidate predicates](./native-postgres-candidate-predicates.md): complete native SQL semantics over authentic Core-captured rows; translated with neutral paired proof, connected acceptance and review open.
- [Native recorded-row restoration](./native-recorded-row-restoration.md): authenticated native values restore through current destinations or fresh internal IDs; translated with neutral paired proof, review corrections and connected acceptance open.
- [Native same-root row reconstitution](./native-same-root-row-reconstitution.md): exact live-root deleted children retain identity under an authenticated native timestamp policy; neutral, actual-host and selected Store acceptance complete, wider gates open.
- [Native physical history pagination](./native-history-physical-pagination.md): timestamp-bearing ordered index and physical limit before time eligibility, with an explicit data-preserving upgrade; paired owner and focused plan proof complete, connected acceptance and renewed review open.
- [Native index page observations](./native-index-page-observations.md): Currency's examined windows preserve Source prefix/EOF ownership in the native profile; selected page/count path implemented.
- [Native schema source composition](./native-schema-composition.md): one authenticated bundle before the existing Source lifecycle; selected fresh multi-source contract implemented.
- [Confined native root participation](./native-root-participation.md): explicit source children over one kernel/lifetime/outcome; selected private mixed path implemented.
- [Native scope exclusion](./native-scope-exclusion.md): selected-callback exclusion with competing writer-settlement fencing implemented through trusted Core admission/settlement owners with paired owner, genuine native and complete selected consumer proof; wider hosting gates remain.
- [Native relational row values](./native-relational-row-values.md): existing authenticated row semantics move to one shared value owner before Currency cutover; no additional physical schema or native runtime activation is implied.
- [Authenticated native write ownership](./native-write-ownership.md): selected fresh scalar policy implemented through shared schema/transaction owners; broader native and retained-data gates remain.
- [Native declarative uniqueness](./native-unique-constraints.md): required-text subset implemented over source indexes/dependencies/acceptance; general constraint gates remain.
- [Direct native read visibility](./native-direct-read-visibility.md): selected direct-command and fixed-read profiles implemented; wider native and hosting gates remain.
- [Native Promise completion and cancellation](./native-promise-draining.md): actual foreign Promise draining and complete failure preservation at the Payload/request-lifetime owners, including private origin reference equality; selected boundaries implemented and validated, general native hosting open.
- [Native accepted-state durability dependencies](./native-dependent-save-order.md): selective prerequisite durability is implemented for unpublished slot transitions, retaining independent saves and atomic FIFO batches; broader profile/performance gates remain.
- [Native workflow diagnostics](./native-workflow-diagnostics.md) preserve Medusa's synchronous logger during the owned callback drain. Paired acceptance is complete.

- [Cross-runtime lease generations](./lease-generation-handoff.md): selected observed-predecessor CAS implemented with paired neutral/storage/owner proof; actual Node/Workerd consumer acceptance pending; strict write fencing and canonical-host gates remain.
