# Implementation sequence

Status: documentation scaffold complete; all runtime stages below are pending.
The first deliverable is a connected experimental path, not a new exported API.

## Stage 1: executable scope and contract map

Choose the exact three starting workloads from existing native/Flarex scenarios:
Payload scalar create, Medusa Product scalar update, and one mixed
Application/Product/Payload mutation. Record native versions, executing exports,
dirty-source fingerprints, inputs, complete outputs, hooks, errors and events.
The [references](./REFERENCES.md) locate the existing harness and framework sources.

For each workload write its minimum operation trace: admission, business-required
reads, local edits, native callbacks, constraints and durable settlement. Classify
each check by obligation, invalidating writer and enforcement lifetime. Distinguish
framework semantics from an internal order only witnessed by an old test.

Resolve the direct command's isolation/retry contract and the mixed root's
snapshot/retention/fence contract. Define a counterexample test for each proposed
removed boundary. Record exact assumptions and unresolved gates in DESIGN.md.

Inventory the selected module/workflow's business code separately from its
repository, manager/context, participant, event and workflow-host plumbing.
For each integration dependency mark reuse, experimental replacement or a real
framework seam requiring coordination. Do not assume the old adapter contract
must survive or that all adapter changes will be mechanical.

Add explicit local package/tool/test configuration here when implementation starts.
Do not enroll this folder in root workspace or ambient test discovery. Prefer
existing installed tools when sufficient; otherwise use an independently scoped
manifest and lockfile here, with reproducible dependency versions and no edits
to the active workspace. Wire the comparison through local composition.

## Stage 2: minimum owned database lifecycle

Design the required persisted concepts before creating SQL. Inventory all writers,
roles and invalidation paths; specify lock order and fresh database time. Implement
disposable resource ownership, restricted serving access, installation generations,
maintenance/reopen and snapshot retention/refusal. A new layout is allowed.

Implement physical execution once, including deadlines, cancellation/draining,
quarantine, release and shutdown. Reuse a proven narrow primitive only after its
dependency audit. Do not copy the current full host to acquire a connection.

Prove the new authority and lifecycle contract on both drivers before using it
to remove a live check. Test unauthorized callers, stale generation, expired
attempt, maintenance races and interrupted acquisition.

## Stage 3: complete storage and settlement slice

Implement point read/missing read and the actual bounded indexed selection needed
by the chosen workloads, with pending-state overlay and exact dependencies.
Connect one root owner, immutable preparation and the fresh accepting DB gate.
Add only the unique/reference behavior those real workloads require.

Implement atomic settlement, history, necessary index/unique/relation maintenance,
durable result/idempotency/event intent and uncertain-COMMIT resolution. Exercise
concurrent changes, rollback and replay before calling the path correct. A
data-only insert without these obligations is a storage microbenchmark only.

Run an early complete-root comparison. Reject a failed hypothesis before adding
more wrappers or expanding framework coverage. Lower SQL count alone is not success.

## Stage 4: real framework bridges

Compose real Payload Local API and actual promoted Medusa service behavior with
the experimental storage contracts. Bridge code lives here and owns translation
only. Do not fork native business algorithms or alter active adapter imports.

Replace the repository and workflow execution handoffs where they depend on the
old working set or atomic lifetime. Exercise the new Attempt/Settlement owners
through these bridges; importing the old execution host to keep a wrapper
unchanged would defeat the experiment. Preserve native steps, hooks and results,
including genuine module-specific semantics. Adapter plumbing may change broadly
inside this folder without pausing active Medusa integration.

Prove normal/error results, defaults, visibility, nested access and hooks, caught
failure rollback, events and fresh committed readback. Test the complete standalone
commands, not only repository methods. Add the actual mixed root: all participants
borrow its snapshot/pending state, and only it settles.

A required change to active framework code is an overlap issue, not permission to
edit the integration work. Preserve the witness, identify the seam and continue
independent experimental work. Resolve that seam with its owner before depending
on the change; no adapter SQL workaround.

## Stage 5: replacement and scaling proof

Demonstrate modularity by replacing one material storage/query or readiness
mechanism while preserving the owning contract tests and native bridge code.
This must change actual execution, not an unused interface implementation.

Expand the chosen candidate to the five existing complete business graphs and
the relevant scaling/contention/failure witnesses. Use the three-lane comparison
and unchanged acceptance rules in VALIDATION.md. Report remaining costs rather
than declaring the experimental folder itself a successful redesign.

## Stage 6: promotion recommendation

After correctness, performance, review and cleanup, describe the exact proposed
core cutover: consumers, public/private contracts, changed schemas/codecs, named
durable data, migration or approved reset, deployment order and removal list.
Active Medusa integration may have advanced: rerun against its current executing
source before recommending promotion.

Passing the experiment does not authorize deploying or modifying existing data.
The owner chooses promotion, another hypothesis or retirement. Production must
not keep two settlement engines, an automatic fallback or permanent duplicate
schema authority as a consequence of this experiment.

## Iteration record

For each material candidate retain the hypothesis, changed modules, precise removed
work, source/settings fingerprint, behavioral witnesses, complete measurements
and accept/reject disposition. Store detailed receipts with the experiment's
validation artifacts and Git; keep these design files focused on current truth.

Incomplete database proofs or failed gates remain explicit. Root commit/review
rules still apply; an experimental label does not authorize committing failing
runtime work or deleting failed evidence to present a clean result.
