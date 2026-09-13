# Receipt Lookup Indexes

Status: implemented within approved preflight 76. This removes repeated scans
inside full receipt reconstruction. It does not enable direct-dependency
execution or establish linear complexity for the whole verifier or installation.

## Owners and retained contracts

`migrationCoordination/authority.ts` indexes the exact issued steps when it
registers a captured or restored immutable plan. Its existing plan registry now
owns both membership and step lookup. `definition.ts` uses that lookup for
dependency ordinals; `storedRestoration.ts` uses it to select the receipt's exact
plan-owned step. There is no second issuer, cloned step handle or stored-row
cache. A structurally identical unregistered plan has no lookup authority.

`migrationStepReceiptRepository.ts` indexes the detached dependency transport
rows once within the existing read-only graph pass. The keys retain their exact
foreign runtime identity and type; grouping neither decodes nor authenticates
them. Each receipt's existing cardinality, canonical value, dependency ordinal,
plan/attempt ancestry and projection checks remain authoritative. Group order
preserves the SQL dependency-ordinal order, including malformed rows that those
checks must reject. Indexes are released with the owning pass and transaction.

Retain the existing bounded batch query and overflow behavior. Up to 4096 rows
are grouped; the 4097th row signals an incomplete batch and preserves the
bounded per-receipt queries. No graph, byte, memory-retention, transaction or
deadline limit is increased. No schema, identity, SQL predicate, read projection,
database privilege or public package contract changes.

## Verification and remaining gates

Use increasing neutral inventories to count dependency rows fetched and owner
property visits independently of elapsed time. The indexed path visits each
transport row once for grouping and then only the selected receipt's rows for
the existing checks. Prove overflow still discards the incomplete batch, reads
again after a pass ends, rejects corrupted rows and retains exact issued step
identity for separately captured/restored plans.

Retain repository/value, graph-pass, structural-runner and PGlite/native
coordinator regressions, plus connected Product and Payload proofs. These
indexes remove two repeated lookup costs; recursive prerequisite restoration,
other full-history work and normal-step reconstruction remain. Preflight 76's
linear full-verifier, direct-dependency transition and end-to-end scaling gates
are still open.
