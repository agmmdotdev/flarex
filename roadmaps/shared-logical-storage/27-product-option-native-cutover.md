# Native Product Option on shared logical storage

Status: selected native Option path implemented under the standing
shared-storage completion goal. The full Product compatibility runner retains
its physical source for other unported operations.

## Connected outcome and owners

Move the pinned ProductOption service's create, read, update/upsert and delete
operations onto the selected Product logical source, including owned OptionValue
rows and Variant–Value pivots. Preserve the native service's normalization,
DTOs, missing-ID errors and module messages. The shared row, index, unique,
FK, bounded working-set and settlement owners enforce storage semantics. The
Product adapter authenticates the exact native command/row/event transcript;
it must not issue SQL or introduce a second transaction.

The pinned Option model declares a Product parent, a cascading Value child and
active uniqueness on `(product_id, title)`. Value declares nullable Option
membership and active uniqueness on `(option_id, value)`. The current complete
logical Product definition already contains these declarations, and selected
Product creation/update/delete exercises portions of the same graph. The
remaining physical Option boundary fixture checks foreign-scope projection,
cascaded Value/pivot deletion, failed upsert rollback and refusal. The full
physical Product runner still covers other unported operations; this slice
does not retire that runner or its installation.

## Decision, breaks and gates

Use the existing selected Product source and native service commands. Extend
the narrow Product event policy for Option-owned transitions, then move the
physical-only Option boundary witnesses that the logical path replaces. A
generic entity policy alone would incorrectly reject silent dependent Value
and pivot changes; a special physical table or adapter cascade would duplicate
core authority. Update private host/fixture selection directly. No public
Medusa method or durable identity changes. Physical Product data stays under
the Product cutover's explicit disposition gate.

The native Option count by `product_id` and `title` exposed a shared planner
defect: `product_id` has an admitted index, but the planner refused the
unindexed `title` residual before choosing that index. Correct the conjunction
planner at `logicalDocuments/relationalQuery.ts` so an indexed scalar equality conjunct bounds
the complete candidate set and the residual is checked on those rows. A lone
unindexed text predicate, or an OR branch without an indexed anchor, must
still refuse; no Product-specific index or catalog scan is permitted. Prove
this in the neutral logical relational scenario and the native Option read.

On PGlite and ordinary-role PostgreSQL, prove native Option create, selected
parent/child read and count, update/upsert, hard delete, active compound
uniqueness, missing-parent refusal, Value and pivot effects, rollback/replay,
two-scope isolation and exact event/outcome receipts. Preserve relevant pinned
Option cases and source guards. Run affected typechecks and lint, obtain both
read-only reviews, reconcile the owning roadmap and commit the connected
implementation and cleanup. If a core bound blocks a supported operation,
record the precise refusal and correct the core owner in a separate focused
preflight when its contract materially changes; never mask it in the adapter.

## Selected result and remaining gate

Native Option creation with owned Values, parent/child reads, count, title
update, mixed upsert with native generated IDs, failed upsert rollback and hard deletion now use the generic Product
source. The adapter correlates Option/Value mutations and events, including
silent Value and Variant–Value pivot removal on Option delete. A failed late
validation rolls back the whole graph and publishes no event; successful
deletion retains shared row tombstones and emits the native root-only message.
The old physical-only Option boundary fixture is displaced by logical
two-shop, refusal, rollback and replay witnesses. The pinned full Product
compatibility runner remains physical for unported commands. This selected
path does not retire Product physical installation or lift the core's current
128-observed-identity limit for high-fan-out graph deletion. The later
[null-index residual correction](./29-relational-null-residual-anchor.md)
also admits a text residual when the shared working set proves a nullable-field
index against installed definitions; the Option path itself uses its indexed
`product_id` equality anchor.
