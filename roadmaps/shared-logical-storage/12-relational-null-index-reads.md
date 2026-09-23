# Relational Active-Row Index Reads

Status: implemented connected read-path slice under the shared-storage standing
approval. The native Currency path is the first consumer; this does not admit
Product graph queries or remove the current scope-clock bottleneck.

## Outcome And Evidence

The selected Currency repository compiles ordinary `listCurrencies` and
`listAndCountCurrencies` with a required `deleted_at IS NULL` predicate. Its
logical source already declares an active-row ordered index. The shared
relational reader currently uses the primary-code index's complete range when
there is no finite code selection, then filters inactive rows in memory. Its
identity budget therefore depends on all Currency rows in the scope even when
the requested active set is small. The Product graph also declares partial
indexes, but its runtime remains unadmitted for separate relation/query reasons.

The existing logical index reader already verifies stored entry membership,
includes pending writes, records settlement dependencies, and refuses an
incomplete bounded scan. Reuse that owner. The query compiler may prove a field
is null for every satisfying branch: `and` combines required predicates; `or`
keeps only predicates shared by every branch. A nullable `isNull` test gives the
proof; a nonnullable test is an empty result, not an index-selection claim.

When a declared usable index can bound one required-null field, the working set
selects it. Otherwise it retains the complete primary-key range and its existing
resource refusal. Finite code selections retain point/unique access. Residual
predicates and exact page/count semantics still run on complete native rows;
this is access-path selection, not permission to skip validation or count work.

## Challenged Alternatives And Contracts

Adding a Currency-only active-row cache or a new physical index per deployment
would reproduce a shared owner and conflict with the accepted generic layout.
Scanning the primary index with a higher identity limit would increase resource
cost without making active-row work selective. A fixed `LIMIT` would silently
truncate complete counts. The core planner is the narrow owner because it sees
both the authenticated logical index definitions and the Boolean predicate.

This changes the private compiled relational-read plan and query selection.
There is no public query syntax, durable identity, codec, schema, or data break.
Existing physical Currency consumers have already moved; no second reader or
compatibility fallback is retained. The primary-key access path remains because
it is required for with-deleted and unindexed complete reads, not as a hidden
alternate implementation.

## Proof And Completion Gates

- A focused Boolean witness distinguishes `isNull AND (A OR B)` from
  `isNull OR B`, empty branches, and nonnullable null checks.
- The real Currency source uses its active-row definition on PGlite and
  ordinary-role PostgreSQL. Native selected/with-deleted pages and complete
  counts, pending soft-delete/restore, and out-of-budget refusal retain their
  established results.
- Settlement still validates the exact index membership and source admission.
  No tenant DDL is added. Readiness refusal and a missing usable index retain
  their distinct behavior: unready sources refuse the request, while a ready
  source without a usable null selection retains the bounded primary path.
- Both code reviews, affected typechecks, lint and source guards pass; displaced
  scan-only assumptions are removed with the implementation.

An active-row index limits work to its own membership, but it does not make an
unbounded active set cheap or establish multi-shop throughput. Preserve the
complete-set overflow and measure row/index work before claiming a scale gain.
