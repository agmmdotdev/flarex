# SQL real scalar mechanics

## Status and scope

Status: bounded private implementation, validated through ordinary execution and
finite capture on PGlite and ordinary-role PostgreSQL. This owns the neutral relational `real` scalar prerequisite for
[native item Tax lines](../flarexdb-framework-integration/preflight/163-native-item-tax-lines.md).
It covers logical row normalization and complete stored-row verification. It
does not admit Tax configuration writes or the native Tax workflow itself.

The [accepted database design](../../design-notes/flarex-db-accepted-design.md),
[shared logical storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
and [package boundaries](../16-package-boundaries.md) remain authoritative.
Postgres remains the committed-data authority. This adds no public SQL API,
transaction owner or framework-specific storage exception.

## Representation and decisions

The checked relational vocabulary distinguishes SQL `real` from finite
binary64 `doublePrecision`, int32 `integer` and exact-decimal `numeric`.
The primitive value contract admits only finite JavaScript numbers and declared
nulls. That pure check does not establish PostgreSQL REAL conversion or a
canonical stored representation.

The storage owner sends each captured number's decimal `String(value)`
spelling to PostgreSQL. A closed statement checks `pg_input_is_valid` before
casting to `real`, then obtains `real::text`. The result decoder accepts only
the bounded finite decimal/scientific wire grammar before converting it to a
JavaScript number. Overflow and underflow that PostgreSQL refuses stay typed
row failures; they do not become successful zero values or resource failures.
Null remains null, and input negative zero takes its ordinary decimal spelling
`0`.

The conversion must use the actual borrowed session with
`extra_float_digits = 1`. A different actual setting yields
`unsupportedProfile`; the owner does not change session configuration or
borrow a second connection. A JavaScript `Math.fround` implementation cannot
replace decimal-to-REAL-to-wire conversion: decimal midpoint handling and the
shortest wire representation can differ from its expanded binary64 result.

## Current ownership and ordering

The [protocol row-value owner](../../packages/flarex-protocol/src/relational-schema/values.ts)
separates complete column checks from complete row constraints. For REAL
writes, the existing row owner applies defaults and merges, validates the
column input domain, performs actual SQL conversion, then validates the
complete normalized row and companion contracts before canonicalization,
history or derived keys. Pure candidates cannot issue a normalized verdict.

The existing [relational row mechanics owner](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts)
issues a closed batch bound to genuine table mechanics, the actual catalog
table, captured row/cell ordinals, decimal spellings and existing finite
row/source/byte limits. Only its actual borrowed-transaction execution can
issue the SQL-backed verdict. It exposes no result decoder that can turn
caller-authored result rows into normalization authority.

The [working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts)
retains the existing accepting document bounds and charges. It validates
current, historical and previous rows before native inspection, including
initialization, merged writes, pending reads, restoration, same-root
reconstitution and recorded replay where those operations are independently
admitted. Stored verification uses the same SQL conversion and requires an
unchanged value; a changed value is `storedCorruption`, never a silent repair.

The named `relationalReal` [finite capture](../../packages/persistence-postgres/src/execution/finiteStorageCapture.ts)
retains actual source/table admission, running-attempt pins, snapshot/fences,
protected header/body/tail and confirmed settlement under the existing
protected relational-capture transaction owner. Ordinary execution uses the
existing checked borrowed transaction. Neither path retains a database or
settlement capability in a scalar verdict.

## Invariants and trust boundaries

Canonical interpretation stays with the existing mechanics/canonical owners,
bound to the exact table, immutable runtime values and protected canonical
bytes/digest. Copied candidates, foreign batches/mechanics, wrong tables and
mutated canonical evidence cannot borrow acceptance. Each working set owns its
checked-document reuse; a retained canonical object from another root does not
skip that root's actual SQL verification. Pure same-root cached reads create
no new physical session. Every actual conversion checks its own session.

Conversion uses the existing row and remaining-byte budgets, including a
bounded response envelope before execution. Refusal, cancellation or failed
settlement withholds results and preserves the existing first-failure latch,
rollback and full Cause. No new allowance, fallback or retry protocol is added.

## Compatibility and deliberate divergence

Existing int32, binary64, exact numeric and canonical value encodings remain
unchanged. Convex/Application document numbers retain their existing public
contract; this is an explicit relational source scalar, not a new developer
value type. Source hashes distinguish `real` metadata. Existing populated
sources are not silently reinterpreted or migrated under that changed schema.

The retained per-table physical-DDL/artifact engine explicitly refuses
`real`. Its former consumer obligations do not establish this new logical
scalar's physical-DDL support.

## Known gaps and named gates

REAL literal defaults, real-valued ordered or unique keys, real-value query
comparison/aggregation and REAL sorting are unsupported. Projection through an
otherwise admitted bounded read is distinct from those query capabilities.

The **neutral real reference maintenance** gate covers terminal set-null and
reference-replacement maintenance of REAL-bearing source rows. Those actual
owners refuse `unsupportedProfile` before mutation. They require their own
borrowed conversion and aggregate conversion-byte proof before admission;
source installation and ordinary declared-reference checks do not remove this
gate. Reaching the refusal must roll back any already staged prefix.

Fresh pure canonical validation without prepared SQL mechanics also refuses
REAL; it cannot fabricate SQL evidence. Native creation DTO input retention,
general Tax CRUD, remote providers, complete Cart composition and hosted
activation remain separate framework/profile decisions.

## Verification and remaining proof limits

The [protocol contract tests](../../packages/flarex-protocol/test/relational-real.test.ts),
[pure authority controls](../../packages/persistence-postgres/test/storage/documents/logicalRealRows.test.ts)
and [neutral installed scenario](../../packages/persistence-postgres/test/storage/relationalSchema/realScenario.ts)
cover the admitted contract on PGlite and ordinary-role PostgreSQL, with ordinary
and finite-capture installed execution. They exercise decimal midpoint/tie behavior, canonical maximum, subnormal and refused
underflow/overflow, nulls and signed zero; initialization/default application,
merged updates, pending/cold reads, retained historical bytes and admitted inverses; malformed or
noncanonical stored values and forged/mutated verdicts; actual unsupported
session settings, finite capture lifecycle/settlement and atomic prefix
rollback. A conversion-executor observation followed by an integer-constraint
refusal checks that complete constraints run after conversion. The retained
physical layout owner explicitly refuses this scalar.

The historical assertion checks retained normalized bytes; it does not establish
the new SQL validation frontier for historical queries. Cancellation after staged
conversion checks complete durable rollback, but REAL-specific in-flight SQL
cancellation, fence loss and uncertain capture settlement are not injected.
The installed terminal reference control reaches set-null refusal with a genuine
foreign key and trusted policy; reference-replacement refusal is statically
traced. Cold rows may require individual conversion statements; these proofs
make no performance claim.

Native Tax read admission additionally requires its checked four-model source,
provider construction, complete candidate hydration and native workflow
compatibility gates. This scalar prerequisite does not establish those results.
