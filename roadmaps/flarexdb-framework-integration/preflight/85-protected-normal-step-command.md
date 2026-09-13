# Protected Normal Step Command

Status: implemented within approved preflight 76 and phase 84. Normal steps and
claim progress reads use the protected command described here. Full finalization,
recovery and independent stored-reference readers retain their verification
contracts. Record 91 owns completed bounded redesign acceptance and cleanup.

## Outcome and owners

One normal step reads fresh locked progress and its direct completion references,
executes the existing fixed structural handler, and atomically records completion,
an event, and progress. The persistence package owns this command. The target
session continues to own connection admission, transactions, cancellation,
settlement, quarantine, and the excluded recovery session.

The displaced normal path entered full reconstruction in `loadLockedClaimState`, receipt
corroboration, event insertion, head-swap preparation, and post-write restoration.
Replacing only the first read would leave cumulative prefix work in the writes.
The replacement covers the whole command and progress reads, sharing the actual
root/sidecar insertions and head CAS with retained full-evidence operations.
Finalization and uncertain recovery retain their required full evidence checks.

## Stored working set

No schema or persisted identity changes are needed for this command.

| Stored owner | Working evidence and invariant |
| --- | --- |
| Collision head | Fresh row locked in the existing collision order; canonical head, plan/admission/attempt IDs, fence, lease, revision, completed count, receipt tail and event commitment. It remains the sole mutable progress authority. |
| Plan and admission | Immutable exact values authenticated when the run is opened. The private claim retains its issued attempt and these stable references. They are not cached live lease or progress authority. |
| Step receipts | Unique `(plan_storage_id, step_id)` and digest. Select only the chosen step's direct completion references, checking actual normalized identities, conditions, producer fence, and digest shape against the prepared plan and committed prefix. |
| Receipt dependencies | The new completion's exact ordered edges, including dependency receipt IDs and digests. Insert with its root and check the actual complete sidecar set before settlement. Existing creation-transaction guards close the set at commit. |
| Events | One completion event, plus a lease-renewal event when required. Both retain exact predecessor ID, sequence and digest. Validate stored occupants and canonical/normalized agreement. |
| Head update | Guard against the locked revision, digest, count and tail. Advance one completion with its exact receipt and event. Check actual affected and reread values; no fabricated successful row. |

The protected command does not decode every dependency's own dependency closure.
Those immutable completions were validated by their committing command or the
required full opening/recovery proof. The maintained contiguous-prefix invariant
and unique plan-step key identify which completions can satisfy the selected
step. Reading the transitive canonical payload of every direct reference would
reintroduce repeated edge work for high fan-out plans.

New normalized row projections require named Schema decoders. Existing canonical
bytes retain their authoritative codecs. Shape validation, exact selected
identities, runtime issuance, and database privileges remain distinct checks.
Evidence actually read must validate immediately. Full verification retains
historical canonical/sidecar/catalog corruption witnesses outside this working set.

## Command and failure flow

The command enters through an active opaque target transaction and the private
issued claim. It locks and validates progress, checks the database clock and live
fence/lease, and preserves the admitted additive-base checks and event budget.
Completion returns without DDL when all prepared steps are already committed.

Otherwise it renews the lease if required, selects exactly the next prepared
ordinal, loads direct completion references, and executes/checks the existing
handler.
Receipt, sidecars, event, and guarded head advance share that transaction. Any
refusal or malformed/conflicting occupant fails the transaction. No second
lifetime, fallback write, whole-installation transaction, or fixture shortcut is
introduced.

An uncertain response retains the exact attempted step and uses the existing
excluded recovery session. A full recovery read distinguishes committed evidence
from rollback and unreceipted physical structure before the existing bounded
retry. Normal execution must not infer settlement from an in-memory result.
Initial readiness publication still requires complete verification and catalog
agreement. Normal restart and publication opening remain separate completion
gates of preflight 76; optimizing this command alone does not complete them.

## Retention and cleanup

| Existing path | Disposition |
| --- | --- |
| Native connection protection and functional-only PGlite test driver | Retain without bypasses or a new protection flag. |
| Fixed structural runner and prepared definition | Retain; do not move DDL or semantic handlers into storage helpers. |
| Canonical codecs, normalized row decoding, insertion and CAS mechanics | Reuse with their existing owners. Factor the actual common storage operation when both full-evidence and protected commands need it; do not copy a second writer. |
| Full receipt/event/head repository operations | Retain only for named full verification, admission/takeover, finalization, recovery, and independent stored-reference contracts still consumed by those owners. Trace consumers before removal. |
| Normal full claim-prefix read, repeated write corroboration and post-write graph issuance | Replace together. No legacy mode or automatic fallback remains after the command passes its connected gates. |
| Internal step result's restored receipt graph | Remove from normal progress results. Current source-private callers consume the result kind and counts; no package-root export or persisted identity requires that graph. Recovery returns the same progress result. |

## Completion evidence

Keep the existing neutral fresh/additive, takeover, expiry, stale-fence,
cancellation, rollback, altered-result, unreceipted-DDL and uncertain-COMMIT
witnesses. Add deterministic working-set counts with increasing step and direct
edge inventories. Separate immutable opening/full-audit work from normal commands. Fresh command
witnesses cover the existing 7- and 15-step neutral profiles: one canonical new
receipt per step, one normalized reference per edge and prior tail, and one
sidecar per new edge, without recursive receipt/attempt/event restoration. The
separate direct-reference witness uses larger inventories. Additive base
authentication and retained-structure checks remain active on every command;
these fresh witnesses do not establish total additive installation complexity.

Run both PGlite and ordinary-role native PostgreSQL, preserving the actual native
protection witnesses. Exercise Product and Payload installation/binding consumers
without changing deadlines or native assertions. Both project reviews, scoped
lint/typechecks, resource cleanup and a coherent commit gate the replacement.
Record 74's frozen seventeen-table alternating timing samples, full linear audit,
indexed query-plan and memory evidence remain required for overall acceptance.
