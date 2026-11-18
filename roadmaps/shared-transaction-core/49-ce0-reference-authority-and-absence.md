# Reference Authority And Absent Outcomes

Status: authority/refusal witnesses and shared ordered-catalog correction
implemented under standing core approval; broader reference acceptance remains open.

## Outcome And Design Challenge

Extend the zero-row differential reference with the remaining scope and authority
boundaries before nonempty reference work. Two active scopes must independently
use the same request key over shared physical families. Corruption or an
uncommitted publication in one scope must not authorize or stall the other.

Capture preparation, then change fixture authority or definition evidence before
the accepting transaction. Exercise generation/fence/epoch, ordered and unique
definition integrity, and current build readiness. Both the real CMS host and
reference must refuse before their command executes, including when the key has
an otherwise replayable result. Preparation is not live acceptance authority.

For an uncertain outcome with no durable result, use the real PostgreSQL driver's
existing fault at the COMMIT boundary. Throwing before the COMMIT statement enters
its conservative uncertain-decision path; quarantine ends the uncommitted
transaction and recovery sees absence. Require one callback, replacement backend,
preserved initial and recovery failures, no durable effects and no automatic
business retry. Do not delete a committed outcome or mock the resolver to manufacture
absence. A later explicit invocation is distinct from automatic recovery.

## Owners, Breaks And Cleanup

The existing fixture, scoped inventories, admission/participant owners, session
runner and fault hooks remain authoritative. A test-only session decorator may
mutate fixture state after preparation and then delegate to the real registered
session. It issues no admission, changes no returned success/failure, and creates
no second transaction or recovery engine. Restore fixture metadata in `finally`.
Adversarial changes are refusal witnesses, not supported schema upgrades or an
implementation of the deferred migration-policy module.

The new witness reproduces a core gap on both database drivers: after ordered
definition bytes are damaged between preparation and acceptance, the core still
publishes. `validatePhysicalDefinitionLifecycleReadinessCatalogEffect` restores
the unique closure but omits the ordered definition set. The fresh accepting
catalog contract in the unlocked-planning and catalog-restoration notes does not
authorize this weaker integrity boundary; the protected-metadata R2 alternative
is still gated.

Correct the shared physical-definition readiness owner. Retain the prepared
ordered requirements and reread their schema-version bindings and bounded
definition set through the existing index owner, which verifies canonical
bytes/JSON/digests. Compare exact set, identity and canonical specification with
preparation. Reuse the accepting
transaction for a colocated catalog and retain the separate reader otherwise.
Do not add per-definition SQL, recompile the full schema again, add a second
decoder, or issue another transaction. Preserve the failing witness, including
replay, and cover connected native/CMS readiness callers. This adds bounded
catalog work and is a correctness correction, not a measured speedup.

No developer-facing API, codec, storage schema or durable-data migration changes are
needed. The internal readiness error union gains the index and binding readers' failures.
The binding-list reader now requires an explicit maximum: publication and
reconciliation supply their compiled developer count, and admission supplies
its prepared count. SQL reads at most that count plus one and refuses overflow
before decoding, including when zero bindings are expected. Overflow now reports
the reader's catalog-corruption failure rather than a later projection-count
mismatch; existing rollback witnesses retain their exact durable-state checks.
Migrate all callers
without an unlimited fallback or compatibility wrapper. Extend the current
reference scenarios and reconcile their documented gaps rather than adding
another benchmark engine.

The reference scenarios cover both placement forms: the PGlite fixture has a
separate catalog, while the ordinary-role PostgreSQL fixture is colocated. A
native accepting-transaction witness additionally damages an ordered definition
inside that same transaction, proving the check uses its own catalog view.
Current mutable build refusal uses SQL-valid fixture states: retiring ordered
builds lose their enabled maintenance certificate; unique builds lose the
complete certificate tuple. Both are restored afterward. The
[shared request authority matrix](./56-ce0-request-authority-matrix.md) extends
these changes to fresh/replayed eight-row mutations and standalone reads, and
adds missing/damaged active-binding-head cases after preparation.

The current correction adds at most one bounded schema-version binding query and one
bounded definition query per accepting catalog validation; an empty definition
selection skips the latter. Prior request SQL/timing receipts precede this
correction and must be refreshed before future performance conclusions. It does
not solve the broader protected-readiness-root design or remove its gates.

## Completion Gates

Run scope and stale-preparation scenarios on PGlite and ordinary-role PostgreSQL.
PostgreSQL additionally proves independent-scope progress while another scope
holds an uncommitted publication, and absent-outcome recovery after a real
COMMIT-boundary fault. Use bounded Effect-owned concurrency and drain requests
before cleanup. Validate both original reference scenarios, affected types and
lint, obtain both read-only reviews, remove displaced assertions/docs, stop owned
resources and commit. No timing or many-shop capacity claim follows from these
bounded refusal and isolation witnesses; nonempty complete-request reference and
the remaining CE0–CE5 gates stay open.
