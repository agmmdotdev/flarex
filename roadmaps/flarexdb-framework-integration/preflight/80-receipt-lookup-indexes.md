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

## Event receipt graph handoff

Event-chain restoration receives its fully restored receipt subjects directly
from the receipt repository as a digest-keyed map. The optional graph-pass memo
can reuse earlier reads, but its capacity no longer determines whether the event
reader must reconstruct a receipt again. The unused single-digest reader is
retired; missing subjects fail through the existing stored-corruption owner.

The batch reader shares one receipt restoration context across consecutive
subjects belonging to the same plan, including across digest query batches.
That context owns the bounded dependency-row index even when the optional memo
is full. A plan change releases the working context; the explicit result retains
only requested subjects. Returning to an earlier plan can reconstruct its graph
again. Existing lineage, duplicate, canonical-byte and projection checks remain
with the full restoration owners, and the aggregate owns a read-only graph pass.

The same working graph retains each resolved producer attempt by storage ID.
Root and prerequisite receipts still corroborate its collision, plan, attempt ID
and fence before reuse. Caller-issued preferred attempts retain their existing
precedence. This removes repeated producer/definition authentication per receipt
when the optional memo is exhausted. It does not share live lease authority or
retain producer state across reads, transactions or working-plan changes.
Distinct producer attempts still use the existing full attempt-lineage reader;
overlapping predecessor histories can therefore be reconstructed more than once.

Test forward and reverse dependency order across the digest batch boundary with
the optional memo exhausted. Each node in a consecutive plan group is fully
restored once; reverse order can fetch a prerequisite root before its digest
batch and therefore fetch that root twice. A single-producer graph restores its
producer once regardless of receipt count. Exercise A/B/A plan changes and detect
changed producer bytes after a completed read, then accept corrected bytes after
the failed read. Preserve multi-plan additive and
takeover/restart regressions. These are bounded graph-work claims, not a complete
linear-verifier or installation-performance result.

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
