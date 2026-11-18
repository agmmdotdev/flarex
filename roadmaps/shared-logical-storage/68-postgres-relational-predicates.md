# PostgreSQL relational predicates

## Status and scope

Status: implemented for bounded private relational reads. Native Price
Preference updates consume this contract
under [preflight 150](../flarexdb-framework-integration/preflight/150-native-price-preference-update.md).

This contract adds closed PostgreSQL text predicates to bounded relational
reads. It preserves the existing candidate, snapshot, pending-overlay,
dependency, resource and final-settlement owners. It adds no public SQL API,
query session, schema migration, durable format or general scan permission.

## Authority and semantic requirement

The [accepted database design](../../design-notes/flarex-db-accepted-design.md)
owns source admission, actual selected storage demand, exact running attempts
and protected capture header/body/tail, including the named short-transaction
exception for this operation. The
[shared storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
owns authoritative data and native framework boundaries. PostgreSQL remains
the only committed-data authority.

Native Medusa Price Preference selectors expose PostgreSQL text ranges,
LIKE/ILIKE, POSIX regular expressions, SIMPLE fulltext, negative membership
and existence checks. Existing scalar equality, membership and ASCII-only
LIKE do not represent that contract. A JavaScript regex, locale approximation,
copied fulltext algorithm or per-leaf database verdict would change behavior.

PostgreSQL plans and evaluates the complete Boolean tree. Decisive AND/OR
branches can suppress an otherwise invalid regex; NULL remains distinct from
false until the final matching decision. Evaluating each foreign leaf eagerly
would introduce errors that the actual native query avoids. A compiled program
therefore preserves the complete validated tree and evaluates it over the
captured candidate relation in one parameterized statement. Structural empty-IN
false, empty-NOT-IN true under OR, and contradictory same-column equalities can
suppress the invalid regex. Merely selecting NULL, absent identities, historical
identities or no active rows does not establish suppression; the native probes
still report the PostgreSQL error in those cohorts.

## Current ownership

`packages/persistence-postgres/src/values/relationalPredicate.ts` and
`values/relationalQuery.ts` own the shared predicate decoder, checked column/type lookup, node/depth/operand
limits, normalized tree, required-null facts and selected index/point/search
demands. A PostgreSQL-dependent tree issues a private program; existing pure
predicates retain their established execution and compatibility semantics.

`values/postgresRelationalPredicate.ts` owns program and batch identity, immutable
candidate capture and exact result decoding. The database owner's
`database/postgresRelationalPredicate.ts` renders the closed parameterized SQL.
The `postgresText` family selects native text comparison, LIKE, ILIKE, regex,
SIMPLE `to_tsvector`/`plainto_tsquery`, not-in and existence operations. Existing
node families can occur anywhere in the complete tree. Their earlier contracts,
including ASCII-only LIKE and UTF-8 ordering/comparison where already selected,
remain distinct from the new native PostgreSQL leaves.

Programs bind the original relational table metadata. Genuine immutable batches
bind that program and detached candidate values. Retained Legacy batches bind
their exact catalog table ID; translated Core batches bind the actual resolved
table object. These owner identities are not interchangeable.
Cloned tokens, foreign objects and substituted table identities refuse without
reading caller-authored getters. Column keys, patterns, values and candidate JSON
are SQL parameters; no caller supplies SQL text, database identifiers, callbacks,
database handles or settlement authority.

In the retained Legacy profile, `workingSet.ts` acquires original snapshot evidence and current pending
values through existing selected candidate paths. It validates complete rows
before presentation, evaluates the actual current candidates, and retains normal
row-use and read dependencies. Page execution applies the same predicate before
accepting a frontier member. A batch or verdict never survives as a reusable
query-specific cache; intervening pending writes require current evaluation.

The translated `core/nativeRelationalQuery.ts` keeps Core candidate observations,
pending overlays, ordering and projection. Its closed matcher runs inside the
existing native operation, uses one drained value-only statement, and validates
source admission before SQL and after successful decoding and charging. It does
not copy Legacy SQL-session choreography. Complete reads are admitted; the
separate Core PostgreSQL examined-page restriction remains closed. The
[Core predicate slice](../../experiments/core/engine/slices/21a-native-postgres-predicates.md)
owns those replacement boundaries.

The ordinary checked transaction and installed finite capture use the same
closed SQL body. The finite operation is named `relationalPredicate` and retains
the existing selected rows demand, source/catalog agreement, running-attempt
pins, snapshot/fence checks, fresh authority and protected header/body/tail.
Its materialized candidate relation feeds a materialized matching relation with
the complete predicate in WHERE. An ordinal left join returns a Boolean verdict
for every candidate; SQL NULL does not count as a match. Evaluation must still
run for an empty candidate relation because PostgreSQL planning may reject an
invalid regex even when no row matches.

This operation uses one short explicit protected transaction because PostgreSQL
can plan the dynamic WHERE regex before a rejecting authority header in a
single statement. For installed capture, the existing physical driver's
`runInitialTransactionEffect` directly owns one checkout and BEGIN/COMMIT/
ROLLBACK, cancellation cleanup, drain and quarantine. Its callback contains only
the protected work and a local admission-close finalizer; there is no nested
Drizzle transaction or read-callback transaction bridge. Acquire the actual
co-located installation admission, accept the
existing static ownership-fence header before sending the dynamic body, decode
exact results, then require a fresh accepting header tail with the same
command-local metadata epochs. Release results only after confirmed settlement.
Callback rollback, cleanup failure and noncommit preserve their full Causes.
Uncertain settlement withholds all results and retains the original settlement
and any quarantine cause; it creates no retry or recovery protocol. The existing
`relationalLimits.commandMs`, `lockMs` and `cleanupMs` bound this named operation;
other profile limits remain unchanged.

Full-artifact execution retains `runEffectTransactionSettlement` as its sole
protected transaction bridge and resolves its actual current installation.
Interruption withholds result delivery and drains the read-only transaction
before its checkout is released. Failed header, body, tail or settlement in
either path releases no business envelope.

This is the named exception recorded in the accepted database design. No
native/untrusted callback runs inside the transaction. It introduces no generic
finite read fallback, independent transaction, database function or migration.
Dynamic bodies use ephemeral unnamed SQL; no prepared-statement-name collision,
retained query session or cached permission verdict is introduced. Other named
finite captures retain their implicit-statement contract.

## PostgreSQL numeric casts of text

The private `postgresNumericCast` leaf compares a checked TEXT column, cast by
PostgreSQL to unconstrained `numeric`, against one finite JavaScript number.
Its closed operators are `gt`, `gte`, `lt` and `lte`. The operand's decimal
spelling is parameterized and cast to `numeric`; strings, nonfinite numbers,
wrong column types and undeclared envelope fields refuse during preparation.

Stored TEXT is not parsed or canonicalized by JavaScript or the finite exact
decimal decoder. PostgreSQL therefore owns accepted numeric spellings, exact
stored precision, NaN/Infinity, NULL and malformed-cast failures. The leaf makes
the complete Boolean tree PostgreSQL-dependent. Lexical guards, other predicates
and numeric casts are evaluated together; no eager per-leaf verdict or retained
numeric interpretation is introduced.

This terminal predicate adds no index or scan permission. Existing indexed
candidate acquisition, complete row validation, pending overlays, read receipts,
program/batch identity, resource limits and protected `relationalPredicate`
capture remain authoritative. Empty candidate batches still reach that owner.
The finite numeric-column `numericIn` contract and existing pure predicates
remain unchanged. This scalar mechanism does not admit joins or Promotion
business policy, and does not repair native malformed SQL generation.

## Positive text, Boolean and canonical timestamp membership

Positive `in` accepts SQL NULL query operands against checked TEXT, Boolean and
TIMESTAMPTZ columns, including nonnullable columns. Timestamp operands use the
existing canonical UTC millisecond encoding and checked calendar/year range;
offset spellings, finer precision and invalid dates refuse. NULL contributes no equality match; it
does not mean that a stored value is null. Literal text `"null"` remains distinct.
Use the existing explicit-null predicate to select null values.

The raw query retains every duplicate and NULL operand for identity and resource
accounting. Logical selection derives equality points only from nonnull values;
existing column and index authority still applies to NULL-only and empty
cohorts. Pure matching and complete PostgreSQL Boolean-tree evaluation preserve
the same positive WHERE result. Physical compatibility parameterizes a typed SQL
NULL without passing it through the stored-value validator.

Timestamp equality points retain the existing indexed selection owner and
missing-index refusal. An indexed timestamp less-than branch combined with
membership represents an inclusive upper boundary without changing its clock
value. Current, pending and earlier committed snapshots use the existing
dependency, history, rollback and durable replay owners.

This query contract does not relax nonnullable writes, numeric membership,
negative recipes or indexed-point NULL operands. Malformed siblings, wrong
column types, undeclared fields and operand limits keep their existing owners.

## Exact numeric membership

Native Price List Price creation requires numeric equality for finite quantity
selectors under [preflight 155](../flarexdb-framework-integration/preflight/155-native-price-list-price-creation.md).
The `in` grammar accepts text, Boolean and SQL NULL query operands and refuses a
numeric column; converting numbers to strings does not satisfy that column
contract. The separate private `numericIn` leaf now accepts checked exact-decimal
strings and finite numbers only against a numeric column. Existing `in` and
explicit-null semantics remain unchanged.

The relational preparation owner canonicalizes operands with the existing exact
decimal decoder. Pure matching compares canonical decimal values, preserving
equivalent scales and signed zero without binary64 equality for stored decimal
strings. When a complete tree requires PostgreSQL evaluation, the existing
compiler binds canonical strings and casts both the captured column and operands
to `numeric`. Invalid operands and wrong column types refuse before execution;
complete stored-row validation still precedes matching and projection.

This terminal membership leaf adds no numeric index selection, ordered encoding,
scan permission or new capture lifetime. Existing indexed conjuncts, complete
candidate and identity proofs, pending overlays, counts, dependencies and
node/depth/operand/byte limits keep their current owners. Empty membership proves
an empty selection; null requires the existing explicit-null predicate. Framework
adapters choose their finite input grammar and translate to this shared leaf.

## Bounds and failure

Complete-set reads can explicitly request `includeIdentities: true`. The shared
selection owner then records existing `orderedIdentities` evidence from the
actual matched rows in returned order, before caller projection. This applies
to pure and PostgreSQL predicates and preserves the normal dependency
observations, which may include candidates rejected by the predicate. A receipt
must use the selected identities to establish membership rather than treating
every dependency observation as a returned row or re-evaluating PostgreSQL in
JavaScript. Empty selections retain an explicit empty identity set. Existing
storage-insertion identity evidence and unrequested read profiles are unchanged.
Paged reads refuse the flag because their lookahead does not establish the
complete-set observation contract; ordinary page behavior remains separate.

Predicate complexity retains the existing shared limits. Candidate counts and
input/output bytes remain charged to the actual request lifetime. The batch
issuer and finite capture additionally enforce the existing 1 MiB bounded
candidate-transfer ceiling even if a direct trusted caller passes a larger
allowance. Candidate counts retain their actual participant allowance, including
existing explicitly larger profiles; a new universal 256-row limit would reduce
those contracts. The normalized program and captured rows both count toward the
input bound. These are prerequisite acceptance gates, not permission to increase
existing profiles or resource selections.

Results contain exactly one zero-based ordinal and Boolean-or-NULL value per
captured candidate, in ordinal order. Missing, repeated, reordered, extra or
malformed rows refuse; only true includes a candidate. Native PostgreSQL errors
stay failures under the existing first-refusal and rollback-only owner. Catching
a body or tail failure in native code cannot make the root durable.

## Finite integer and binary64 membership candidate

The approved private `numberIn` leaf admits finite JavaScript numbers against
checked `integer` and `doublePrecision` columns. Integer operands retain signed
int32 bounds; binary64 equality preserves exponent values, extrema and signed
zero equality. It remains distinct from exact-decimal `numericIn`, REAL
normalization and ordinary text/Boolean `in`. Null never matches this leaf.

The complete raw operand list is charged before deduplication. Numeric residual
filtering grants no indexed access path and cannot shrink a selected candidate
cohort before the existing resource checks. Mixed PostgreSQL predicate trees
use typed binary64 expressions over those same captured candidates, under the
same manager, dependency tracking, pending writes and rollback owner.

The native Order version selector is the connected consumer. Its original
indexed-parent success and rejected numeric conjunct remain preserved. The
candidate requires neutral storage validation on both database drivers and the
native consumer proof before admission; full Payment finance roots retain their
separate workflow gates.

## Convex compatibility and limits

This is a private framework-compatible PostgreSQL query extension. It does not
change the portable Convex Application developer model, its query API or its OCC
contract. Application, Payload and other Medusa profiles retain their existing
admission and limits; shared storage does not grant this syntax implicitly.

Native semantic evidence uses UTF-8 PostgreSQL with C collation/ctype. Fulltext
uses explicit SIMPLE regardless of the database default text-search dictionary.
The compatibility PGlite database uses C collation with C.UTF-8 ctype; its
native ILIKE folds accented case where the ordinary C-ctype PostgreSQL baseline
does not. The same closed SQL preserves each engine's locale behavior. Passing
both lanes does not establish identical Unicode case matching across these
two locale configurations.
Other locale/collation variants, hosted activation, arbitrary-query support,
unbounded regex/fulltext work and capacity are not established by this slice.

## Acceptance gates

- Prove neutral committed, historical-snapshot and pending-row membership,
  projection, counts and paging on PGlite and ordinary-role PostgreSQL, including
  non-Medusa consumers and unchanged existing predicate families.
- Compare complete-tree AND/OR/NULL/error behavior with the pinned native
  baseline, including decisive empty/contradictory branches and invalid regex.
- Prove immutable value ownership, original-table/catalog binding, forged and
  cloned token refusal, source/demand/attempt mismatch, bounded input/output,
  exact nullable ordinals, caught failure and protected-tail refusal through
  genuine installed finite captures.
- Preserve current source, index/point/null demand, snapshot, publication,
  replay/recovery and one-outer-settlement behavior. Complete affected checks,
  both required reviews and owned temporary-resource cleanup before activation.
- Admit the connected full Price Preference update workflow only after these
  owner gates and its own native/adapter proofs hold. Do not substitute an
  ID-only selector profile for the accepted native selector contract.


## Proposed same-source related predicate program

Status: implemented as a private, explicitly selected same-source profile. This
heading retains its existing reference anchor. General joins, physical-store
admission and complete native Promotion/Cart workflow admission remain outside
this capability. The approved native historical evaluation policy is recorded
in [preflight 160](../flarexdb-framework-integration/preflight/160-native-cart-creation-workflow.md#promotion-prefilter-compatibility-boundary).

The optional logical table operation related accepts one genuine parent table,
one same-source child table, a checked nonnullable TEXT child FK to the single
TEXT parent primary key, and a bounded Boolean program. Parent and child leaves
reuse the scalar compiler; notInChild compares the parent key with the checked
child FK projection. PostgreSQL evaluates the complete left-join/subquery
program, including lexical guards, numeric casts and SQL NULL behavior. The
scalar API continues to refuse dotted columns, augmented rows and invented
combined metadata.

Both complete current cohorts use existing indexed acquisition, snapshot and
pending-write owners. Original source-preparation group identity is retained
through combined mechanics; matching lineage alone does not authorize a pair.
The default shared program limits remain 64 nodes, depth eight and 256 operands
across related wrappers and scalar subtrees. The explicitly selected Promotion
allowance below changes only aggregate related nodes. Combined cohort rows and
bytes, possible parent/child comparisons and returned values consume existing
request budgets. Other limits remain unchanged. The issued batch retains both actual table definitions and
catalog IDs, an immutable program and exact ordered parent verdicts. Activity
retains each cohort's identities and the authenticated related match selection.

Finite capture authenticates both genuine tables before dynamic evaluation.
The existing accepting header, body, fresh tail and confirmed settlement owner
remains authoritative. The installed paired frontier already fences complete
control metadata generations. For the fullArtifact compatibility profile with
a separate control database, only the related operation additionally brackets
the protected target capture with existing control-epoch reads. A changed
child catalog epoch refuses before result exposure. Scalar captures and physical
profiles retain their existing admission contracts.

No adapter SQL, source-local exception, extra workflow transaction, independent
runner, recovery store or reusable verdict is introduced. Automatic Promotion
root selection, no-root skip, historical evaluation policy and global/target/buy
membership exclusions stay with native Promotion. Its absence of automatic
roots skips this operation; it changes no shared empty-batch semantics. The
native SQL comparator's bounded agreement is not general plan-error equivalence,
production activation or unbounded query/graph support.

## Native Promotion related-program resource gate

Status: implemented as a private, explicitly selected native Promotion profile. The
preserved genuine eight-attribute Cart context produces 188 predicate nodes,
depth five and 80 operands (3,711 UTF-8 SQL bytes). The current 64-node aggregate
related-program default correctly refuses limitExceeded; manual Promotion and
Campaign reads are independent of this refusal. Removing native context fields,
splitting the tree or evaluating casts in JavaScript would change the admitted
native historical Rule/Value policy.

The existing captured, immutable, identity-bound CommerceResources selection
owns the optional relatedPredicateNodes allowance, bounded at 256. Omission
retains default 64 and its existing canonical identity bytes. Only the selected
participant's related compiler receives the captured allowance; query JSON
cannot select it. The selected native Promotion profile admits the complete
188-node program without pruning context or splitting evaluation.
Scalar subtree limits remain 64, with aggregate related depth eight and 256
operands, same-source authentication, cohort/byte/join budgets, protected
capture and the single settlement owner unchanged. Captured selection is
isolated between participants and retained in request identity; a changed
selection conflicts with durable replay. Complete Cart root admission remains
with its separate workflow owner.

The separate combined borrowed-workflow profile has no participant-local
allowance. It refuses an explicit relatedPredicateNodes selection before
working-set construction. Its omitted/default policy and existing Product
Launch consumer remain unchanged. Queued Commerce borrowing retains the
original participant's selected working set and supports the Promotion profile.
