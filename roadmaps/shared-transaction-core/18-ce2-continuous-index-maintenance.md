# CE2 Continuous Index Maintenance Preflight

Status: ordered-index continuous maintenance implemented through the
[activation cutover](./23-ce2-activation-maintenance-cutover.md), followed by
[unique maintenance](./26-ce2-unique-maintenance-cutover.md). Matched request measurements and wider concurrency acceptance
remain open; this is not complete CE2.

## Outcome And Evidence

An enabled ordered index maintained by the current active Application must not
need a build-state UPDATE on every ordinary row commit. Its readers still need
proof that every applicable write was indexed. Keep the scope clock and current
settlement owner while replacing that per-index progress write with an
activation-bound continuous-maintenance contract. Index-build work and physical
retirement retain their existing owners.

The shared contract is implemented across these existing owners:

| Owner | Current responsibility and necessary change |
| --- | --- |
| `applicationDocumentMaterialization/materialization.ts` | Reads selected intrinsic/developer builds with share protection, authenticates continuous coverage at the preceding commit and applies memberships without enabled serving progress updates. Application material publication and shared participants require issued ports and exact selections. Bounded no-active/non-enabled paths keep their lifecycle progress. |
| `pointCommitTransaction.ts` | Application execution validates the active schema under the clock. The shared write-ownership guard now excludes legacy material/attempted writes and missing attempted-write evidence under all active head contracts. Contracts 1/2 retain authenticated read-only legacy settlement; contract 3 retains its stronger generation rule. |
| `cmsTransaction/admission.ts` | Accepts and checks the current Application binding, schema and Payload binding before participant work. Preserve that admission and pass the same core maintenance selection to shared materialization. |
| `indexBuildStates.ts` | `isIndexBuildSnapshotCoveredInTransactionEffect` owns bounded and continuous coverage. It checks scope/build fences, first-readable and current head/schema/definition agreement; uncertified inactive builds retain explicit coverage or the unchanged-table suffix proof. |
| `application/readiness/`, `application/activation/activationPersistence.ts` | Readiness authenticates physical requirements and coverage; activation locks the scope and changes the active head. Activation atomically opens, carries forward and closes maintenance obligations with that head. |
| `intrinsicCreationTimeIndexBuildV1.ts` | Initial validation establishes first-readable coverage; enabled catch-up replays original committed changes. Candidate-only work still uses this bounded reconciliation. It must not be mistaken for continuous active maintenance. |
| `applicationQuerySnapshot.ts`, `sessionJournalStore.ts` | Index admission checks first-readable and coverage before scanning or accepting journal evidence. Both consume the shared replacement proof, including historical snapshots. |
| `retainedIndexHistoryCompaction.ts` | Preserves each membership anchor at the retained floor under the scope guard. Continuous coverage does not authorize deleting anchors, moving the floor or pretending missing catch-up history exists. |

The connected witness is the managed-schema B scenario: B's candidate index is
enabled, A remains active and accepts writes, stale B readiness refuses, then
catch-up and replan make B safe to activate. Candidate-only definitions must not
impose their constraints, oversized keys or fanout on A. The existing
`08-index-coverage-correction.md` remains authoritative for that distinction.

## Readable-Index Invariant

For a requested snapshot S and locked scope head H, require current scope,
generation/epoch/attempt fences, a readable physical lifecycle, retained history,
and `firstReadable <= S <= H`. Membership history and returned-row dependencies
remain independently authenticated.

Then establish completeness using one of the existing build owner's two states:

1. **Bounded coverage:** completed coverage B reaches S, or the existing exact
   unchanged-table proof covers the suffix. This remains necessary for inactive
   and candidate-only definitions; it is not a fallback serving engine.
2. **Continuous maintenance:** a durable maintenance binding matches the current
   coherent active head and its closed physical requirements, with the same
   definition and build fences. That binding was opened only after completeness
   through its opening head was proved. Every later writer of its table must
   maintain the exact obligated definition set in its successful transaction.
   Therefore completeness extends to H without advancing B on each commit.

The maintenance binding belongs to target build/activation metadata. It binds
the existing activation sequence and immutable requirement identity; it is not
an expiring lease, host cache, adapter boolean or independent registry. Existing
covered-through state remains the last explicitly sealed complete prefix.
First-readable stays immutable. A missing, mismatched or malformed binding never
grants continuous coverage. Final columns and codecs belong to the focused
schema implementation, with exact decoding and cross-field constraints. The
[activation maintenance cutover](./23-ce2-activation-maintenance-cutover.md)
selects the per-build certificate, activation transitions, transaction-local
coverage context and existing-data cutover for that implementation.

## Necessary Writer Boundary

Before activating this contract, make the required ordered-definition selection
mandatory for serving writes. Reuse the canonical published physical-requirement
snapshot, existing located-definition owners and accepted Application binding.
Prepare immutable metadata outside the final transaction where possible; check
the fresh active-head/authority identity inside it. Do not scan the entire
catalog or hash installation history on each row request.

The trusted shared constructor must produce the complete subset for touched
tables, and materialization must reject missing, extra, wrong-scope or stale
selections. Supplying no port must not silently mean that an obligated table has
no indexes. A caller-supplied list or successful callback cannot certify closure.
Apply the same boundary to native and CMS consumers; preserve their distinct
execution profiles and one outer settlement authority.

Inventory `pointMutationExactRuntimeRunner`, `pointMutationSessionActivation`,
stored-attempt recovery and private publication fixtures before cutting over the
legacy generation. No legacy or lower-level publication entry may change an
obligated table while bypassing this check. Migrate serving callers to the shared
selection or refuse the write before row changes. Raw storage tests can continue
to test transaction primitives, but cannot mint or exercise continuous serving
authority without real activation/composition. Do not introduce a legacy writer
fallback or preserve optional serving composition to avoid migrating fixtures.
Already-durable outcome replay is distinct from admitting another write.

## Activation And Lifecycle Protocol

Under the existing scope-clock and active-head order:

- **Open:** require ordinary readiness and completeness through H, establish the
  maintenance binding for the new head's exact required definitions, and publish
  that head atomically. An enabled flag alone cannot open the binding.
- **Carry forward:** authenticate shared physical definitions under the outgoing
  binding, then bind them to the incoming activation without resetting entries,
  first-readable or build identity.
- **Close:** before a definition leaves active obligations, seal its coverage at
  H and clear its continuous binding in the same transaction as the head change.
  Later candidate reads use bounded coverage/catch-up. A later reactivation must
  bridge the entire gap; it cannot reset or backdate already-readable history.
- **Reconcile/build:** candidate-only indexes retain bounded catch-up. An active
  continuously maintained definition must not be independently replayed by a
  builder using its deliberately older sealed coverage as a backlog.
- **Fence/drain/retire:** preserve physical catalog leases and current authority
  checks. A generation/epoch or attempt change invalidates the maintenance proof.
  A draining/retired definition cannot serve merely because its binding exists.
- **Rollback/uncertain COMMIT:** the head, bindings and sealed prefixes have one
  atomic outcome. Reuse activation replay and settlement recovery; never repair
  a partial lifecycle transition from a host-side assumption.

Readers must take a coherent view of head and build state under their existing
transaction guards. An older snapshot is still eligible after deactivation when
the sealed prefix covers it. Mutable maintenance/coverage metadata must not
change the immutable readiness digest or invalidate a legitimate active token.

The implementation retains the scope clock. Enabled serving writers use share
protection on build rows and no longer update their covered-through frontier. Builders and
validating-index cursor resets still own their writes. This does not prove two
same-scope commits overlap; CE3 owns that separate protocol and measurement.

## Cutover, Cleanup And Slice Sequence

The [exact developer selection slice](./19-ce2-exact-developer-index-selection.md)
closes partial lookup in the issued control-catalog port using the verified
published requirement snapshot. The [required composition slice](./20-ce2-required-ordered-index-composition.md)
requires genuine intrinsic/developer ports from the serving control database
for Application material publication and shared participants. [Legacy-writer exclusion](./21-ce2-legacy-writer-exclusion.md)
closes material and attempted legacy publication against active obligations,
including net-zero attempts and missing write evidence. Natural relation-source
fixtures use Application admission; retained read-only attempts carry their
authenticated journals. [Required intrinsic build state](./22-ce2-required-intrinsic-build-state.md)
closes the materializer's remaining missing-row skip: each selected intrinsic
definition must have its build metadata. These prerequisites do not establish
continuous coverage by themselves. The implemented activation cutover completes
the following ordered-index sequence:

1. Close exact writer composition and its refusal witnesses through the existing
   shared owner. Migrate native/CMS construction and named legacy publication
   callers; keep current coverage semantics until that gate passes.
2. Implement activation-bound maintenance metadata and its open/carry/close
   transitions, then change all coverage readers and builder reconciliation as
   one coherent serving cutover. Existing enabled rows start without fabricated
   continuous authority. Certification must authenticate the current head,
   requirements, fences and real coverage; uncertain rows refuse or follow an
   explicitly authorized reconciliation. No row/index data reset is implied.
3. Remove displaced per-commit enabled-index coverage writes and unnecessary
   exclusive access, plus obsolete optional composition and test expectations.
   Retain bounded candidate coverage, first-readable state, physical lifecycle
   guards and validating-index resets for their actual consumers.

Do not ship an inert field as completed CE2 or leave old/new serving selection
behind a compatibility switch. Initial implementation is ordered-index scoped;
unique workspaces have a distinct current-ownership reconciliation contract.
Their analogous coverage optimization needs its own connected follow-on using
the same active-selection authority, not an automatically generalized history
algorithm or another transaction API. CE2 remains open while applicable
enabled-index/constraint metadata contention and acceptance gates remain open.

## Validation And Completion

Preserve the existing migration/unknown-coverage, canonical corruption,
first-readable, candidate catch-up, whole-commit, retained-gap, oversized-key and
uncertain-build witnesses. Add real native/CMS proofs for missing or partial
composition, old active selections, and legacy attempts against active
obligations. Refusal must precede row/index/publication changes.

Prove activation A-to-B with shared, added and removed physical definitions;
historical reads before/after close; reactivation after A-only writes; builder
work concurrent with activation; drain/retire and stale fences; and rollback or
lost acknowledgement at each binding/head boundary. PGlite covers semantics;
ordinary-role PostgreSQL with separate connections proves actual waiting,
ordering and recovery behavior. Include compaction and native/CMS regressions.

Measure the same publication workload before/after, with actual active
Application authority as well as the private primitive baseline. Check that
ordinary enabled-index build tuples no longer change and count the removed SQL.
Measure disjoint records sharing one enabled index while explicitly attributing
remaining scope-clock exclusion. Keep observer calibration and normal latency
separate; no concurrency or production-scale claim follows from fewer statements.

Out-of-band database mutation remains corruption, not a supported writer.
Retain existing malformed frontier, fence, pointer and canonical-byte refusal
tests. Continuous authority proves sanctioned writer closure, not a fresh
whole-index rebuild/hash on every request. Do not weaken existing corruption
witnesses to accommodate the new representation.
