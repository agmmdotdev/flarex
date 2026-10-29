# Stored Application attempt disposition

Status: **Open owner decision for Standard cutover**. The
[04C3 source challenge](./slices/04c3-standard-finite-execution.md) established this
specific historical-data gap. It does not authorize deletion, retirement, a new
body, or publication of an unproven seal.

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
- **Uncommitted old attempt:** its continuation/retirement needs a safe policy.
  Never publish missing range evidence, synthesize a newer readset, or replay
  native hooks to hide the gap.

This decision concerns old Standard Application attempts. Historical `systemV1`
and native command consumers require their own actual obligation and authority;
it is not permission to retire every persisted execution profile.

## Proposed disposition for owner review

Prefer explicit retirement of affected old, uncommitted Standard Application
attempts after authoritative settlement reconciliation. Preserve all committed
outcomes and historical bytes. Use existing authenticated expiry/abort owners
where their preconditions hold; do not invent a finalizer, reset tables or
automatically enter a fresh body. A fresh request requires conclusive old
nonacceptance and its own valid authority.

Alternatively, retain a bounded compatibility recovery path only for cases whose
persisted evidence proves safe continuation; unproven cases remain refused.
Name those consumers, the proof, and the eventual removal gate. Neither option
permits finishing an unsafe seal.

The owner still needs to choose the retention/retirement policy. Reuse existing
terminal-result owners; a required public-contract change needs its own explicit
record. Implementation must establish how affected attempts are
identified, recover unknown commits first, and exercise the real lifecycle
writers on both databases. This document supplies no implicit data reset.

## References

- [04C cutover contract](./slices/04c-standard-mutation-cutover.md).
- [Stored acquisition](../../../packages/persistence-postgres/src/execution/claims/acquisition.ts),
  [durable redispatch](../../../packages/executor/src/mutation/authentication/stored/crashRedispatchOperations.ts)
  and [finite redispatch](../../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts).
- Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`:
  [session requests](../../../../../crates/model/src/session_requests/mod.rs) and
  [mutation retry](../../../../../crates/application/src/application_function_runner/mod.rs).
  Its success-outcome mechanism does not provide Flarex's old journal disposition.
