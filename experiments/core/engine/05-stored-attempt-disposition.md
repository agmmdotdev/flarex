# Stored Application attempt disposition

Status: **Accepted retirement policy; implementation and connected proof open**. The
[04C3 source challenge](./slices/04c3-standard-finite-execution.md) established this
specific historical-data gap. The owner selected retirement of affected unfinished
Application attempts after PostgreSQL reconciles their outcome. This authorizes
that bounded lifecycle transition, not deletion, a new body or publication of an
unproven seal.

## Evidence and boundary

The [04A stored-data contract](./slices/04a-range-completion-evidence.md#stored-data-and-activation-boundary)
states that the range-producer correction does not repair saved receipts or
pre-fix open/sealed durable attempts. Later queries cannot reconstruct missing
observations at the original pending state. Existing integrity verification does
not prove semantic completeness.

For example, a cart range reads `[A, B]`, returns `[A]` with `isDone=false`, and
records only A/the returned prefix. B was the membership lookahead. Removing B
can change `isDone` without invalidating that old prefix. The new producer keeps
the lookahead evidence; an old saved seal does not acquire it retroactively.

Existing acquisition can expire eligible lease/grant failures or classify a dirty
open root for abort. Sealed roots may become `finishOnly`, and `finishing` uses
the durable finisher. These lifecycle verdicts do not prove an older range seal
safe. Inspect authenticated stored evidence before applying any disposition;
neither old code nor an old fixture alone proves a compatibility obligation.

Keep separate:

- **Committed outcome:** authenticate/correlate and replay the authoritative
  PostgreSQL result. Do not reject it because its old producer cannot run now.
- **Uncertain settlement:** reconcile through the existing owner. A missing
  acknowledgement does not establish absence or permit another body.
- **Affected uncommitted old attempt:** retire it through authenticated lifecycle
  owners after conclusive reconciliation. Never publish missing range evidence,
  synthesize a newer readset, or replay native hooks to hide the gap.

This decision concerns old Standard Application attempts. Historical `systemV1`
and native command consumers require their own actual obligation and authority;
it is not permission to retire every persisted execution profile.

## Accepted disposition

Retire affected old, uncommitted Standard Application attempts after authoritative
PostgreSQL settlement reconciliation. Preserve all committed outcomes and
historical evidence bytes. Refactor the existing authenticated lifecycle and
terminal-result owners for an in-place retained retirement transition. Ordinary
abort/expiry deletes evidence and cannot be reused unchanged. Do not invent a
second finalizer, reset tables or automatically enter a fresh body. A fresh
request requires conclusive old
nonacceptance and its own valid authority.

The selected order is:

1. Authenticate the stored request, identity/profile and exact original evidence.
2. Reconcile PostgreSQL settlement. A committed outcome remains replayable;
   an uncertain outcome remains recovery-only and never grants another execution.
3. Identify affected unfinished Application attempts whose old range evidence
   cannot establish safe continuation. Refuse unsafe finishing and retire them
   only after conclusive noncommit and the existing fencing/lifecycle preconditions.
4. Preserve historical records and immutable evidence. A lifecycle terminal marker
   does not authorize rewriting old reads, deleting receipts or resetting data.
5. Project the retirement through the actual terminal-result owner. Do not
   silently convert redispatch into a fresh mutation or replay native effects.

The alternative of preserving a compatibility finisher for an unproven old seal
is not selected. This does not retire every old profile or reject already
committed results. Historical `systemV1` and native command obligations remain
separate; unaffected evidence requires its actual classification rather than a
blanket age cutoff.

The [retained-retirement source challenge](./slices/04c3d-retained-application-attempt-retirement.md)
records independent findings and peer convergence on classification, final
publication fencing, retained lifecycle/schema handling, uncertainty and actual
consumer closure. Exact fields/codecs and the terminal projection must be recorded
before runtime edits. Reuse the existing settlement owner; record any necessary
public-contract difference explicitly. Existing result-expiry/tombstone semantics
remain committed outcomes, never permission to retire or execute them again.
Implementation must exercise the real lifecycle writers and recovery on both
databases. The policy is accepted; these implementation gates are not yet proven.
No data reset is authorized.

## References

- [04C cutover contract](./slices/04c-standard-mutation-cutover.md).
- [Stored acquisition](../../../packages/persistence-postgres/src/execution/claims/acquisition.ts),
  [durable redispatch](../../../packages/executor/src/mutation/authentication/stored/crashRedispatchOperations.ts)
  and [finite redispatch](../../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts).
- Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`:
  [session requests](../../../../../crates/model/src/session_requests/mod.rs) and
  [mutation retry](../../../../../crates/application/src/application_function_runner/mod.rs).
  Its success-outcome mechanism does not provide Flarex's old journal disposition.
