# Journal Ownership

The journal records an admitted attempt's observations, pending changes and
participant contributions. Postgres publication owns committed data. Consumers
import `internal/session-journal`; trusted construction imports
`internal/session-journal-construction`. Source owners import the actual module
they need rather than the consumer export file.

| Module | Read it for |
| --- | --- |
| `contracts.ts`, `errors.ts` | Operations, results, opaque capabilities, borrowing and precise failures |
| `state.ts` | Trusted attempt, pinned definition and resolved target data contracts |
| `indexQueryPort.ts` | One authenticated query-port registry and constructor |
| `finiteEntry.ts` | Private prepared/confirmed registries and capture lifecycle |
| `finiteEntryActivation.ts` | Control preparation and the accepting transaction |
| `finiteEntryPublication.ts` | The existing Drizzle-column publication projection |
| `freezeClosedRoot.ts` | Authenticate and consume a completed root, then issue its frozen capability |
| `frozenAttempt.ts` | One frozen registry, publication-owned evidence and detached or borrowed validation projections |
| `api.ts` | Explicit consumer exports, without construction or registry mutation |
| `construction.ts` | Trusted store and query-port construction |
| `../sessionJournalStore.ts` | Per-store capacity/exact claims, evaluation, durable receipts, replay and sealing |

For finite entry, follow preparation in the concrete store, issuance in
`finiteEntry.ts`, then accepting work in `finiteEntryActivation.ts`. Tentative
capture precedes later planning SQL. Acknowledged COMMIT confirms and installs
the captured attempt; abort or uncertainty discards it and releases capacity
once. Its exact-claim tombstone remains until authoritative retirement.

For freezing, `freezeClosedRoot.ts` checks the actual root and pins, adopts
canonical values, registers one owned capability and consumes the root in that
order. Publication borrows full evidence from that registry. Executor validation
receives only the required values; detached projections copy mutable bytes.
None of these projections grants settlement authority.

[Journal tests](../../../test/execution/journal/) keep paired PGlite/Postgres
scenarios and installation/capability witnesses together. Tests inspect a
read-only lifecycle projection through the explicit system-test route and fault
the real accepting/source boundary. They cannot modify registry state.

The [file cohesion plan](../../../../../roadmaps/execution-architecture/05-file-cohesion-and-readable-flows.md)
owns the remaining concrete-store decomposition. Schema, formats, authority and
native business behavior retain their existing contracts.
