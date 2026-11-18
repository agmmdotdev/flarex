# Shared JSON containment index for calculated Pricing

Status: shared core access path implemented under the standing shared-storage
completion goal; native calculated-price acceptance remains open.

## Outcome and owners

The pinned `PriceListRule.value` model declares a nullable JSONB field with an
active-row GIN index. The portable DML compiler retains `type: "gin"`; logical
normalization originally refused it. The earlier four-table Pricing source
therefore could not admit native PriceListRule writes or the representative
calculated-price query. This was a shared index-contract gap, not a Pricing
adapter permission to scan rules or mislabel GIN as an ordered index.

Admit one-column JSON containment declarations in the relational schema and
compile them as source-complete, stable logical index requirements. Core owns a
generic, scope-confined current-entry family and its physical GIN access path,
row-revision tie, transactional maintenance, build/readiness and bounded
selective reads. The native Pricing service retains normalization, rule
matching, price choice, dates, quantities, decimal meaning and events. A query
must recheck exact PostgreSQL JSONB `@>` semantics on current values; index
candidates are never treated as authoritative rows.

The physical family is shared by all logical sources and shops. It does not
create a Medusa table or index per shop. This extends the existing shared
schema binding and settlement owners, not a second migration engine. The
private assumption that all relational indexes are ordered may break. Existing
native Pricing APIs and durable rows are not reset or rewritten by this slice.
An already populated four-table Pricing source cannot silently become a new
six-table source: stable table identities, source admission and any conversion
must pass the structural evolution gate.

## Challenged alternatives

- A whole-table rule scan, a larger query budget or a capped prefix can return
  incomplete calculated prices. Refuse when a complete bounded candidate set
  cannot be established.
- A B-tree encoding of JSON values supports neither native array containment
  nor the declared GIN operator. Do not treat the native index as equality.
- Indexing every historical row's document JSON amplifies all writes and lets
  stale revisions dominate current queries. Maintain only declared current
  JSON fields with the row revision in the same transaction.
- A GIN index alone does not guarantee bounded work. Require an explicit
  candidate, byte and statement budget, fail on overflow, and measure hot-shop
  plans before claiming scale.

An ordinary-role PostgreSQL probe confirmed that JSONB array values contain
both a scalar member and a matching array (`["us","eu"] @> "us"` and
`["us","eu"] @> ["us"]`), and a composite
`(scope_uuid, logical_index_id, value_json jsonb_path_ops)` GIN bitmap path
returned the 10 selective matches in a 10,000-row local probe. These are
operator and plan-shape checks, not production latency evidence.

## Completion gates

1. Reject malformed GIN definitions, other access methods, wrong column type,
   extra columns and unsupported predicates before catalog mutation. Preserve
   the pinned `value` declaration through normalization and requirement
   compilation without changing ordered-index identities.
2. Add the generic physical entry/index and source-complete preparation. An
   ordinary role can use a preinstalled path; serving checks its exact table,
   columns, access method and JSONB operator class. Empty-source readiness is
   locked; populated-source activation needs an explicit backfill or conversion
   gate. Missing, stale or forged coverage refuses.
3. Maintain current entries on insert, update, soft delete, restore and hard
   delete with the row/index/fact transaction. Prove rollback, replay, pending
   visibility and two shops with colliding local IDs on PGlite and ordinary-role
   PostgreSQL. Bound complete candidates and verify exact `@>` residuals.
   A partial index is eligible only when its null predicate is mandatory for
   the query. If a JSON candidate probe overflows, a declared scalar index may
   complete the same conjunctive query within budget; neither bounded path may
   silently truncate the affected set.
4. Admit the required full Pricing source and native PriceList/Rule behavior,
   then compare representative `calculatePrices` results, ordering, exact
   amounts, quantity/time/rule behavior and native errors with the pinned
   repository. Remove displaced refusal and fixture paths in that connected
   cutover. Keep unrelated Pricing operations refused until their contracts
   are proved.
5. Run affected source guards, typechecks, migrations, lint and both required
   read-only reviews before a scoped commit. Measure selectivity and write
   amplification separately from functional correctness.
