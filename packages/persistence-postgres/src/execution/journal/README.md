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
| `../sessionJournalStore.ts` | Assemble the owners, prepare/admit an attempt and expose its ordered operations |
| `attemptOwner.ts` | Per-store issued capabilities, exact finite claims, capacity reservations and admitted-operation exclusion |
| `targetAdmission.ts` | Resolve the genuine located target, admit the exact running attempt and lend its read transaction |
| `inputCapture.ts`, `codecs.ts`, `operationModel.ts` | Capture inputs, preserve canonical receipt contracts and account for operation limits |
| `journalFailures.ts` | Existing exact error conversion at the journal's foreign/exact-attempt boundaries |
| `receiptEvidence.ts` | Authenticate stored point/range/relation/write evidence and correlate it with receipts |
| `journalPersistence.ts` | Durable journal/receipt reads and writes through the existing transaction owner |
| `pointOperations.ts`, `indexedQueries.ts`, `relationReads.ts` | Resolve pinned capabilities and execute their respective operations |
| `journalProjection.ts` | Authenticate and project pending journal state, including generated insertions |
| `participantOperations.ts` | Admit one borrowed native participant operation and retain its contribution |
| `finiteRoot.ts` | Finite-root capture, point observations, metadata reservation, discard and freeze |
| `seal.ts` | Prepare and complete the journal seal and its authenticated publication projection |

For an ordinary attempt, start with assembly and `openAttemptEffect` in the store.
`targetAdmission.ts` resolves and admits the actual running attempt before
`attemptOwner.ts` registers its capability. Follow the requested point, index or
relation operation to its executor. Stored receipts and dependency evidence use
the same lower persistence/evidence owners for execution and replay. `seal.ts`
projects that evidence for the outer publication owner; sealing does not grant
the caller a database transaction or settlement capability.

For a borrowed framework operation, follow source/participant admission in the
store, then `participantOperations.ts`. The framework adapter runs its native
behavior against admitted sources and contributes pending changes. It returns
control to the same outer attempt; it cannot independently commit. Generated
insertions use `journalProjection.ts`, shared with seal preparation.

For finite entry, follow preparation and capacity reservation in the store and
`attemptOwner.ts`, issuance in `finiteEntry.ts`, then accepting work in
`finiteEntryActivation.ts` and capture in `finiteRoot.ts`. Tentative
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
owns the connected organization work. Schema, formats, authority and native
business behavior retain their existing contracts.
