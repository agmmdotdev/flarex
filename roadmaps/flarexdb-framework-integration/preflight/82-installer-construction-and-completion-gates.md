# Installer Construction and Redesign Completion Gates

Status: installation construction implemented within approved preflight 76.
The full redesign remains in progress. This record orders its remaining work;
it introduces no new execution profile, authority, schema or activation decision.

## Installation construction

`migrationCoordination/installer.ts` binds an existing target, artifact repository
and validated, captured policy. Construction returns a Result and performs no
database work. Named `installFresh` and `installAdditive` operations reuse the
existing artifact/admission contracts. The installer exposes neither artifact
publication nor a claim, transaction, repository or finalizer capability.

One installation call prepares the definition once, then continues the same
private claim across batches of at most sixteen structural steps. Policy bounds
the total work to at most 128 steps and the total call deadline to at most five
minutes. Each step still has its own target-owned transaction and fresh durable
authority checks. An exhausted work budget returns counts in `pending`; it starts
no background work. A later call reopens using the caller's request identity.
Completion at the work boundary may finalize without spending another structural
step. Finalization retains its existing full verification and publication owner.

The whole call owns pure plan verification scope. This scope and the prepared
definition carry immutable execution values only; they do not authenticate live
lease, fence or progress. Cancellation and uncertain outcomes retain the target
session's cleanup and excluded recovery-session contract. Commerce upgrades
remain unsupported and additive installation retains its existing base limits.

Commerce fixture and Product installation callers bind policy once and submit
business selections. Payload preference installation uses the same construction
without a commerce profile. Product keeps its partial-installation/reopen witness
and unchanged deadline. Artifact admission remains a separate trusted operation.

Retain the low-level coordinator entry points and claim batch operation for
existing neutral fault-injection and lifecycle tests while those independent
contracts remain needed. Delete displaced caller-owned loops and verification
wrappers. No parallel installation implementation or production export is added.

## Remaining sequence and completion gates

1. Read-only [`inspect` and `verify` construction](./83-installer-inspection-and-verification.md)
   now delegates to the diagnostic and verification owners. Inspection does not
   silently perform a full audit. Remaining full-verification work must read each
   node and edge once in a bounded pass, retaining corruption,
   receipt inventory, lineage, target and catalog checks. An inspection report
   grants no execution or readiness authority.
2. Replace normal full-history reconstruction with the protected direct-step
   transition, integrating coordinator, finalization and uncertain recovery.
   Preserve exact dependencies and actual write occupants, DDL/receipt/event/head
   atomicity, fencing and excluded recovery sessions. Keep full verification at
   initial readiness, explicit cold audit and reopening after privileged repair.
3. Prove the integrated behavior through neutral PGlite and ordinary-role native
   PostgreSQL witnesses, then the current Medusa module/link and Payload
   preference/content/lifecycle/delete consumers. ShippingProfile activation is
   outside this redesign. Finish caller migration and remove displaced loaders,
   cache slots and assembly only after their independent consumers are accounted
   for.
4. Establish deterministic work and memory bounds against steps, dependency
   edges, attempts and lineage; separate normal installation, restart, takeover
   and audit measurements. Verify native indexed query plans. Run record 74's
   alternating full-suite baseline/candidate timing acceptance with unchanged
   assertions and deadlines, recording censored baselines honestly. Agree any
   tighter operational target from those measurements.

Every retained slice requires affected checks, both scoped project reviews and
one coherent commit. Passing construction tests does not complete the protected
transition, linear verification, cleanup, throughput or deployment gates.
