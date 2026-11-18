# Payload indexed scalar replacement

Status: **Selected replacement implemented and validated; broader native, host and performance gates remain open.**

This connected slice extends the [native scalar cutover](./10-payload-native-core-cutover.md)
through the existing indexed Payload fixture family. The [goal](../GOAL.md)
remains the full supported-core replacement. This slice does not establish all
Payload support, Medusa support, native DO hosting or complete-request performance.

## Consumer and cleanup boundary

Migrate the actual `payloadIndexedFixture` consumers, including ordinary indexed
queries, required scalar/compound uniqueness, and nullable `nullsDistinct`
uniqueness. They share one old projector/SQL owner; leaving its nullable callers
behind would retain the displaced implementation for the same connected family.
Reuse genuine Payload Local API, sanitation, access, validation, hooks, result
envelopes and meaningful existing scenarios. Replace fabricated Application
metadata, old full-proof installation/session/working-set construction and
physical claim/fact-count assertions. Do not put a new facade over those owners.

The finite admitted query grammar remains conjunctions over ID and declared
scalar indexes: scalar/null equality, finite numeric bounds, and the existing
sanitized conjunction wrapper. Choose ID, then an eligible complete unique key,
otherwise a declared equality prefix and one following range. Keep residual
filters, native ID ordering and numbered pagination after complete bounded
candidate capture. No new `or`, arbitrary predicates, joins, keyset pagination,
relations, exact decimals or conditional constraints are admitted here.

Preserve the existing 256 captured-identity bound, byte/lifetime bounds, default
returned-page limit and page validation. A selective query must still work with
288 unrelated rows present; a broad query over those rows must fail. A logical
output limit does not prove physical EOF. Overflow precedes first-row coherence,
residual filtering, sorting and output pagination as in the executing owner.
Payload normalizes numeric signed zero; raw trusted Core values retain Source
signed-zero distinctions. Missing nullable storage is invalid; explicit null is
queryable. Null-containing `nullsDistinct` tuples do not acquire uniqueness.

Keep named later consumers: other scalar fixtures, operation tracing, preference
deletion, relationships, borrowed participation, private references, Medusa and
mixed roots. Each retained old owner needs those callers and a removal gate.

## Three-way challenge and disposition

Current-owner, pinned-Source and accepted-design agents independently inspected
the mechanism and exchanged counterexamples before runtime assignment. The
five added genuine Local API characterization cases establish:

| Case | Existing required behavior |
| --- | --- |
| Empty range, independently committed insert then delete | Final empty membership may accept; the held callback runs once. |
| Point capture, non-key update, first ordinary range | Return the remembered body at the query checkpoint; final point validation rejects. |
| Point capture, separate key-away/key-back commits | Reject the first range before disclosure; a caught failure leaves the root rollback-only. |
| Root pending move masks a physical key ABA | The physical candidate still triggers that immediate rejection. |
| Competitor moves the remembered row out without returning | The first range may return empty; final point validation rejects. |

These cases prohibit both Source event-conflict substitution and blanket
revalidation of all remembered rows before every native query. The genuine old
PostgreSQL control passed all five; new-path proofs remain required.

Copy the pinned range decomposition, binary keys, physical EOF evidence,
pending index merge, metadata dependencies, hydration and same-key revision
maintenance. Pinned owners are `common/src/query.rs`,
`database/src/transaction_index.rs`, `database/src/query/index_range.rs`, and
`indexing/src/index_registry.rs` at `db914cf06e2b06ee985646611b9e12ed7a770318`.
Convex rewrites index entries on every document update, even unchanged keys;
do not remove those writes to imitate the old native membership generation.

The required native distinction is recorded separately in
[ordinary index observations](../divergences/native-ordinary-index-observations.md).
Raw Application event dependencies remain unchanged. Native complete-range
membership uses exact terminal state plus remembered-row guards; first-capture
coherence uses a retained real-key-transition proof. This extends the existing
native observation packet and accepted-save dependency graph, not a second
query engine, transaction owner or physical generation table.

## Shared contracts before runtime edits

- The transaction owner records first semantic observation time separately from
  a row's revision. A fresh physical range freezes its data frontier and the
  corresponding retained-log snapshot synchronously before asynchronous reads.
- Extend the existing Core query owner with a narrow internal consumed-candidate
  evidence seam. Observe raw physical candidates before pending written-ID
  suppression or residual predicates. Do not turn unused prefetch into consumed
  dependencies. Finish the bounded capture/overflow verdict before first-row
  certification and any disclosure.
- The coordinated internal ABI is `find(table, where)` with Core-owned finite
  decoding/planning. A bounded raw-capture helper in the existing query owner
  replaces the old native scan loop and shares its physical page/cursor rules;
  its complete capture is distinct from Application logical output completion.
  Final observations use one `indexes` union: unique-owner slots and ordinary
  full-key/ID ranges. The volatile packet carries its trusted native limits.
- The same writes map and pending index owner determine output suppression and
  overlay. Remembering a read does not create a write or mutation charge.
- Existing native policy/authority owners authenticate scalar indexes and
  compound/null rules against the real source. Preserve strict policy closure,
  active index generation checks, sticky failures and callback-once behavior.
- Ordinary-range final validation folds complete accepted old/new transitions
  and retains selective durability prerequisites, including removals, ABA and
  result-only decisions. Reuse the Native10 DAG and save/publication owner.
- Bind native limits through the responsible trusted Core/native boundary.
  Adapter scans, extra transactions and looser Source defaults cannot substitute
  for the existing native budget. `beginNative` requires
  `limits: { maxIdentities }`; the trusted CMS host supplies its existing 256
  ceiling. Final published range preparation preserves the same bound before
  membership comparison, including the old `limitExceeded` outcome when a
  previously bounded range grows past it.
  The [native command budget](../divergences/native-command-budgets.md) also
  requires `maxDocumentBytes` and a transaction-local Effect charging callback
  into the same native request lifetime. Arguments, retained rows/versions and
  results share the existing command-byte counter; hidden candidates cannot
  bypass it. Source accounting remains independent and unchanged.
- Keep the Native10 persisted unary policy and outcome identity obligation
  explicit. Capture actual five-table rows at the existing commit before policy
  representation changes; prove strict cold authentication and result replay.
  A source identity cannot silently change because a private clause gets a
  tuple representation. This is not a populated schema-upgrade implementation.
  New table policies write ordered `fields` and explicit `nullsDistinct`.
  A strict, read-only Legacy unary-clause alternative preserves the named
  Native10 store; mixed/extra fields are refused and semantic clauses must still
  match the authenticated source. No source hash or stored outcome is rewritten.

The replacement now lives in the existing transaction/query/observation,
retained-log, acceptance, shared schema and native CMS owners. Its selected
indexed/unique/nullable fixtures use the genuine shared native builder. Unique
slot memos retain only IDs/keys; semantic originals own charged bodies. Identical
schema replay compares authenticated policy meaning, preserving both object-key
order independence and the named Legacy unary store without metadata writes.
Source-only writes do not populate the native transition cache. No sixth physical
table or old-engine fallback was introduced. The proof and retirement gates
below remain authoritative; implementation alone does not close them.

One physical installation may serve independent app instances through the
existing `instance_name` partition. Reuse that target for the two-owner isolation
witness; do not create per-app SQL tables or conflate this with Source component
namespaces. Each app retains its own lease, globals, indexes and logical owner.

## Connected proof and retirement

The required mixed-Cause budget witness exposed a connected Payload adapter
defect: its Effect-to-Promise runner squashes a combined failure into one
throwable, losing defect/interruption reasons and annotations; reentry then
duplicates the original CMS refusal. The expected result retains the original
annotated refusal once alongside the defect and interruption. The executing
owner is `payload-adapter/adapter.ts` and its request/operation round trip, not
Core validation or another persistence engine. Preserve that failing witness;
correct the request-local foreign boundary under the authorized replacement,
then rerun actual native error/drain and caller regressions. No guarantee is
being weakened to accommodate the failure.

The correction additionally preserves native uniqueness reclassification and
request-local origin isolation at the bounded-lifetime owner. The old poisoned
root stays poisoned; a native ValidationError does not inherit authentication
for a different internal typed error. Returning the owned native Cause through
the existing deadline race prevents duplicate failure origins after Effect
cloning. Actual Local API and bounded-owner regressions prove these connected
obligations alongside the focused Cause tests.

The actual indexed/unique/nullable Local API scenarios now run on PGlite and an
ordinary PostgreSQL role. They carry the five characterization cases unchanged in
meaning, pending moves/deletes/inserts, range-before-scan and scan-before-range,
phantom/outside writes, malformed Unicode including residuals, exact totals and
pages, nulls, signed zero, uniqueness races and native error order. Owner cases
cover bounded log-retention failure, same-key update versus separate key ABA, Source by-ID
regressions, accepted-unsaved restore dependencies and independent save progress.

Old-table EXPLAIN checks are replaced with five-table range/hydration plans.
The cases prove two app owners on the same physical target, cold policy authentication, native
outcome replay without body replay, rollback-only and lifetime cleanup. Preserve
the actual Application DO regression; native DO proof and quiet complete-request
performance remain explicit full-goal gates, not inferred from database tests.

The selected fixture family's old installation/session/projector wiring,
exports and obsolete physical assertions are removed. Duplicate full-proof
visibility wrappers are retired against the existing genuine Core-native
vectors. Other named consumers above retain their own removal gates.

The selected database and consumer regressions, guarded cold Native10-store
replay, mixed native failure/cancellation, bounded-lifetime controls and actual
Application DO regression pass; required independent reviews clear the owned
replacement. Execution receipts belong to Git. Native DO hosting, broader
Payload contracts, retained external-data conversion, Medusa/mixed-root migration
and complete-flow capacity remain full-goal gates.
