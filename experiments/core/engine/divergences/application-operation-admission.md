# Fresh Application operation admission

Design status: **Selected preservation of the existing Application guarantee**.
Implementation status: **Not implemented**. Measurement status: **Unmeasured**.
Owner: [04C Standard mutation cutover](../slices/04c-standard-mutation-cutover.md).

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
body. Retain genuine application demand, metadata issuer/host lifetime and exact
installed-function authentication. The retirement operation is unsuitable because
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
existing migrations, the 16-argument signature, privileges, SECURITY INVOKER and
frontier types. No table/data deletion or request/outcome codec change is selected.

## One compound operation owns admission and evaluation

Use Application journal compound operations for point-by-table-name and indexed
range-by-table/descriptor. The executor's existing semaphore covers the whole
operation. Persistence owns fresh admission, catalog resolution and evaluation;
admitted resolver/evaluator helpers stay private to that call. No reusable
admission token or SQL capability escapes, and no transaction spans user code.
The RPC adapter forwards the compound call while retaining ordering, sequence
and result projection.

Preserve current staged decoder order: local attempt/table-name/document-ID
authentication precedes admission; fresh admission precedes the table catalog
verdict, descriptor decode/catalog resolution, and operation decode/evaluation
where that is the current RPC order. Raw pinned-handle callers retain their
established syntax-decoder precedence and acquire their own one-call admission,
or migrate to the compound owner. A cached descriptor cannot authorize a later
operation.

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
