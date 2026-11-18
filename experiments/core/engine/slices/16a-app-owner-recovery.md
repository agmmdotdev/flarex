# Scoped app-owner recovery prerequisite

Status: **Selected shared implementation, connected owner/DO/native consumer
proof and independent review complete; broader goal gates remain open.**
Owner: [Native Product and protected replacement](./16-native-product-links-and-references.md).
Baseline and pin are the same as that slice. This is a connected prerequisite,
not permission to leave its SQL-failure/manual-retry consumer incomplete.

## Existing contract and Source mechanism

The [accepted recovery contract](../01-commit-coordination.md#accepted-uncertainty-recovery)
requires the app owner to stop acceptance/publication, fence and drain old work,
reconcile every in-flight durable outcome, rebuild its committed state/caches,
and resume under valid ownership. Normal reads remain gated during recovery.

Pinned `committer.rs` stops after an escaping persistence failure and requires
reconstruction from durable storage. Its write batcher retries only named
transient storage failures on the same derived batch, without native callback
execution. Preserve that stop rule. Current Core follows it, but the app DO's
close is terminal and no portable supervisor connects reconstruction to native
serving. Product's same-key retry after settled SQL rollback exposes this gap.

## Challenged boundary

- The portable owner supervises one complete app generation above the existing
  Core open/bootstrap/close and trusted profile construction. Cloudflare supplies
  hosting, cancellation, storage and wake adapters. Do not restart unrelated apps.
- Stop admitting new work before recovery. Cancel and join actual Worker/native
  invocation lifetimes, retire prepared profiles, drain the entire old owning
  Scope and settle all database saves. Retiring a prepared host alone is not a
  drain; closing only its database leaves scoped save children outside the proof.
- Keep a bounded census of unresolved request correlations before claim-save
  submission, including acknowledgement loss before a claim token is issued.
  Retain request-bearing commits through uncertainty. Never evict unresolved
  identities to make room, and do not derive the census from the stopped
  committer's cleared accepted tree or its non-enumerable claim WeakMap.
- Acquire successor ownership through existing PostgreSQL lease fencing and
  bootstrap. Reconcile every censused request through existing outcome owners.
  Preserve independently durable saves and prevent unsaved dependent successes.
  Reconstruct claimless schema/admin state from actual durable storage; return
  its original failure rather than inventing an outcome or replaying its body.
- Rebuild generation-local invocation Layers, native bindings, claims, caches
  and prepared profiles. A raw database proxy cannot make old WeakMap-issued
  capabilities valid in the successor. Do not rerun application callbacks or
  silently restore withdrawn schema/native selections during reconstruction.
- Committed outcomes disclose without replay. A later explicit caller retry
  requires current authority and fenced proof of noncommit. Busy/unresolved
  outcomes remain blocked. Omitted frozen profile contracts remain unchanged.

The three readers converge on a scoped portable app-generation supervisor with
`use`, `recover` and `close`. A trusted `prepare(database)` builds generation-local
services and lazy profile factories. `use` executes its callback once; it never
retries an application/native body. The existing Core opening API remains intact;
an internal opening companion supplies failure notification and the bounded
request census. Supervision and recovery run outside the generation's tracked
invocation set to avoid cancelling or joining themselves.

Recovery is sequential: seal admission/census; interrupt and join invocations;
close Core and the whole generation Scope; open/fence/bootstrap the successor;
reconcile every captured correlation; build fresh services; publish readiness.
Any failed step leaves serving unavailable. Lazy binding construction preserves
unrelated service availability and historically authenticated recovery when a
particular native source is withdrawn. Rebuilding is not schema installation or
selection restoration.

The selected optional policy is `retryProvenNoncommit`: it admits explicit caller
retry after either an explicit abort or existing recovery's fully fenced proof
of outcome absence. One recovered request alone does not establish app readiness.
The earlier proposed `retryProvenAborts` spelling is replaced before cutover;
omitted frozen profiles keep their exact frames and behavior.

A driver error
named `unavailable` or `timeout` alone is not proof of rollback. Continuing a
poisoned committer, adding a Product retry loop or reopening only a test fixture
does not implement this requirement.

## Coordinated ownership

| Owner | Scope |
| --- | --- |
| Core owner | Portable supervisor, private failure/census companion, request policy and owner conformance cases. |
| Cloudflare adapter | Canonical DO generation/service construction, admissions/alarms/close integration and actual-host proof. |
| Product consumer | Genuine Product generation construction, stable facade borrowing and unchanged same-key SQL witnesses. |
| Protected consumer | Fresh Worker/live profile construction and historical-first native ports; no eager withdrawn binding restoration. |

Workers coordinate shared contracts before dependent edits. All changes remain
in the clean verification checkout; protected Main work stays untouched.

## Executing replacement

The [portable supervisor](../../../../packages/persistence-postgres/src/core/applicationOwner.ts)
uses the existing [database opening companion](../../../../packages/persistence-postgres/src/core/database.ts)
and [bounded request census](../../../../packages/persistence-postgres/src/core/recoveryJournal.ts).
The [committer](../../../../packages/persistence-postgres/src/core/committer.ts)
retains its original terminal stop rule and publishes an immutable failure
signal before clearing accepted work. Retired invocations preserve that original
Cause even when their trusted HTTP layer had materialized an error response.

The [DO adapter](../../../../apps/executor/src/applicationDO.ts) builds fresh
Application service contexts per generation. Its tracked maintenance port is
available after reconciliation and before Application preparation finishes, so
the existing independent schema alarm can progress a boot-time schema wait.
The HTTP admission cap is unchanged; the owner reserves one additional bounded
maintenance slot. Boot-only installation has an explicit initial/recovery phase.
HTTP failure projection runs outside the generation's disclosure gate with the
full Cause. Existing foreign pool-event terminal-close behavior remains distinct
from reconstruction after an escaping Core persistence failure.

The [native facade](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeOwnerHost.ts)
borrows the supplied composite owner. Lazy selected profiles belong to the
generation; closing one facade drains its own borrowers and closes that profile,
not the app or unrelated readers. Repeated close callers retain one complete
settled outcome, including failure. New calls may await shared recovery before
executing once. Existing failed/revoked issued profiles require explicit fresh
selection; healthy recovery does not silently refresh their authority.

Current owner witnesses cover independent durable saves, unsaved dependents,
unknown claim/commit acknowledgements, stale capabilities, readiness/census
bounds and reconstruction failure on both database lanes. The actual DO retains
its boot/alarm/drain/fencing checks and resolves a lost acknowledgement within
the same app object. Genuine Product row/outcome cancellation and same-key caller
retry now use this owner. The selected Native16 Worker races and independent
review are complete. Its named Legacy consumers retain separate removal gates;
none of these establish performance acceptance.

## Connected proof and completion

Exercise actual Product row/outcome SQL cancellation, remove the fault, recover
the shared serving owner and explicitly retry the same key; verify callbacks
once per invocation, one successful durable result/event family and replay
without callbacks. Prove lost commit acknowledgement, independent/dependent
in-flight save dispositions, rejected stale claims/bindings, gated concurrent
reads, cancellation/drain, failed reconstruction and fresh profile creation.

Use PGlite, ordinary-role PostgreSQL and the actual app DO/Worker composition.
Keep original full Causes and separate unknown outcomes. No benchmark campaign,
new physical family, data reset, adapter settlement engine or automatic native
body retry is selected. The full goal remains active.
