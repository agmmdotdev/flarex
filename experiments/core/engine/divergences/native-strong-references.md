# Native strong-reference integrity

Status: **Selected optional-one extension implemented with connected two-driver
native and ordered-save proof; broader native and performance gates open.**
The [optional-one continuation](../slices/14-native-reference-integrity.md) owns
the selected consumers and retirement boundary. Source pin:
`db914cf06e2b06ee985646611b9e12ed7a770318`.

## Pinned mechanism

The [ID validator](../../../../../../crates/common/src/schemas/validator.rs)
checks the ID's table mapping, without looking up a target row. Ordinary
[document deletion](../../../../../../crates/database/src/transaction.rs)
does not inspect incoming user references. Source supplies exact point/range
dependencies, pending old/new index maintenance and ordered published plus
accepted-unsaved conflict checking, not a generic row foreign-key engine.

Source's [index registry](../../../../../../crates/indexing/src/index_registry.rs)
emits one old/new key per document/index. Optional-one retains this algorithm
using a scalar reverse index. The selected fresh many/join continuation uses
[logical memberships](./native-reference-memberships.md) with the same ordinary
index machinery; that record owns its separate native representation.

## Required native difference

The existing Payload optional-one profile promises target liveness and restrict
deletion at settlement. Its controlled race witness expressly performs no target
body read during assignment. Importing an eager Source point read would introduce
an extra semantic observation and replace native relation errors with conflicts.
The selected joint consumer uses the same native profile, with a trusted audit
insert; it is not ordinary developer Application OCC execution.

Keep the authoritative reference in its source document. Derive reverse keys
through the existing shared ordinary-index lifecycle. Use full authenticated
relation declarations, endpoint identities, scope and index generations, rather
than table names or caller-supplied target IDs as authority.

Extend the existing committer's pure preparation and ordered acceptance: prepare
fresh published liveness/reverse evidence, validate its suffix, fold the complete
accepted-unsaved prefix and candidate final overlay, and preserve actual save
dependencies. Re-prepare invalidated integrity evidence without replaying native
code. Keep client-observed native bodies/membership and first originals separate.
No SQL transaction spans hooks, and no adapter performs its own integrity check.

Apply final source removals before restrict probing. A deleted first fetched
source does not prove absence: continue until another final live reference or
true EOF, recording Source prefix/exhaustion dependencies. Fail closed at the
resource bound. Public page limits cannot certify integrity absence.

## Effects, owners and proof

`core/nativeReferences.ts` owns `prepareCoreNativeReferences` and
`validateCoreNativeReferences`; the existing committer owns suffix refresh,
accepted-prefix folding and contributing save dependencies. `nativePolicy.ts`
authenticates definitions/generations; `transaction.ts` owns reverse reads and
opaque delete evidence. Existing native CMS projection preserves the relation
errors. No adapter checks liveness or repairs a failed shared constraint.
All data/index/outcome changes stay in the same five-table batch and settlement.
No new physical edge table, second reference authority or generic cascade is
introduced. Reverse tokens reuse ordinary source-index invalidation; old
query-sync fact consumers remain named retained outside this fresh migration.

Prove `relationTargetMissing` after a competing target delete and
`relationDeleteRestricted` after a competing assignment; same-root target create,
source detach/delete and retarget; hidden second incoming source; real prior
read conflicts versus unobserved target-only updates; accepted-unsaved target/
source predecessors and failed prerequisite durability; capacity/cancellation,
cold metadata authentication and no callback replay. Pair shared-owner and
genuine Local API/joint witnesses on PGlite and ordinary PostgreSQL separately.

Native Links, owned cross-owner cascades, Product soft-delete/restore/checkpoints,
repeated memberships, populated-many conversion and general developer-UDF
participation retain their separate gates.
Performance and deployed native hosting remain unproved.
