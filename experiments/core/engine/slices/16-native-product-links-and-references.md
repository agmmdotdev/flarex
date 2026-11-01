# Native Product, Links and protected reference replacement

Status: **Selected Core implementation, connected database/DO/Worker proof,
independent review and scoped retirement disposition complete.
Named Legacy consumers and broader full-goal gates remain below.**

Baseline: `6854f9ee299b7ec5b3b6d644f3d40d61859387e4`. Convex pin:
`db914cf06e2b06ee985646611b9e12ed7a770318`. Continue the
[full goal](../GOAL.md) and [replacement workflow](../REFACTOR.md#convex-guided-replacement-workflow).

## Connected outcome

Move the complete admitted Medusa Product graph, required stored Module Links,
and existing protected Product-reference read/save/reverse/recovery consumers
through the translated Core. Migrate the actual native services, repository,
queries, category operations, lifecycle, event publication and mixed-root consumers;
a reduced schema or new CRUD fixture does not close this outcome.
Other native modules, arbitrary developer functions, actual fact/feed consumers,
named retained-data disposition, hosting, package retirement and performance
remain full-goal gates. Performance measurement remains paused.

The executing native baseline is the checked Medusa fork in
[its source manifest](../../../../third_party/medusa/SOURCE.json).
Verify the executing promoted package/source path for each lane; comparison
snapshots are not implementation owners. Preserve the
[original Product case inventory](../../../../roadmaps/flarexdb-framework-integration/preflight/product-upstream-test-cases.json)
and its exact-multiplicity guard: 205 admitted original cases across ten files,
one upstream skip, including the 1,000-image graph.

## Challenged contract

The three independent readers inspected current code, accepted direction and
pinned Source, exchanged counterexamples, and agreed on the following contract.

- Product capture is **13 tables, 15 FKs (11 cascade, four noAction),
  24 unique requirements and 60 indexes**. Native IDs remain indexed business
  fields; Core V6 IDs remain storage envelope identities. Three implicit pivots
  retain tuple identity; the explicit variant-image entity retains its native ID.
- Native defaults, exact values, omitted/null distinction, managed timestamps,
  full-batch preflight and public/internal projection retain their owners.
  General REAL/serial admission is not required by this Product closure.
- Partial uniqueness keeps eligibility separate from key fields and nullable
  key semantics. In particular, active `(sku) WHERE deleted_at IS NULL` must not
  skip active rows because the index access prefix itself contains null.
- Module-local FKs require native-key existence, including soft-deleted rows.
  Their noAction and cascade behavior is distinct from native soft-delete DML.
  All actual Product FK updates use noAction; no Product FK uses setNull.
  Type/Collection native deletion explicitly detaches surviving Products.
- Module Links deliberately have no endpoint FKs. Preserve missing endpoints,
  tuple identity, rich fields/defaults, active cardinality, dismiss/restore,
  exact-pair and ambiguous-restore rules, atomicity, timestamps and isolation.
  Native pivots and rich Links are business records, never hidden derived
  Native15 membership children.
- Protected article-to-Product assignment requires an active target; existing
  references survive soft deletion and unrelated source edits. Reverse membership
  remains and hard deletion is restricted until clearing. Existing
  `user_product`/`news_product` also restrict soft deletion and retain that policy.
- Preserve separate read, assignment, retention and traversal authority; consumed
  metadata dependencies and ABA protection must remain selective. An unrelated
  compatible source change is not a universal schema-head conflict.
- Recover an authenticated historical committed outcome before live writer
  admission after withdrawal, without Worker/native callback replay. Do not
  weaken admission for fresh direct-native requests or restore withdrawn authority.
- Preserve sticky failure, actual foreign-work drain, exact point/prefix/EOF
  observations, accepted-prefix integrity, ordered publication and actual
  contributing predecessor durability. Do not make native callbacks replayable.

## Delete closure and native presentation

Ordinary pending deletion and complete hard-delete closure preparation have
different phases. The old direct-store witness deletes a Product and then
inserts a replacement with the same native key; its Variant survives because
the final FK is satisfied. Eagerly cascading every scalar delete is incorrect.

Use one shared bounded closure/integrity owner after final replacement decisions.
Native Medusa may reuse its already discovered child-first closure and exact
incoming observations. Direct trusted callers request closure preparation before
result/event sealing where automatic cascading is required. Return the actual
changed closure before presentation seals. Finalization/acceptance validates the
frozen graph and concurrent incoming membership; it must not silently discover
and delete extra rows. Preserve the real self-hierarchy and noAction witnesses;
an implementation that happens to terminate arbitrary cyclic cascades does not
establish admitted cyclic-delete support.

Native soft-delete/restore cascade maps and hard-delete root events remain
framework behavior. Six deleted graph/pivot rows can correctly produce one
native Product event. Do not synthesize one event per physical/logical row.
Product has no demonstrated optional mid-operation flush promise. The actual
Tax checkpoint remains a separate retained capability until its consumer moves.

## Durable events

Current native events are durable envelopes with authenticated contracts,
ordered event-family validation and per-subscriber fenced delivery state,
committed atomically with the outcome. Result JSON alone cannot replace them.
Represent required native event and delivery state as private logical records
over the five tables, joined to the same Core root/outcome. Reuse the genuine
event contract/sealing and delivery semantics; do not add another publisher,
transaction, builtin bootstrap requirement for unrelated frozen profiles,
or physical outbox family. Migrate the relevant reader/delivery consumers.

The subscriber interface reports typed failures, including timeout. The pump
must project their `retryable` and `code` fields into plain settlement data before
the storage boundary's strict capture. Passing the tagged error instance itself
is rejected as `invalidInput` and loses the required pending/failed delivery
transition. Keep strict no-getter storage admission; correct this conversion at
the event pump owner and exercise actual failing and timed-out handlers.

CMS permission and reverse-page reads must also preserve the complete stopped
Core Cause while projecting its typed failure reasons. A stopped owner can carry
typed failures, defects, interruption and annotations together. Reuse the CMS
Cause-preserving projection; mapping only the typed channel must not discard
the other reasons or let a caught failure escape the sticky request lifetime.

## Native admission and displaced activity receipts

Preserve [explicit caller retry after proven noncommit](../divergences/native-proven-noncommit-retry.md)
for the selected Product and protected profiles, with fresh live authority and
the same correlated key. This is distinct from automatic callback replay or
abandoned/uncertain recovery. The existing initializer and omitted ordinary
profiles retain their recorded behavior.

The translated shared Core failure taxonomy replaces the private SQL-command
wrapper's `statementFailure` presentation with `resourceFailure` for settled
driver failures that are not otherwise classified. Preserve the original
SQLSTATE/full Cause, settled rollback, callback-once behavior and separate
uncertain outcome handling. Native Medusa business errors are unchanged. A
trigger-raised `57014` is a cancellation witness, not elapsed timeout proof;
the shared driver retains its narrow genuine statement-timeout classification.

A focused independent challenge distinguishes real native behavior from the old
SQL/journal activity observer. The direct replacement runs genuine registered
Product callbacks; request data cannot register callbacks or submit recorded
mutation/event transcripts. Product preparation must select its official opaque
command tokens and event grammar. The generic host authenticates those exact
tokens and modes; Core enforces shared constraints, read-only capabilities,
sticky mutation failure and settlement. Genuine repositories own business
ownership, returned rows and subscribed events.

Do not rebuild the displaced Facts/activity receipt engine merely to preserve
tests that fabricate transcripts or corrupt trusted validator callbacks. Preserve
foreign/same-name command-token refusal at Product preparation and actual native
result/lifecycle/event regressions. A genuine business mismatch belongs to its
native owner. Accepting untrusted recorded native claims would require a separate
authenticated activity contract and is not introduced by this direct profile.

## Coordinated ownership

All runtime work occurs in the clean verification checkout at the baseline.
The main checkout's unrelated WIP is protected. Agree the shared contracts before
dependent edits; coordinate shared-file hunks explicitly.

| Owner | Responsibility |
| --- | --- |
| Schema and policy | Generic native row/tuple identity, conditional uniqueness, complete FK/index lowering, authenticated schema/policy closure and logical lifecycle. |
| Core integrity | Transaction/native mutation and closure preparation, original/final graph validation, pending/suffix acceptance and save prerequisites; sole central transaction/API owner. |
| Medusa integration | Generic native query execution and Commerce participant adaptation; genuine Product/Link repository, category, lifecycle and event capture behavior. |
| Protected consumers | Existing reference read/save/reverse, mixed-root participation, selective metadata and historical committed recovery; sole Core database request/recovery owner. |
| Root integration | Durable logical event/delivery owner, genuine runner and original cases, resources, conformance, cleanup, review and exact projection/commit. |

## Necessary differences

Record and implement only the native mechanisms Source lacks:
[native relational FKs](../divergences/native-relational-foreign-keys.md),
[conditional uniqueness](../divergences/native-conditional-uniqueness.md),
[relational query translation](../divergences/native-relational-query-plans.md),
[durable event delivery](../divergences/native-durable-event-delivery.md) and
[protected historical recovery](../divergences/native-protected-outcome-recovery.md),
[installed source selection](../divergences/native-source-binding-selection.md) and
[private Worker context](../divergences/native-protected-worker-context.md).
Reuse the existing native observation, root-participation and dependent-save
records; these are extensions of the same owners, not another engine.
Old scalar/Currency/optional-one/many frozen source shapes and bootstrap remain
unchanged unless an actual named migration is required.

## Correctness, cutover and retirement

The [scoped app-owner recovery prerequisite](./16a-app-owner-recovery.md) connects
escaping persistence failures to shared reconstruction and later explicit native
retry. The translated committer's stopped state must not be bypassed to make the
Product fault tests pass. The connected serving lifecycle and its genuine
consumer witnesses now use that owner; the wider retained consumers below remain
separate migration work.

The shared physical writer uses the pinned PostgreSQL adapter's 1,024-row
statement bound (`crates/postgres/src/lib.rs:563`) inside one fenced transaction.
The displaced 60,000-parameter VALUES batching was an unnecessary difference:
PGlite 0.5.8 reads ParameterDescription counts as signed 16-bit values, so a
59,994-parameter statement throws during protocol parsing and can surface as a
misleading empty lease check. Keep lease authority unchanged and exercise a
large ordinary-index batch at the persistence owner. This correction establishes
neither general provider fault hardening nor complete-request performance.

Native integrity preparation merges its actual query intervals with the
transaction's charged interval set. Pinned `reads.rs` charges the merged range
count; adding a second scalar count for already-consumed closure ranges is not
the same mechanism. Keep real dependency frontiers, examined documents and
nonrefundable work, with the same resource ceilings.

Before runtime claims, characterize the genuine existing Product/Link behavior.
Then run the original Product case inventory through the replacement, complete
Link/lifecycle/category/event/reference consumers, neutral shared-owner witnesses,
and old selected native regressions. Exercise nullable/partial uniqueness,
restores, FK replacement and closure races, noAction failure, unpublished
predecessor failure, missing endpoints, sticky caught failure, cold replay,
lost acknowledgement, withdrawn-binding LB4 and native callback/event once-only.
Run PGlite and focused ordinary-role real PostgreSQL separately. Existing Worker
consumers require an actual Worker proof, independently from Node/PostgreSQL.

Remove selected old dispatch, installers, fixtures, exports and duplicate
algorithms when their genuine consumers migrate. Retained old owners must name
their remaining modules/obligations and removal gates. No identified external
Product dataset has yet been established in this closure; that is not proof
of absence and authorizes no reset or unspecified conversion. No DDL, durable
ID rewrite or new migration engine is selected.

### Named retained consumers

The selected protected Core consumers have moved to the five
`nativeProtected*.workerd.test.ts` entries. Their business, authorization, race,
reverse-page and whole-outcome recovery assertions do not exercise the retained
finite/journal engine. Keep that distinction when selecting regression evidence.

An independent, backup-aware consumer audit found no orphan among the 28
`flarex-backend/test/support/privatePayload*.ts` helpers and no justified
whole-entry deletion among the 17 old Save, Reverse, Binding and mixed-reference
test entries. They remain **Legacy finite/journal coverage** for these named
consumers and contracts:

| Retained owner or consumer | Remaining obligation and removal gate |
| --- | --- |
| Private Save serving/recovery/concurrency entries and old Save constructors | Finite syscall/profile receipts, same-sequence grant authentication, `retryFailedAttempt`, publication locks and cancellation before receipt acknowledgement. Migrate the protected `privatePayloadReferenceSaves.test.ts` and `privatePayloadAutomaticRetryRefusal.test.ts` closure before removing these branches. |
| Private Reverse evidence/page/freshness/recovery/restart/serving/scope entries | Frozen page dependency grammar, receipt replay, exact `{ deploymentId, scopeId, sessionId, attemptFence }` selectors and reconstruction of the stored result/token after producer closure. Retire with the last finite borrowed-reference consumer and its owner proof. |
| Private Binding lifecycle/freshness/ordering/recovery entries | Candidate/build/activation refusal, historical activation receipts, finite retry tickets and selector recovery. Core committed-save replay alone does not replace these catalog and finite-session proofs. Retire with their finite binding owner. |
| Old mixed-reference entries, `privatePayloadSaveExecution.ts` and associated helpers | Remaining finite borrowed-grant authentication, whole-attempt retry, later-publication-page integrity, rollback and cancellation. Migrate protected mixed concurrency and finite automatic system consumers before deleting their shared fixture branches. |
| `makePayloadReferenceReadRuntime` in `runtime/referenceRead.ts` | The protected `executor/test/performance/support/mixedMutationProductFixture.ts` still calls this finite profile. Migrate that named consumer before removing the old factory; performance measurement stays paused. |
| `medusa-adapter/test/support/logical-product-runner.ts` | The paused `benchmarks/core-performance/native-retrieval/scenario.ts` still uses it. Move that workload construction to the current Core before removing the runner; this retention does not authorize a measurement run. |
| Existing Tax checkpoint and remaining commerce/workflow hosts | These still serve native modules outside this selected Product/Links closure. Migrate their actual callers and settle named durable-data obligations before retiring their shared owners. |

Main-protected WIP is a preservation constraint for this scoped commit, not proof
of a permanent compatibility contract. A later connected cutover must translate
or explicitly disposition each displaced finite mechanism, preserve required
behavior, then remove its callers, tests, fixtures, exports and owners together.
Do not count the retained tests as proof that the new Core path passed.

The selected unused category/type runner files, old managed-read entry and old
scale telemetry helper are removed with their migrated callers. No broader
helper deletion or data reset follows from that cleanup.

Run affected Oxc typechecks, source/compatibility guards, core/diff lint and both
required independent reviews. Record commands/receipts in Git, not a competing
roadmap log. Only reviewed clean blobs may be projected into Main, preserving
unrelated files and protected generated/schema bytes; commit the completed
connected scope. The full goal remains active until every goal gate is met.

