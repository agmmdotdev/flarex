# Bounded framework text equality

Status: experimental core construction. Native Payload deletion/preference
cleanup and native Product list-by-handle consume this owner within their bounded
framework profiles. This
capability does not establish general filters, pagination, count, framework
support or a performance result.

## Operation and state

An immutable framework definition may select named text-equality indexes over
required or nullable text. Null has no membership. Application keeps its existing
numeric-index profile; this does not widen Application query semantics.

The root admits `equalIds`, `equalRows` and `deleteEqual` with a selected index,
field and bounded set of exact text keys. Keys are detached, deduplicated and
sorted once per acquisition identity. Descriptor-safe capture precedes decoding;
indexed fields and lookup keys share well-formed, NUL-free text, preserving exact
equality through UTF-8 and PostgreSQL. Original membership is cached at the
command snapshot; pending membership is maintained incrementally by the change
owner. Queries merge only the relevant original and pending members. Repeated
edits retain one final change, and an insert followed by deletion publishes no
row or tombstone. Borrowed operations use the same supervision and shared budget.

`deleteEqual` acquires identities and predecessor revisions, not document bodies.
It stages those accepted predecessors directly. Original state distinguishes
missing, tombstone, projected live predecessor and acquired document. A later
point read of a projected live predecessor must acquire that same revision or
refuse with a conflict. Projected live predecessors never become tombstone read
dependencies merely because their body was not acquired.

## Physical query and publication

Drizzle owns `equality_versions` intervals linked to the authoritative history
revision. A SHA-256 fingerprint makes the btree lookup key bounded; exact text
comparison with PostgreSQL `C` collation determines equality. The hash is neither
equality proof nor authorization. Full text is retained outside the btree key,
so long admitted field values do not exceed the btree entry limit.

The actual query limits fingerprint candidates before visibility and exact-text
filtering. Invisible historical entries and collisions count as examined work.
Identity acquisition does not join history or transfer large document values.
Document acquisition joins the accepted history revision and guards body transfer
with the remaining byte bound. Shared budgets charge examined entries, key and
identity work bytes, acquired bodies, predicate/point evidence and pending edits.
Overflow poisons the root and refuses the whole result. These logical work bytes
are not a measurement of wire bytes, heap size, disk traffic or all server work.

Accepting owners hold the existing fresh authority/selected-definition gates,
command ownership and scope clock. Both direct framework and mixed profiles
reject interval starts or ends after the command snapshot within an observed
equality predicate, including a negative result. Direct point writes retain
their compare-and-swap profile; this explicit mutation-query obligation does not
attach universal Application OCC or automatic native retries.

The existing materialization owner closes old intervals, writes new memberships
and publishes rows/history/events/result at one sequence. Definitions without
equality indexes add no equality maintenance statement. This migration is only
for owned disposable experiment installations. Active schemas, adapters and
production routing are untouched.

## Proof boundary

The core contract suite covers large-value identity projection, duplicate keys,
pending insert/edit/delete membership, projected hydration, matching writer races,
negative predicates, independent-key controls, fingerprint collision filtering,
long keys, historical-candidate limits and fresh authority. Group witnesses use
the same accepting owners. Plan witnesses execute the actual identity builder
under each driver; real PostgreSQL uses the ordinary serving role.

The construction contract for native CRUD remains [PAYLOAD-CRUD.md](./PAYLOAD-CRUD.md).
Native delete hooks and multi-user preference cleanup consume this operation
through one selected outer command; their connected proof gates must pass before
CRUD can be measured.
