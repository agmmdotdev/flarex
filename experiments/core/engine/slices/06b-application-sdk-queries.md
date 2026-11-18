# Application SDK queries over the translated core

Status: **Bounded fresh Application mutation implementation; standalone query
hosts, native migration and wider goal gates remain open**. Independent
current-owner, accepted-direction and pinned-source challenge plus peer exchange
are complete.
Reference: Convex db914cf06e2b06ee985646611b9e12ed7a770318. Executing baseline:
Flarex e25c1725efce2c3184721476f7908f7d91119df2. Follow the [goal](../GOAL.md),
[replacement workflow](../REFACTOR.md#convex-guided-replacement-workflow) and
[preceding cutover](./06a-application-persistence-cutover.md).

## Connected outcome

Connect the existing SDK db.query / withIndex builder to the actual current
Application mutation Worker and translated core. Include collect, take, first, unique,
ascending/descending order and the existing numItems/cursor pagination surface.
Cold current Application Analysis must produce the registration/schema metadata
used by the emitted Worker proof. The retired declarative V2 verifier is not an
activation owner and must not be resurrected.

The final source challenge also requires the SDK's consuming builder lifecycle.
Only the table QueryInitializer is reusable. Each derived query is consumed by
chaining or execution; order may be specified once. Each index-range builder is
consumed by a bound method or its final export. Reject discarded branches and
forged callback results instead of silently turning a predicate into a full scan.
Capture bound operands when the source builder accepts them. Preserve private
capabilities and whole-terminal admission, including zero-result terminals.

At the executing baseline, the Worker exposes raw queryIndexRange rather than
the SDK query initializer. Its new-target supplied-bound refusal remains correct
until that path is replaced. The old
compiler's separate-row-ID tuple completion drops every matching new row at a
creation-time equality: the old end is value bytes followed by 00; a matching
new full key continues with 10 plus the developer-ID string. Recompile logical
intent; never infer or repair a key format from supplied hexadecimal.

## Source mechanism and explicit source limitation

Translate common/query.rs IndexRange.split/compile, interval key increment and
split_after, indexed_fields.iter_with_id, and database/query/index_range.rs.
Resolve normalized fields from the body's selected registry. User index fields
already include Application's appended _creationTime; append implicit _id once.
Rank-sort equality fields and preserve source duplicate/conflicting-bound error
order. Keep undefined/missing separate from null. General value, field-path and
index declaration owners retain their separate responsibilities.

Use prefix increment for partial equalities and inclusive/exclusive prefix
bounds. The tight full-key end is key followed by 00 only after every indexed
field including _id is specified. Empty/inverted intervals do no data fetch.
No inherited 2048-byte bound/key cap is admitted; 2500 is a physical split.

The pin has an escaped-prefix limitation: the sort key for the string a is
106100 and for a followed by NUL is 106100ff00. Both full keys are inside the
source partial equality interval [106100,106101). Equivalent byte/object cases
exist. Inspecting actual key composition and query stream found no residual
Application predicate. Preserve source-derived executable vectors and describe
this literal pinned behavior; do not silently retain the old tuple-plus-16 rule.

This is not a new guarantee-approval gate. Independent obligation tracing found
no executing fresh Worker SDK query contract to preserve. The old SDK compatibility
hosts remain named migration inputs. Payload and Medusa enforce native predicates
after candidate acquisition and before slicing/counting; those paths and their
exact native criteria remain untouched. Their later migration must retain that
responsibility, not assume this scalar interval alone implements native equality.

## Query, page and cursor ownership

The SDK builds logical intent. A narrow managed capability crosses the Worker
boundary; the transaction resolves table/index readiness and fields, captures
operands once, compiles and owns query state. Keep one pending/committed merge,
metadata/readset owner and operation accounting. No metadata SQL, shadow engine,
residual Application filter, public format switch or fallback is introduced.

Refactor the existing scan loop into one shared scanner. Existing array-returning
scan remains a projection for named callers; logical query streams expose pages
and their actual consumed CoreIndexCursor. The source databaseQueries budget counts unioned read-set intervals, not query
starts. Contiguous pages and overlapping reads merge instead of adding per-page
or per-start charges. Charge emitted documents/read bytes across every
page. Preserve bounded cached physical fetches, pending insert/move/delete
visibility, single-operation exclusion and fixed snapshot ownership.

Do not use count plus one to implement the new SDK. Source take/first/unique
consume at most n/one/two. Pagination reads to its requested size without looking
at the tail: an exactly full final page can be not-done, followed by an empty done
page. Cursor advancement follows yielded full keys; prefetched rows do not expand
observed dependencies. Ascending continuation uses source increment(full key),
clipped to the original interval; descending continuation excludes that key.

Collect must reach End or fail a shared operation quota. Larger take/page requests
must cross finite transport chunks without clamping their logical result. The
existing 128-document and 8 MiB transport budgets apply to chunks, including the
required envelope/cursor. They do not invent an aggregate collection limit. The
final user-function result retains its independent 8 MiB limit. A pure trusted
position-size projection may supply codec overhead to the shared page budget;
it grants no SQL, snapshot, commit or finalizer capability.

Both encoded bytes and the existing Worker semantic-size bound constrain each
transport frame, including its envelope and cursor. Compact numeric arrays can
fit the JSON bound while exceeding the semantic bound. Split such pages through
the shared scanner; preserve both measurements and the Worker validation limit.
Do not turn a transport-sized chunk into an operation-wide collection limit.

Track the complete terminal Promise, including internal page continuations and
terminal postprocessing. Refuse new developer terminal starts after closure;
drain already admitted continuations before settlement. Per-page host admission
and grant revalidation remain, with the captured operation Clock/diagnostics.
Do not hold a database transaction or a second operation lock across user code.
The [transport adaptation](../divergences/application-query-stream-transport.md)
owns the necessary Worker RPC chunking difference.

Public cursors bind instance, normalized query fingerprint and After(full key)
or End. They contain no snapshot, timestamp, expiry or durable cursor record.
Subsequent invocations use their own authorized snapshot. Preserve source
fingerprint inputs: query source distinction, normalized order, original range
expression sequence/operators and selected ordered fields excluding implicit _id;
page size/cursor are not query identity. Preserve ordered source JSON, distinguish
f64 values from integer operator limits, and verify numeric formatting vectors
before claiming identical Rust digest bytes. The source probe and retained
query/cipher goldens cover representative exact encodings; broader numerical
conformance is not inferred.

Translate version-7 InstanceCursor protobuf and deterministic AES-128-GCM-SIV:
16-byte cursor key from counter-HMAC-SHA256 over the stable 32-byte deployment
secret and the literal cursor purpose, zero nonce, version AAD, lowercase hex.
An instance-bound trusted broker holds the detached secret/key outside emitted
Worker definitions, user requests and application contexts. Supply it explicitly
at trusted composition; cold reopen reuses it. No per-operation key generation,
public-ID derivation, raw-key cursor or invocation-local public-token map.

## Coordinated ownership

- Protocol owner: pure index-range compiler/capture, source query fingerprint and
  cursor codec with their source-derived vectors. Reuse canonical values, sort
  encoding and existing hash owners. Root owns package exports/dependency edits.
- Core query owner: transaction/API query stream and shared scan implementation,
  metadata/interval dependencies, pending state, accounting and lifecycle; owner
  PGlite/PostgreSQL scenarios. Publish typed contracts before dependent wiring.
- Worker/SDK owner: SDK runtime/tuple types, FunctionApi composition, current
  FunctionRuntime and Worker definition/source/generated artifact. Preserve named
  legacy raw contexts and implement whole-terminal admission/drain.
- Connected host/consumer owner: trusted CoreApplicationMutationRunner query
  capability/broker wiring, fresh source/fixture/current-analysis composition,
  actual emitted SDK consumer cases. No raw-SQL repair or duplicate shared logic.
- Coordinator: this scope, source identities, divergence record, shared exports,
  dependencies, integration, isolated exact-index validation, reviews and commit.

Workers are not alone in the shared checkout. Do not revert others' work; sequence
contract handoffs and overlapping owners. Preserve unrelated old core/Task WIP.

## Required proof and remaining gates

Source vectors cover all operators, partial/full tuples and intrinsic indexes,
missing/null/nested paths, reordered and conflicting expressions, empty ranges,
escaped source behavior and keys over the physical split. Cursor cases include
determinism, authentication/version/payload errors, instance/query/order/field
mismatch, changed page size, deleted last row and cross-invocation continuation.

Core and actual Worker cases cover more than 128 results, all terminals and both
orders, exact/full/short/byte-limited/end pages, pending moves/deletes/inserts,
current cold registration, cold reopen and whole-terminal dropped-Promise/drain.
Prove consumed-frontier OCC: phantom insertion, boundary inclusion/exclusion,
same-key update, moves, outside nonconflict and metadata replacement/readiness.
Operation limits do not reset between pages. Run PGlite and ordinary-role real
PostgreSQL separately, affected tsrs --fast checks/lint/source guards, generated
verification and both required read-only project reviews before scoped commit.

Retain legacy compilers only for their named old-target Application/native,
strong-reference, freshness/cache/readset and compatibility-host consumers until
connected migration and durable-data disposition. This slice changes no physical
schema or named durable data. Actual app-DO ownership, reactive pagination split
protocols/endCursor, full staged schema lifecycle/builders, populated migrations,
native migration, GC and complete-operation capacity remain goal gates. The
connected path is SDK reads inside fresh Standard Application mutations; it does
not activate standalone query functions or replace their actual query-DO owner.
