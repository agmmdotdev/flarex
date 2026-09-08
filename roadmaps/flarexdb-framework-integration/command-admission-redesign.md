# Command admission composition redesign

The owner approved examination and redesign of the remaining Commerce command
authority/application checks after the prepared installation slice measured
205.3 ms median, 200.7 SQL calls and six auxiliary transactions per command.
This is a separate activation/readiness/composition-owner slice, performed on
main while preserving the uncommitted installation implementation.

Current `CommerceHost.attempt` resolves located authority and calls the composite
activation reader before opening the business transaction. That reader resolves
authority, reads an active-revision hint, prepares relation readiness, validates
the prepared fold in a separate transaction, and then validates the issued
readiness again in another activation-read transaction. Business binding admission
locks the current head and validates the issued readiness a third time.

The first bounded implementation separates preparation from acceptance. A private
request-owned preparation token carries existing fold inputs and the expected
revision; it is not an active selection or a successful readiness verdict.
Commerce prepares those inputs before its existing physical transaction. Binding
admission holds its existing scope clock and current application head locks and
performs one complete existing fold/replay validation before constructing the
binding projection. No authority is cached across commands. Public `readActive`,
legacy activation and standalone cross-domain behavior retain their paths.

This removes the two pre-business fold-validation transactions, not all auxiliary
transactions. Control-catalog reads, placement resolution, generation/epoch checks,
immutable input preparation, current readiness/head/ownership validation,
initialization, revocation, binding checks and publication remain owned by their
existing operations. The accepting lock order remains scope clock, installation
head, application head, readiness dependencies. No control write lock is moved
under a target clock; activation's control-before-target write-lock order stays
unchanged. No OCC, commit, replay, outbox or durability policy changes are authorized
by this slice.

Acceptance requires current-source tests for corrupt/missing readiness and active
head changes between preparation and consumption, mismatched clock/target evidence,
forged preparation, successful Product/Currency commands, rollback/replay and
native lock retention. Compare full commands against the preceding installation
runtime snapshot, report SQL/transaction counts and all failures, and retain
storage-tail limitations. Do not describe a median reduction as a production p99
guarantee. Independent review remains unavailable in this side conversation;
implementation is not authority to commit without its review gate.

## Implemented result, 2026-09-08

The composite activation repository now owns a private preparation reader. It
retains the existing preparation operations and issues only an opaque, registry-
authenticated input token. Binding acceptance checks the current scope clock and
active revision, validates the existing complete fold and stored replay once,
then correlates the resulting basis with the locked active head. A fresh ownership
history budget belongs to each acceptance. No prepared token can be claimed as an
executable active selection. Legacy readers and public `readActive` retain their
existing behavior. Commerce uses preparation; standalone cross-domain composition
keeps its existing selection path.

Full Product commands were compared using frozen source snapshots on ordinary-
role PostgreSQL 18.3 with fsync and synchronous_commit enabled. Both variants use
the preceding installation runtime and the same Product scale implementation;
five source modules differ. Each variant ran 240 timed commands and 12 warmups,
covering simple/nested create, update and delete. All commands succeeded, with
publication/fact/outbox assertions and no checkout or Product residue.

| Measurement | Previous admission | Prepared admission |
|---|---:|---:|
| Complete command median | 142.6 ms | 111.4 ms |
| Observed p95 | 157.8 ms | 128.0 ms |
| Observed p99 | 165.5 ms | 138.1 ms |
| Maximum | 175.7 ms | 178.8 ms |
| SQL calls per command, mean | 200.7 | 138.7 |
| Auxiliary transactions per command | 6 | 4 |
| Installation acceptance median | 13.6 ms | 13.5 ms |

The paired median improvement is 21.9%. The preceding code measured 142.6 ms in
this run, so the earlier 205.3 ms observation is not a controlled baseline for
attributing this change. These sequential local samples use one active command
and nearest-rank percentiles. Telemetry stays in memory until completion for both
variants. Earlier durable-COMMIT/checkpoint stalls remain a known limitation;
this run does not establish production p99 or concurrent throughput. The remaining
four auxiliary transactions and repeated authority/input reads require a separately
bounded follow-up; this slice does not remove their checks or weaken durability.

Focused validation passes preparation forgery, mismatched clock, corrupt readiness
bytes with unchanged digest, absent active head, a real switch to another revision,
successful preparation of the new revision, and PostgreSQL head-lock retention.
The preparation fixture runs on both PGlite and PostgreSQL; PGlite uses separate
control and target instances because its single connection cannot support the
existing nested control/target acquisition. The first fixture attempt timed out
with a shared instance; the corrected fixture retains the full assertions.
Corrupt bytes are classified by the existing stored-state decoder, and the test
pins that typed failure. The first stricter assertion expected the wrong reason
and was corrected from `conflictingReplay` to `storedState`.

Eight tests across preparation, admitted-write rollback and installation runtime
pass. Three focused public activation/relation tests and the native PostgreSQL
Currency/Payload/Application rollback-and-replay scenario pass. Persistence TypeScript
checking, `lint:core`, `lint:diff` and `git diff --check` pass. The owner subsequently
requested committing all of this work on main. Independent review is unavailable
in this side conversation and was not run; that direct commit instruction is not
an independent review receipt.

External evidence is retained under
`C:/Users/Admin/Documents/Codex/2026-09-08/medusa-core-benchmark-side/`:
`admission-command-report.md`, `admission-command-summary.json`, source manifests,
before/after frozen sources and load receipts, all command samples and validation
logs. The before snapshot SHA-256 is
`b9078a07bbfcfa4d33a1890ad3085660866d80df73af93ee0762b6597b31856d`;
the after snapshot SHA-256 is
`4f50a8b95a78e6111fb50a331465c3705f80a22aa0105d8d7d36eb2b1d959aff`.
