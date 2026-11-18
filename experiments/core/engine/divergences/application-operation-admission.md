# Fresh Application operation admission

Design status: **Selected preservation of the existing Application guarantee**.
Implementation status: **Bounded connected replacement implemented**.
Measurement status: **Unmeasured**.
Owner: [04C Standard mutation cutover](../slices/04c-standard-mutation-cutover.md).
The [04C1 implementation contract](../slices/04c1-application-operation-admission.md)
records the independent challenge, exact ownership and required counterexamples.

## Pinned mechanism and required difference

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`, root authentication
constructs an Identity before execution; ordinary nested calls inherit it with
the same transaction. The trusted [nested syscall and identity reader](../../../../../../crates/isolate/src/environment/udf/async_syscall.rs)
do not implement Flarex's per-operation engine-grant revocation fence.
[Function validation](../../../../../../crates/udf/src/validation.rs) separately
resolves kind, visibility and arguments through the transaction.

Flarex's existing durable Application journal admits an exact running attempt
before returning an operation value or replay. Authority-row shared locking
orders that admission against revocation. A cached snapshot, process-local
openness check, heartbeat or eventual publication refusal cannot replace that
earlier Worker-visible boundary. The accepted read-authorization and operation
lifetime contracts preserve it during the core replacement.

## Reuse the existing capture owner

The installed finite storage-capture function already has a genuine header-only
path: null table/index/unique identifiers bypass business-row/readiness bodies.
Its authority/session shared locks authenticate exact anchor bytes/digest,
request/grant pins, fence and claim; database time is sampled after lock waits.
Lifecycle, lease/claim/grant/hard expiry, generation, scope epoch, revocation and
retained floor are checked without renewing a lease or writing state.

Add a named admission operation/envelope through the existing capture owner and
Drizzle compiler. Return only its accepted-header verdict with an empty business
body. Require a genuine Application clock demand with no participant demand;
force null table/index/unique selectors so a foreign demand cannot enter business
or readiness branches. Retain exact root/anchor, metadata issuer/host lifetime
and installed-function authentication. The retirement operation is unsuitable because
its owner deliberately treats several terminal/missing cases as successful
retirement.

The authority-only operation itself needs no SQL signature change. Exact journal
failure classification additionally needs actual non-running lifecycle evidence:
the current lifecycleChanged capture refusal lacks the value required by the
existing attemptNotRunning issue. Reuse the session_row frontier field for this
refusal, project only lifecycle, decode it through the existing lifecycle owner
and reject a running/malformed value as corruption. Canonical replacement-frontier
validation remains earlier than stale-fence reporting.

That enrichment changes the canonical function body and therefore requires a
forward migration with the identical body and installation-hash parity. Preserve
existing migrations, the managed maintenance/quiescence gate, 16-argument
signature, privileges, VOLATILE, SECURITY INVOKER, search path and frontier types.
No table/data deletion or request/outcome codec change is selected.

## One compound operation owns admission and evaluation

Use Application journal compound operations for point-by-table-name and indexed
range-by-table/descriptor. The executor's existing semaphore covers the whole
operation. Persistence owns fresh admission, catalog resolution and evaluation;
admitted resolver/evaluator helpers stay private to that call. No reusable
admission token or SQL capability escapes, and no transaction spans user code.
The RPC adapter forwards the compound call while retaining ordering, sequence
and result projection.

One root in-flight lifetime must start before the header wait and span catalog
resolution and evaluation. Private preparation's outer count remains singular;
admitted inner helpers do not reacquire a semaphore or count a second operation.

Preserve method-specific staged decoder order: local attempt/table-name syntax
precedes admission. Read operation document-ID decoding follows admitted table
resolution; writes addressed by ID retain earlier local ID/table authentication.
Fresh admission precedes the table catalog verdict, descriptor decode/catalog
resolution, and strict operation decode at the current RPC phases. Move the
existing strict unknown decoder and its singular nominal error to the persistence
input owner; keep executor reexports and the distinct typed request-capture stage.
Use narrow input/error runtime exports for portable Worker consumers: the broad
journal API also reaches native private-access construction and PostgreSQL driver
dependencies. These exports retain the existing class definitions and codecs;
they do not introduce another authority or compatibility implementation.
Raw pinned-handle callers retain their
established syntax-decoder precedence and acquire their own one-call admission,
or migrate to the compound owner. A cached descriptor cannot authorize a later
operation.

Closed point/index evaluators retain their existing stateRejected result without
admission or frozen-state mutation. Closed resolvers refuse new admission;
the former raw index resolver's inert handle issuance after closure is removed
because no named live/public/durable consumer requires that ended-lifetime
behavior. Active raw handles remain supported. Private owners preserve their
own late-closure errors, and cleanup must never turn a frozen root into aborted.

Private Application command and reference-permission callers require explicit
coverage under their existing capabilities. Internal Application functions share
the same Worker journal. Borrowed native participants and native admitted
working sets retain their distinct tentative/fresh-storage profiles. This does
not enable the currently refused finite incoming-relation read path.

Business misses still execute their existing capture body and fresh header. The
compound operation avoids duplicate admission-only queries for resolver plus
evaluator; it does not lend a previous verdict to a later storage command.

## Failure and lifetime contract

Map authenticated capture refusals through the existing journal failure owner:

| Capture reason | Existing journal issue |
| --- | --- |
| attemptMissing | sessionMissing |
| attemptReplaced | staleAttemptFence after canonical frontier validation |
| ownershipChanged | executionClaimUnavailable |
| expired | activeAttemptExpired |
| lifecycleChanged | attemptNotRunning with actual decoded lifecycle |
| storage generation, fence, scope epoch or authorization revocation change | Preserve the corresponding existing issue |

Issuer/host/routing failures remain genuine capture failures; they must not be
invented session facts. Preserve corruption/resource distinctions, original
causes, defects, interruption and full combined Causes. Admission refusal poisons
the root before rejection. Keep the existing isolated pre-stage point document
validation exception catchable; do not broaden it to authority failures.

The installed Effect RC.112 maps a typed failure through recovery that can drop
other reasons in a combined Cause. Owning journal projections therefore map only
failure reasons with Cause.map inside catchCause/failCause. Genuine capture and
current Worker witnesses combine committed revocation with cleanup defect and
interruption, preserving the original refusal, defect identity and interrupting
fiber ID through both journal layers. Trace annotations may be enriched without
changing those reasons. Pure Result and isolated decoder projections keep their
existing contracts.

The durable target/admission projection follows the same rule: its actual
transaction-settlement owner can combine callback refusal and rollback failure.
Both reasons must survive before reaching the compound operation's outer
projection. Keep the existing refusal classifier and native execution profiles.

Trusted private-command preparation keeps its existing local eligibility refusal
without aborting previously valid reads. Preserve only a single failure whose
identity was recorded by that call's own capability-mint precondition checks.
The earlier header failure has no such marker. Revocation, defect, interruption
and combined Causes remain sticky; this trusted preparation rule does not widen
Worker syscall catchability.

Retain the existing finite header's refusal priority: claim ownership, lifecycle,
expiry and then revocation among these conditions. Durable admission can select
revocation earlier. Worker code receives the same opaque terminal stop, while
trusted invocation callers retain the exact issue/Cause and can observe this
profile-qualified diagnostic difference. Test simultaneous refusals, preserve
durable compounds' existing behavior and do not claim cross-profile multi-fault
parity or reorder shared native capture checks. Nonacceptance rejection advances
the claim fence, while the distinct terminalization abort owner retains it.
Exercise those actual writers separately; a direct lifecycle-only update can
violate the session evidence contract and does not prove a legitimate transition.

## Executing owners

| Responsibility | Current owner |
| --- | --- |
| Genuine header-only admission and minimal lifecycle refusal | [captureFiniteStorageEffect](../../../../packages/persistence-postgres/src/execution/finiteStorageCapture.ts), its [scalar projection](../../../../packages/persistence-postgres/src/execution/finiteStorageCaptureProjection.ts), and the canonical function installed by [0155](../../../../packages/persistence-postgres/drizzle/0155_application_operation_admission.sql). |
| One operation lifetime before the header wait | [withFiniteApplicationOperation](../../../../packages/persistence-postgres/src/execution/journal/finiteRoot.ts); the same root owns counting, terminal failure and frozen evidence. |
| Compound point/range evaluation and private command preparation | [makePointOperations](../../../../packages/persistence-postgres/src/execution/journal/pointOperations.ts) and [makeIndexedQueries](../../../../packages/persistence-postgres/src/execution/journal/indexedQueries.ts); lexical helpers keep admission inside the call. |
| Trusted refusal classification and complete failure propagation | [journalFailures](../../../../packages/persistence-postgres/src/execution/journal/journalFailures.ts), [targetAdmission](../../../../packages/persistence-postgres/src/execution/journal/targetAdmission.ts), and [pointMutationJournal](../../../../packages/executor/src/mutation/journal/pointMutationJournal.ts). |
| Strict unknown input and portable nominal failures | [operationInput](../../../../packages/persistence-postgres/src/execution/journal/operationInput.ts), the existing [journal errors](../../../../packages/persistence-postgres/src/execution/journal/errors.ts), and [runner errors](../../../../packages/executor/src/mutation/runtime/pointMutationRunnerErrors.ts), exposed through narrow runtime exports. |
| Current Worker boundary | [applicationPointMutationJournalCapability](../../../../packages/executor/src/mutation/journal/applicationPointMutationJournalCapability.ts) forwards compound calls under the existing coordinator and retains opaque terminal errors. |

The current Application path's displaced split resolver/evaluator choreography is
removed. Active historical raw-handle callers remain named consumers, each with
fresh admission under its existing decoding contract. This does not activate the
ordinary Standard finite path or move mutation coordination into the DO.

## Costs, required evidence and removal gate

Known/replayed operations retain a fresh authority SQL round trip. Removing
per-syscall journal persistence does not mean every local operation becomes
zero-I/O. A later fenced-owner protocol can replace this check only after every
revocation/authority writer participates and the ordering proof is complete.
Complete-request performance remains unmeasured; helper or statement counts are
not acceptance.

Use genuine activated reservations, actual revocation writers and current Worker
composition. Required cases include known hit and exact receipt replay after
revocation; invalid pending-key and missing catalog verdict precedence; positive
replay/accounting controls; post-lock-wait expiry; unchanged lease/claim times;
one header-only statement per compound known request; exact missing/replaced/claim/
lifecycle/epoch mapping; malformed frontier/header ordering; combined Causes; and
native profile separation. Run shared PGlite/ordinary PostgreSQL cases and real
PostgreSQL lock/race tests. Fabricated roots and no-op admission fixtures do not
prove this boundary.

Post-wait expiry uses an owner-issued claim duration. Establish the actual
pg_blocking_pids wait while database time is still before the stored deadline,
then cross that deadline before release; an already-expired start is not the
required witness. Replacement-frontier tests use retained genuine capture work
under its active host lifetime, preserving the frozen journal's terminal state.
