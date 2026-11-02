# Closed PostgreSQL predicates over captured Core rows

Status: **Independent source challenge and owner-seam peer reconciliation
complete. The translated Core path, neutral paired database proof and selected
connected native acceptance are verified; required review is complete. Wider
full-goal gates remain open.**

Baseline: `d31c5df21ea79ba63e25dc4e1d9814361396611a`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
This is the shared prerequisite of [complete Pricing maintenance](./21-native-pricing-maintenance-workflows.md).

## Actual requirement and current gap

Pricing `preference-input.ts:72-90` emits PostgreSQL text comparisons, LIKE/ILIKE,
POSIX regex, SIMPLE fulltext, negative membership, existence and recursive Boolean
predicates. The shared compiler intentionally gives SQL leaves no JavaScript
verdict. The baseline Core refused every PostgreSQL program. The replacement
executes the complete program over its captured candidates; an ID-only selector
would drop existing admitted behavior.

The genuine Preference update cases preserve Unicode character LIKE, actual
engine locale differences, NULL and empty-fragment omission, invalid-regex
planning even with no candidates and decisive-Boolean suppression. Shared
contract 68 and preflight 150 own those semantics. Native SQL behavior cannot be
replaced with JavaScript regex/case folding, fulltext copies or per-leaf queries.

## Selected owner translation

The replacement reuses the baseline closed program, immutable batch,
parameterized expression and exact ordinal decoder. Its SQL-free capture and
authentication contract now lives in `values/postgresRelationalPredicate.ts`;
the renderer lives in `database/postgresRelationalPredicate.ts`. Retained working-set,
related-query and finite-capture imports keep their exact catalog bindings.
Core tablet/namespace binding is distinct; do not cast it to `CatalogTableId`.
No compatibility query engine is retained for migrated consumers.

The compiler issues the complete validated tree once. Existing Core candidate
acquisition and pending overlays remain authoritative. Validate all complete
candidate rows, inspect ordering without asking JavaScript to decide SQL leaves,
evaluate the cohort once and select only verdicts equal to true. Preserve order,
window, projection and selected identities. Empty cohorts still execute the tree.
The separate examined-window/page restriction stays closed unless an admitted
caller actually requires and proves it.

Add only the closed native evaluation operation needed by the existing executor.
It runs inside `transaction.nativeOperation` and uses a batch-only persistence
port. Neither framework nor untrusted code receives SQL, a connection, a callback,
raw persistence, a new root or settlement authority. The PostgreSQL implementation
uses the existing drained `driver.query` and exact response decoding. Its SQL
reads only supplied JSON values, never live application tables or latest rows.

## Authority, accounting and failure order

The accepted-direction reader and current-owner reader resolved the following
counterexample: the generic operation/open guard is insufficient for selective
metadata, cached membership, pending-only or empty cohorts.

1. Resolve the actual table through native access and its issued definition.
2. Run source-specific `nativeCapture(table, access)` before every foreign
   statement. Complete actual source/table admission before dynamic PG planning.
3. Prepare/bound/charge the authentic detached batch against that table and the
   existing request owner's remaining bytes; execute and decode the one query.
4. Charge decoded response bytes, then run source-specific metadata capture again
   on success before delivery. Retain the existing final open-state check.

These metadata captures do not reacquire membership, replace first originals or
refresh application values. A SQL/planner/driver/decoding/charging failure retains
its complete original Cause. The post-source guard is success-only, not an
`ensuring`/`onExit` guard that can replace the body failure.

`nativeFind` already observes anchor candidates before the residual. Preserve all
those observations and body uses, including nonmatches; `orderedIdentities` contains
only the actual selected rows. Existing Source prefix/EOF and metadata dependencies
validate committed and accepted unpublished changes at finalization.

Keep one native `lifetime.operation` charge and existing Core read accounting.
Core `databaseQueries` counts coalesced intervals, not SQL statement count. Charge
the program, complete captured payload and decoded reply through the same native
retained-byte owner. Forward that owner's remaining-byte getter alongside its
existing charge callback; no second counter or unconstrained maximum is allowed.
Every `beginNative` caller must forward both from the same owner, including
genuine Worker setup and reverse-read scenarios. A charge-only caller fails
admission before its native operation; migrating only shared fixture construction
does not close those direct call sites.
Preserve the existing 1,048,576-byte predicate envelope cap.

The existing Commerce lifetime maps and latches the complete failure before native
code can catch it. Seal then refuses with the original cause plus rollback-only
state. Add no bespoke framework latch inside portable Core. The existing foreign
query drain, inflight operation, abort/join and original deadline withhold successful
delivery after cancellation or closure. Final OCC/fencing/publication remains the
only business settlement.

## Why the Legacy short transaction is not copied

The old installed/full-artifact `relationalPredicate` path must accept its SQL
authority header before a dynamic regex is planned, then validate its tail. Its
named short transaction remains required for those retained callers.

Core's calculation has already admitted source authority, a private authentic
batch and no live table reads. One guarded, drained query preserves the required
ordering without reproducing Legacy installation/session/header choreography.
This replaces implementation sequence within accepted guarantees; it does not
erase the Legacy rule or start paused finite work. The
[dedicated divergence](../divergences/native-postgres-candidate-predicates.md)
records the native semantic necessity.

## Ownership and executable gates

Predicate production ownership covers the shared program/SQL split, Core query,
native operation/API, persistence port and same-owner resource forwarding. Keep
SQL out of portable Core and preserve named old consumers while moving imports.
Sequence overlapping contracts/database/transaction edits with restoration.

The neutral nullable-text source installs through the real Core schema lifecycle,
writes actual rows and executes the complete read with an active-row plus
PostgreSQL regex predicate. It reproduced the baseline
`CoreQueryInputError.invalidQuery` refusal before production changes. The shared
Core query owner now supplies real rows/count/identities and passes the neutral
contract on both database lanes. Migrated consumers still require their complete
native acceptance. The separate examined-page restriction remains closed.

Then prove normal/Unicode/NULL behavior, empty/missing cohorts, invalid regex and
Boolean suppression, pending entry/exit/deletion, repeated membership, unmatched
observations, bounded bytes and genuine foreign cancellation/drain. Use transport
barriers, not reproduced query logic. Race actual source admission before SQL and
after successful evaluation, including empty/cached/selective metadata controls.
Catch a real predicate failure inside native code and prove final rollback-only
settlement preserves the original error. Both database lanes and genuine native
Preference selectors remain required before connected acceptance.
