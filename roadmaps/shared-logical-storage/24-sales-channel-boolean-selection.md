# Indexed SalesChannel Boolean Selection

Status: implemented under the standing shared-storage completion goal.

## Preflight And Decision

The selected native SalesChannel repository accepts `is_disabled: true` or
`false`, but `compileLogicalRelationalRead` treats every Boolean equality as an
unindexed complete-set read. A shop with more unrelated channels than the
logical identity budget can therefore fail a selective disabled-channel read.
The native model does not declare an index on this field. Shared logical index
definitions, key encoding, builds, pending membership and settlement already
support Boolean values; only relational query selection and this source's
declaration are missing.

Add a derived single-column B-tree index to the SalesChannel logical source and
teach the shared relational planner to select declared Boolean equality prefixes
without converting Boolean values to strings. Keep unindexed Boolean filters on
the existing bounded complete-set path. The core owns index membership and
read validation; the Medusa adapter only declares the access path. This is a
single connected core-and-native query capability, not a new query engine or
special SalesChannel SQL. It advances the selective shared-query acceptance
gate and the already migrated native SalesChannel consumer.

The private source definition hash changes. Existing selected development
fixtures are rebuilt from the new definition; this slice does not migrate or
reset any named durable environment. Admitting the new source over populated
data requires the deferred structural evolution policy. Native method shapes,
result values and errors do not change. The old complete-set Boolean selection
remains only for sources with no admitted Boolean index, with its resource bound.

## Proof And Cleanup

Show the planner chooses Boolean keys only when declared, including a mixed
Boolean OR branch, and keeps exact type checking. Through native SalesChannel
create/update/list/count, put more unrelated rows in the shop than a bounded
complete scan admits; show a selective `is_disabled: true` read uses shared
index entries, returns exact rows/count, tracks updates and soft deletion, and
does not add physical tables. Run PGlite and ordinary-role PostgreSQL, affected
typechecks, source guards, lint and both required read-only reviews. Remove
the outdated complete-set-only status once the witnesses pass. Do not claim
that a low-selectivity Boolean query or exact count of a huge match set has
constant work or that this proves production-scale capacity.
