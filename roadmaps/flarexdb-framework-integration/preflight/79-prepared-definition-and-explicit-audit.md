# Prepared Definition And Explicit Audit

Status: implemented within approved preflight 76. Structural-handler preparation
is shared within a run and explicit audit owns complete stored verification.
Record 85 supplies the protected direct-dependency normal transition; records
84 and 86 share full graph evidence without relying on optional memo capacity.

## Immutable preparation

`migrationCoordination/definition.ts` prepares the existing target-bound
structural runner and direct dependency ordinals once per coordinator run. The
claim retains immutable execution values and authenticated attempt lineage.
Normal transactions freshly read locked head, fence, lease, base availability,
event/tail and selected dependencies; they do not restore all receipt history.
Uncertain-outcome recovery uses the same definition with a distinct recovery
session. Stored receipt issuance continues to use the exact restored plan's
step handles; execution uses the prepared runner's captured step handles.

Retain the existing structural runner as the authority for target/plan checks and
fixed handlers. Replace discarded and repeated runner preparation in the
coordinator. Do not add a stored-authority cache, second issuer, public token,
schema, identity, transaction owner or activation path.

## Explicit audit

`migrationCoordination/verify.ts` accepts a target, captured expected plan and
the existing transaction budgets. It reads and locks the current collision head,
fully restores selected history, verifies exact projected progress, checks that
the plan's entire receipt-root inventory equals the selected prefix, and observes
the catalog against that prefix. Receipted operations must remain exact; later
structural operations must be absent. Future validation operations create no
structure and are not treated as unreceipted objects.

The result is an absent or verified diagnostic snapshot with completion counts.
It is neither readiness nor permission to advance, activate or skip later checks.
The operation performs no metadata writes, DDL or repair. Changed canonical
bytes, mismatched progress, extra receipt roots and unreceipted structure fail
closed through existing repository and structural-runner error owners.

## Retained work and completion gates

The explicit audit currently uses the full restoration owners and their existing
graph bounds. [Receipt lookup indexes](./80-receipt-lookup-indexes.md) remove
repeated plan-step and dependency-row scans within those readers. Explicit graph
handoff now retains the head's issued prefix and independently checks stored
inventory. The installer facade owns preparation and batches; normal commands
use protected progress. Final readiness retains full validation and delegates
publication to its existing owners. No online privileged-repair workflow is
enabled. Complete phase and frozen acceptance evidence belongs to records 88/91.

Prove one runner preparation per uninterrupted run, absent/partial/settled audit
without head mutation, corruption refusal and unreceipted DDL refusal on both
PGlite and the protected ordinary-login PostgreSQL target. Preserve additive,
takeover, restart, rollback and uncertain-COMMIT regressions, and connected
Product and Payload installation/binding proofs. PGlite is functional evidence;
neither lane alone establishes deployment readiness or a performance result.
