# Host-Owned CMS Preparation

Status: implemented under standing core approval. Full evidence verification
remains; protected-root and aggregate retention gates are not completed here.

## Outcome And Evidence

Prepare the private CMS host's Application binding once at construction and
reuse it for reads, writes, duplicate outcomes and uncertain-decision recovery.
Apply the same lifetime to the existing Currency/Payload/Application composite
and the test-only complete-request references. Commerce installation preparation
already has a host lifetime. Native executable selection retains its own owner.

The request SQL attribution identifies repeated schema, manifest, definition and
readiness preparation. `CmsHost.attempt` currently rebuilds that preparation,
then `withAcceptedApplicationBinding` restores live evidence again. The latter
checks the current active head, bundle, catalog, build/candidate state, write
ownership and binding before callbacks or replay. Retain those checks.

## Selected Contract And Break

A private host is bound to the immutable revision/configuration for which its
registered commands were constructed. Preparation is not an admission verdict.
Host construction now requires a preparable active revision; construction errors
occur there instead of the first invocation. Switching the active revision or
scope generation requires constructing a new host. An old host must refuse,
including on an otherwise replayable request, without refreshing itself or
retrying business callbacks. Restoration of the exact previously valid evidence
may make the original host admissible again.

Payload lifecycle consumers explicitly reconstruct after Application activation
and data-binding cutover. A stale host reports `invalidAuthority` with the
activation owner's `concurrentHead` cause. A repeatable-read request opened
during activation can instead refuse PostgreSQL's stale-snapshot serialization
failure; it must not reuse a newer clock with older metadata. Constructor errors
retain the existing CMS/composite error projection and original cause.

Retain fresh target resolution on every attempt and full accepting-transaction
validation, including recovery. Keep materialization preparation request-owned:
its candidate/definition consumers have a separate lifecycle and are not silently
made concurrent shared state by this change. No transaction, accepted token,
mutable working set or readiness verdict is retained by the host.

Use the existing preparation registry; do not add a second cache or new API.
Each host retains one preparation, with no growing revision map. Existing input
and definition limits still apply. Aggregate host multiplicity and explicit
retained-byte accounting remain a package-2 gate; this is not a claim of a
process-wide memory budget.

## Integrity Decision

Retain immediate request-time verification of the selected metadata dependencies.
The framework history protection migration rejects ordinary history updates and
deletes, but privileged repair can disable it, and Application catalog/build
writers do not share an enforced root invalidation protocol. Ordinary test logins
also own their disposable Application schemas. A root alone therefore cannot
replace current evidence reads. No tamper witness moves to a later audit.

The relevant legitimate writers remain Application schema/publication/readiness,
activation and index/unique/relation maintenance; framework plan/receipt,
installation/readiness/availability writers; and explicit administrative repair.
This slice changes none of their authority or durable formats. Protected-root
replacement remains unimplemented; prepare-once does not establish it.

## Validation And Cleanup

Use actual CMS entry points to prove preparation occurs only during construction,
each later request still reaches fresh admission, warm corruption is refused,
failed requests have no effects, and restoration permits execution. Preserve the
existing authority matrix for stale epoch/generation/fence, ordered/unique
definitions, active heads and readiness across new/replayed mutations and reads.
Run connected CMS concurrency/settlement and existing composite regressions on
PGlite and ordinary-role PostgreSQL. Refresh SQL attribution with construction
reported separately from warm execution; do not call transferred startup cost
free work or claim latency improvement from statement counts.

Remove per-attempt CMS schema preparation in all selected consumers, retain the
single fresh validation owner, run affected typechecks/lint and both reviews,
reconcile roadmap status and commit. No schema migration or data deletion.

The native Payload unique-race witness now barriers both callbacks after their
document closures. One publishes and one gets the exact settlement conflict;
an explicit later retry sees native duplicate validation. Serial duplicate
validation remains unchanged. Earlier scheduling-dependent assertions that
every concurrent loser must fail inside Payload validation are removed.
