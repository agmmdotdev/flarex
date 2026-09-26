# Core indexed text search for logical rows

Status: the selected shared search path and native Product `q` cutover are
implemented. Physical Product fixture retirement and broader search capacity
measurements remain open in the Product and final-acceptance roadmaps. The accepted
shared-storage design requires bounded indexed reads. This note owns that
shared query contract, not a Medusa-specific search engine.

## Trigger and owners

The pinned Product DAL lowers `q` to an OR of ASCII-folded SQL `LIKE` patterns
over its DML-declared searchable text fields. `%` and `_` retain SQL wildcard
meaning; backslashes are literal. With deleted rows included, the active-row
null-index anchor is absent. The logical reader correctly refuses the current
unanchored plan rather than scanning every Product in a shop. The legacy
physical witness stays named in [Product closeout](./44-product-module-closeout.md)
until this contract is served by the generic logical source.

The normalized relational schema already carries an authored `searchableText`
capability, and the pinned Medusa DML compiler already fills its field
identities. Core must compile that existing capability into a search-index
requirement and own stable index identity, source-complete preparation,
per-scope readiness,
write and restore maintenance, candidate selection, work budgets, and recovery.
The Product adapter supplies the native DML fields and retains native result,
order, count, and event semantics. Other admitted consumers may use the same
generic physical family through their own explicit logical search requirement;
the core does not import commerce code.

## Selected bounded GIN direction and challenged alternatives

- Do not lift the logical query refusal or read a capped catalog prefix. A page
  of candidates is not a complete count or OR result.
- Do not create a Product-specific search map or physical Product table. It
  would duplicate settlement and return to per-module physical layout.
- Do not index every JSON document or historical revision implicitly. That
  would amplify all writes and allow old matching revisions to dominate a
  current-row query. Search is an explicit logical requirement.
- Use a generic current-search family keyed by scope, stable search-definition
  identity, field identity and row identity. Store the ASCII-folded value for
  each declared non-null field and bind it to the current logical row revision.
  A physical GIN access path combines scope and definition identity
  with `pg_trgm` text matching; it does not create a table or index per shop or
  logical table. A row update, soft delete, restore or hard delete changes this
  family in the same transaction as row/index/history/publication effects.
  Soft-deleted rows remain searchable when a query admits them.

The shared planner may select a search path only when every OR branch is covered
by a ready declared search definition, the pattern has an extractable mandatory
trigram, and the request's candidate and byte budgets can contain the complete
result set needed for exact filtering, sorting and count. It verifies current
row pointers and applies the existing exact per-field ASCII `LIKE` matcher to
index candidates. That final check preserves the native field and wildcard
semantics even if the index returns false positives. An additional indexed
conjunct may instead bound a short-pattern query. Otherwise the core returns
an explicit capacity refusal; a one- or two-character term, punctuation-only
term, or wildcard-only pattern cannot be advertised as a selective trigram
query. This is a resource limit, not permission to return partial matches.

A local PGlite probe created `pg_trgm` and `btree_gin` and a composite GIN
index over `(scope, definition, folded_text)`. An ordinary-role PostgreSQL 18.3
probe created the same extensions and index. On a 110,000-row table with one
100,000-row shop and 100 `%needle%` hits, the normal planner chose a sequential
scan (109,900 rows rejected, about 8 ms on this local host). Disabling
sequential scans made a GIN bitmap plan visit 100 matching index candidates
(about 5 ms on a temporary-table version of the probe). For `%n%`, even the
forced GIN plan visited all 100,000 rows in that shop before rechecking and
took about 89 ms. On a separate one-million-row hot-shop probe the ordinary
planner selected the composite GIN bitmap path for `%needle%`. These are local
probes, not production benchmarks. They prove that **GIN availability alone
does not enforce bounded reads** and that planner choice changes with scale.
Core therefore admits only patterns with a usable mandatory trigram, caps
complete candidate materialization and statement time, and refuses overflow.
Common trigrams can still require substantial indexed work; measure those and
multi-shop skew before claiming a general performance bound. An explicit
gram-posting table was rejected for this slice because it would write many
postings per text character and requires separate storage-amplification proof.
Extension installation belongs to platform physical migrations. The migration
targets the shared `public` extension schema; an ordinary runtime role uses
preinstalled extensions there. Serving readiness checks the physical GIN path
and fails closed if it is absent or has a different column, operator-class or
predicate contract. Shared binding preparation establishes coverage for an
empty source under its scope lock; populated sources require a separate
backfill transition before activation. Native Product `q` uses the search
candidate set even with the normal active-row predicate, then checks that
predicate on exact current rows. A bounded set of provably unique point lookups takes
precedence over search; other indexed conjuncts remain residuals when a
selective search anchor is available. Among two nonunique anchors the selected
one can still exceed the bounded budget, which is an explicit refusal rather
than a partial result. Multi-filter selectivity belongs in final capacity
measurement.

## Contract, cutover and completion gate

1. Compile the existing `searchableText` capability into a stable generic definition
   binding. Reject unsupported shapes and changed identities. Prepare the
   complete source requirement set and prove empty-source activation plus
   fail-closed populated-source readiness; general conversion/backfill remains
   in the deferred evolution work.
2. Add current-search storage and transactional maintenance with a revision
   tie, scoped candidate selection, complete-result budget, exact residual
   matching and pending-write visibility. Prove rollback, replay, update,
   soft delete, restore, and a second shop with colliding local IDs on PGlite
   and ordinary-role PostgreSQL.
3. Verify the pinned Product fields against its existing compiled DML
   `searchableText` capability. Move the unchanged native `q` plus `withDeleted` witness to the
   logical runner. Test at least a mixed-case term, SQL wildcards, literal
   backslash, short-pattern refusal or an independently selective anchor, and
   over-budget atomic refusal. Keep count and ordering exact.
4. Remove the last legacy Product search runner configuration. The separate
   physical fixture-reset witness remains the named Product legacy consumer;
   complete its profile/installer retirement under [Product closeout](./44-product-module-closeout.md).
   Do not drop a named durable table without its recorded conversion or reset decision.

This breaks private schema/index declarations and the logical relational read
plan where needed; no native public Medusa API or committed identity is silently
rewritten. The accepted shared-storage completion goal authorizes this core
correction and caller migration. The selected native path has two-driver
coverage for matching, update, soft-delete/restore, pending writes, rollback,
replay, scope isolation, readiness refusal and bounded overflow. This is a
bounded capability, not a claim that every term uses GIN or that a hot shop has
measured throughput. Common-trigram selectivity and tenant-skew plans remain
final capacity work.
