# Transaction-scoped Source ID generation

Status: **Selected Source translation, connected caller migration and bounded
database/host proof complete. Broader native, retained-data, managed-hosting and
performance gates remain open under the full goal.**

Baseline: `82d284bf36d42e07e32142c38a9bf151ce29a444`. Reference:
`db914cf06e2b06ee985646611b9e12ed7a770318`. This closes
[Q11](../OPEN-QUESTIONS.md#q11---transaction-scoped-source-id-generation) inside
the [full goal](../GOAL.md); it does not complete the broader native migration.

## Connected replacement

Replace the database-scoped complete-ID Effect with trusted host entropy and a
portable transaction-owned generator. Ordinary transactions, native transactions
and composed native roots each construct one generator; native children share
their root's generator. Bootstrap owns one private generator. Logical control,
program, schema/index and request metadata share the generator of their actual
transaction instead of allocating through a global effect or one RNG per row.

The affected production owners are `core/api.ts`, `database.ts`, `bootstrap.ts`,
`transaction.ts`, `document.ts`, `committer.ts`, `indexModel.ts`, the persistence
contract and its existing physical read owner, with the new algorithm beside
them. Protocol
codecs continue owning the existing arbitrary 16-byte ID representation. The
actual DO fixture and existing Core/Application/Payload/Currency fixtures must
supply entropy instead of complete IDs. No new package, global service,
persistence family, alternate allocator or compatibility option is required.

## Independent challenge and dispositions

Three independent readers inspected current callers, accepted direction and
pinned Source, then exchanged counterexamples and checked the remaining
questions against the actual owners. The resulting contract is:

- Source's `TransactionIdGenerator` draws 32 seed bytes, constructs ChaCha12,
  then reads trusted system time. Pin `floor(unixSeconds / 86400)` once, reject
  pre-epoch or day 65536 and above, and append the two-byte day big-endian.
  Use the raw trusted clock, never snapshot-raised document creation time.
- Locked `rand 0.9.4`, `rand_chacha 0.9.0` and `rand_core 0.9.1` consume four
  little-endian `u32`s for `fill_bytes(14)`. Each ID consumes 16 stream bytes,
  retains the first 14 and replaces the last two with the day. Consecutive
  14-byte slices would diverge at ID two. The Source four-block buffer contains
  16 such slots; preserve equivalent stream/counter behavior across refills.
- Source uses a zero initial 64-bit counter and zero 64-bit stream identifier.
  The installed Noble `chacha12` has the right ordinary state layout, but its
  public API refuses low counter `0xffffffff`. Current write accounting does
  not bound total draws: caught failures can consume IDs without charging a
  write. A CPU/time assumption cannot prove that boundary unreachable. Use a
  faithful scalar translation with locked-Rust vectors rather than adding an
  allocation limit, importing a library test hook or inventing a DO exception.
- Nested rollback does not restore RNG or creation-time advancement. A retry
  constructs a fresh generator; replay preserves durable IDs. Source's explicit
  snapshot-query clone must not allocate. Current Core has no equivalent clone
  consumer, so do not introduce a general writable clone API.
- Source database globals use independent runtime UUID-v4 entropy, then insert
  their document through the transaction generator. The current shared allocator
  also supplies `awsPrefixSecret`; separating its fresh 16-byte entropy is part
  of this correction. Preserve existing stored secrets and catalog anchors.
- Source reserves a user ID/time before creating a missing table. Current Core
  creates the table first and preallocates its two indexes before staging the
  table record. Allocation order and caught failure consumption are observable
  deterministic mechanism differences; correct them with the generator.
- The allocation cursor and document field have different time domains. Source's
  cursor accepts all finite nonnegative doubles except negative zero, while a
  document still requires `_creationTime > 0 && _creationTime < 2^53`. Increment
  validates/assigns the next float and returns the old value. Keep those validators
  distinct rather than weakening stored-document checks or rejecting a valid
  last cursor step below `2^53`.

No necessary DO/native algorithm divergence is established. Existing native
whole-batch preflight remains the accepted native profile and is not replaced
with Application insertion order. Existing private logical catalog adaptations
retain their own owners; they do not justify a database-global RNG.

Primary Source owners are
[transaction_id_generator.rs](../../../../../../crates/database/src/transaction_id_generator.rs),
[database.rs](../../../../../../crates/database/src/database.rs),
[system_metadata.rs](../../../../../../crates/database/src/bootstrap_model/system_metadata.rs),
[user_facing.rs](../../../../../../crates/database/src/bootstrap_model/user_facing.rs),
[table.rs](../../../../../../crates/database/src/bootstrap_model/table.rs),
[transaction.rs](../../../../../../crates/database/src/transaction.rs), and
[database_globals](../../../../../../crates/model/src/database_globals/mod.rs).
The generator's dependency true-value test aliases ChaCha20; it is not a
ChaCha12 oracle. Generate independent vectors using the locked Rust versions.

## Construction and insertion contract

The host supplies `randomBytes(16 | 32)` as a trusted Effect. A complete-ID
override is removed from `CoreDatabaseOptions`. Capture/copy a 32-byte seed
before awaiting the raw clock; malformed seed/time fails construction without
admission or mutation. Preserve defects/interruption and existing Core failure
ownership rather than adding a fallback RNG or broad recovery. The pure
generator owns mutable state privately and returns detached ID bytes; it does
not expose seed/state or a writable clone to application code.

Keep the generator's raw day-clock read separate from creation-time sampling.
Source's ordinary `Database.begin` and `begin_with_ts` first derive creation time
from `max(latestPublishedTimestamp + 1, runtimeTimestamp)`, then construct the
generator using entropy and its own raw clock. Current Core's cached Database
begin-at path maps to that owner, not the uncached `DatabaseSnapshot.begin_tx`
utility. Bootstrap constructs the generator first and samples a separate creation
clock afterward. Native roots retain one fixed creation-time cohort while their
shared generator pins its separate raw day. Existing host clock injection supplies
these reads; no new clock service or shared cached clock substitutes for them.

Translate Source nanoseconds-to-milliseconds arithmetic exactly:
`Number(ns / 1_000_000n) + Number(ns % 1_000_000n) * 1e-6`, then take the maximum
with the snapshot's ceiling in milliseconds. Converting the whole nanosecond
integer to a double first can lose an ULP. Database timestamps retain their
separate `0..i64::MAX` nanosecond domain. A maximum published timestamp refuses
successor allocation rather than wrapping or clamping the generator's day.

Ordinary Application insertion follows the actual Source stages:

1. Capture representable input and require an object; admit lexical table name
   and reject system-table access before ID/time allocation. Reuse authoritative
   general-value capture: logical size at most 32 MiB, nesting 64, 1024 fields per
   object and 8192 array elements. Safe capture is not full-document validation.
2. Reserve the user ID, then its creation time. A creation-time failure consumes
   the ID. Keep this time for the user document even when metadata increments
   the same transaction clock afterward.
3. Ensure the table. Table-cap refusal consumes the user ID/time but no metadata
   IDs or writes. For a new table, allocate and stage `_tables`, then allocate
   and stage `by_id`, then `by_creation_time`; do not preallocate all three.
4. Construct the document with generated system fields; enforce document nesting
   16 and forbidden top-level system fields. Supplied `_id`/`_creationTime` are
   acceptable only when equal to their generated values, as Source requires.
5. Enforce the schema, then the 1 MiB user-document logical-size limit including
   injected system fields, before applying the user write/index updates.

The stage order comes from actual SDK/syscall conversion, PendingValue, document
construction, schema enforcement and `apply_validated_write`, rather than just
the user-facing model in isolation. Schema failure wins over user-size failure;
document nesting/system-field failure precedes schema. Preserve the native
relational whole-batch scalar/key/dedup preflight before selection/allocation.

Source bootstrap allocates tablet identities first and reuses them for `_tables`
documents, then continues the same stream for index metadata. Explicit private
IDs, replacements and stored recovery/import data retain their identity without
an extra draw. Current Core has no general public import API to add here.

## Generated metadata collision correction

The connected repeated-seed witness exposed a shared-owner defect: new system
metadata, including request claims, used the same private upsert operation as
known-ID replacements. Expected Source behavior is to refuse an ID collision
without changing the prior durable outcome or publication timestamp. In the
uncorrected PGlite witness, a second request key with the same generated ID erased
the first terminal failed outcome, became busy and advanced publication.

The Core transaction owner must distinguish a new private insert from an explicit
known-ID update. Route generated system/program/head/request/index/table metadata
through the new-ID contract, preserving current-row and retained-history collision
enforcement. Existing replacements, initialization reclaim and explicit stored-ID
recovery keep their actual update meaning. Do not repair this at adapters, rekey
existing outcomes, add another transaction or rely on random collision odds.

Copy the actual Source write/client mechanism. A fresh insert preserves original
document absence rather than reading a committed row and converting the operation
to an update. Pending duplicate insertion is an internal invariant failure.
Generated IDs derive from existing coalesced updates whose original document is
absent; do not add a separate intent registry. Retain an insert-then-delete update
with both documents absent: it still reserves its ID and commit writes a tombstone.
Deleting a genuinely missing document remains a no-op.

Client preparation checks the derived IDs against batched previous revisions
through the transaction begin timestamp. A live prior revision yields
`documentExists`, and a deletion yields `documentDeleted`; these are Source
bad-request refusals, not OCC conflicts that automatically replay a mutation body.
The existing native projections retain their input-error meaning: CMS reports
`documentInvalid`, while commerce and composite commands report `invalidInput`.
Each preserves the original Core refusal and its cause rather than classifying
the refusal as missing authority.
Later writes retain the existing ordered conflict owner. Source's exact prefix
dependency does not represent a coalesced update with neither an original nor a
final document. The complete pinned pending/published-log and persistence audit
found no separate ID-event fallback for that case. A delayed transaction can
therefore pass its through-begin history check after another transaction inserts
and deletes the same ID. The Core witness observes that boundary; the Source
comparison is a primary-code inference, not an executed Rust commit receipt.

The initial witness assumed a stronger OCC refusal. That assumption is not an
evidenced public/native obligation and does not override the user's instruction
to copy pinned mechanisms. Keep the actual Source boundary, historical tombstone
and subsequent live revision in the characterization; do not add a synthetic
conflict key or claim universal never-reuse for this interleaving. Pre-begin live
and tombstone reuse still fail with their distinct Source errors.

The physical persistence owner gains the required previous-revision search port,
distinct from its existing exact-predecessor API. Preserve absent versus tombstone
results, owned query capture, target/row correlation and retention validation
after reads. Translate Source's full groups of eight, singleton remainder and
sixteen logical request futures on one connection. Actual wire pipelining remains
a transport/performance proof, not a result inferred from logical concurrency.

Dependent metadata activation is held until that owner correction passes the
preserved witness and both database regressions. This is already authorized
connected replacement work under the full goal; independent algorithm/time work
can continue. Registry updates must follow successful metadata application rather
than leave a ghost mapping after refusal. No collision fix is claimed implemented
or proved until those gates pass.

## Numeric history ordering correction

The shared physical owner projected `ts::text AS ts` for lossless decoding, then
ordered by the unqualified output alias. That sorts text instead of the BIGINT
column. The two-driver witness with revisions at 2, 10 and 100 returned live
revision 2 instead of deletion 10 for a bound of 11; paged ascending/descending
document-log reads also omitted revisions.

Qualify the physical BIGINT timestamp in the new history search, existing snapshot
point reader and `loadDocuments` ordering, while keeping the text projection for
decoding. The correction belongs to this shared persistence owner. No adapter
sorting, extra read, DDL/index change or data reset repairs it. Preserve the
functional witness and bounded-index plan checks on both drivers; source and
caller regressions remain completion gates.

## Ownership and cleanup

- Algorithm worker: the portable ChaCha12/ID owner, an isolated locked-Rust
  vector producer, checked-in vectors and pure conformance tests. No production
  host/database edits or benchmark claims.
- Allocation worker: Core options, transaction construction, bootstrap/control/
  request/program/schema allocation, insertion-phase correction and removal of
  displaced allocation helpers. Coordinate the exact generator API first.
- Consumer worker: existing fixture/actual-DO entropy wiring and meaningful
  behavior tests, including the first-table cap and genuine Application index
  tie-order witness. Add connected database scenarios using real owners.
- History worker: the narrow required batch-search contract, physical read owner
  and focused driver scenarios. Reuse the exact-predecessor owner's decoding and
  lifetime boundaries while preserving its existing semantics.
- Coordinator: contracts/docs, PostgreSQL lifecycle, shared-worktree preservation,
  the focused creation-cursor unit proof, integration, final proof and independent
  review. Workers do not edit each
  other's files, start competing database lanes or touch Main WIP.

The old `useNextInternalId` syscall-time fixture override is removed. Test seed
control happens at the trusted entropy/transaction boundary, keeps real generator
construction, and verifies the actual IDs. Preserve the genuine indexed tie-order
behavior without manufactured rows/index bytes or a production force-ID hook.

Main's protected `applicationNativeMutationHarness.ts` has unrelated pending
edits outside this allocator witness. Work in the isolated verification checkout;
integrate only the owned non-conflicting change and preserve the protected edits.
All other protected paths and generated artifacts remain guarded. Main's dirty
graph is not certified by clean-checkout validation.

## Completion gates

- Independent locked-Rust vectors cover multiple seeds, at least 17 consecutive
  IDs, four-block/refill boundaries, low-counter carry, high counters and wrap.
  Verify the complete 16-byte result/day order and existing public-ID codec.
- Prove seed/output ownership, zero/max/invalid days, midnight pinning, independent
  transactions, shared native-root draws, construction failure/interruption,
  nested failure without RNG rewind and no allocation after transaction closure.
- Distinguish creation-cursor acceptance/increment from document-time acceptance,
  including zero, negative zero, the step from `2^53 - 1` to `2^53`, finite maximum
  increment failure, exact millisecond conversion and independent clock reads.
- Prove general-capture versus document/schema/size refusal order, exact draw
  positions, user-before-metadata creation times and table-cap zero writes.
- PGlite and ordinary PostgreSQL separately cover real user/native/system
  allocation, bootstrap/control/request metadata, collisions, retry/replay,
  cold reopen and old stored IDs/secrets. Preserve frozen-store consumers.
- Run affected Application/native/Payload regressions and the actual Application
  DO/Workerd proof with the new entropy capability. This does not establish native
  Cloudflare deployment or broader framework support.
- Retire the displaced complete-ID option/helper/control, pass affected Oxc fast
  checks and lint/source guards, obtain both exact-checkpoint project reviews,
  preserve unrelated changes, close resources and commit the connected slice.

No physical schema upgrade, stored-ID rewrite or unspecified durable-data reset
is authorized or needed. Performance and broader native retirement remain their
separate full-goal gates.

## Construction interruption and borrow ownership

The controlled two-driver witness exposed another shared-owner boundary: the
existing `acquireUseRelease` acquisition wrapped snapshot, entropy and clock
preparation, so it masked interruption while waiting on the host clock. Preparing
owned data and a heap-only context is not yet a registered database borrow.

Run preparation with inherited caller interruptibility, then mask only readiness,
the synchronous closed/authority recheck and borrow registration. Existing full
Exit cleanup and successful transfer retain their owner. Do not force
interruptibility inside an ambient abort mask or change acknowledged abort-save
and claim-retirement atomicity. The native and composed-root constructors use
the same registration boundary.

The witness requires cancellation before releasing its clock gate. Cleanup uses
Effect finalization, not JavaScript `finally` around failed generator effects;
its owned target and interrupt-request fibers are released/joined on every Exit.
Retain the negative construction and acknowledged-abort witnesses alongside the
positive driver regressions.
