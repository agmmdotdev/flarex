# Bounded Commerce Write-Kernel Efficiency

## Status

Separately approved and implemented as the shared dependency of record 32.
All 50 unchanged original Product cases pass on PGlite and ordinary-role
PostgreSQL. Existing scope admission, resource limits, transaction ownership,
Currency scalar behavior and profile contract bytes are preserved.

## Reproducible Boundary

The pre-correction graph replacement and mixed variant mutations attempted a
65th shared-store SQL statement and returned `limitExceeded`. Adapter-local
planning already batched writes; repeated core catalog scans, existence reads
and hydration consumed the remaining budget. These three originals reproduce
the boundary in the two registered Product files:

- `should emit cascade events when updating product with relations`;
- `should upsert variants (update one and create one)`;
- `should simultaneously update options and variants`.

Use `pnpm --filter @flarex/medusa-adapter test:product:upstream` for complete
acceptance. Diagnostic subsets deliberately fail the exact coverage reporter.
No original input or assertion is changed to reduce work.

## Implemented Owner Contract

`packages/persistence-postgres/src/commerceTransaction/store.ts` owns admitted
insert/update execution. Its package-private `writeEnvelope.ts` owns SQL
construction and pure result decoding. The adapter retains Medusa planning;
it receives no raw SQL capability or replacement transaction authority.

Each operation captures input, declared keys, typed parameters and a bounded
initial catalog. It groups rows by supplied columns and executes one modifying
CTE per group. Existing-key updates prove existence from the exact RETURNING
key set, avoiding separate existence and hydration reads. Input order is
restored across groups. Missing, duplicate, alien or incomplete returned rows
fail and roll back the command.

A modifying CTE sees one statement snapshot. The post-write catalog therefore
combines retained snapshot rows excluding selected keys with actual RETURNING
rows; it never treats a base-table reread as evidence of the mutation. The SQL
measures count, per-row and aggregate bytes before returning row JSON. An
oversized default or numeric expansion returns only capped size metadata and
null rows. Numeric values use exact text in the transport payload. Existing
column codecs normalize timestamps and validate complete row shapes.

The final update check reuses only this operation's latest catalog measurement,
checked against the current remaining byte budget after hydration. No intervening
mutation or cross-request cache may invalidate that measurement. A key-only
update without managed timestamps reads the existing row and records no change;
a managed timestamp update retains its existing mutation behavior.

Every real operation still uses the owned request lifetime and SQL session.
Parent locks and complete dependent-row refusal remain in declared-key removal.
All groups, relational facts, result and wake publication share one transaction.
A late failure, cancellation or publication refusal leaves no partial change or
local event release. Currency's scalar path retains its existing semantics.

## Limits And Validation

There is no increase to the 64 SQL statement or operation limits, 256-row/fact
limits, event/byte limits, or command/statement/lock deadlines. On both drivers,
the three formerly failing commands use respectively **58, 56 and 55 SQL
statements**, with **53 operations** each. These are measured complete-command
costs; earlier fail-at-65 diagnostics were not complete-cost measurements.
Temporary measurement hooks are removed from production code.

Validation covers the full 50-original inventory; authored Product authority,
rollback, replay, publication and cancellation cases; synthetic unmanaged
key-only updates and mixed column groups; exact numeric/RETURNING visibility;
server-side oversized-payload refusal; native lock timeout rollback; Currency
preservation; strict package checks and source/hash/browser/lint gates.

No new table or migration, durable event provider, dispatcher, query sync,
lifecycle or scale admission, Application OCC dependency tracking, or public
serving is included. Future execution-profile proposals retain their own
preflight and approval gates.
