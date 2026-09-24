# Unrestricted Text Equality Access

Status: implemented in the connected core and SalesChannel slice under the standing shared-storage approval.

## Failing witness and owner

The pinned native SalesChannel model declares `name: model.text().searchable()` without a length bound. Its physical profile admits a 2,047-character ASCII name. The proposed logical definition adds a whole-name ordered index so name equality remains selective across large shops. The new logical test `accepts a native unrestricted text name through its exact equality read` fails on create: index materialization reports `entryKeyLimitExceeded`, observed 2,049 against a 2,048-byte ordered-key maximum. Relational text validation correctly admits this value. This is a shared index-access limitation, not a Medusa input error.

The current generic-row query requires an admitted index for selective name equality. Removing the index returns to a 128-identity complete-set path and cannot establish large-shop scalability. Truncating names, imposing an adapter-only length limit or hashing only in the adapter would split the core's index and query authority. Raising the ordered-key cap does not solve unbounded text and can exceed PostgreSQL index-key limits.

## Recommended contract

The shared **nonunique exact-text equality** index kind is a logical relational declaration. Its physical requirement uses the existing generic index-entry family with the distinct `sha256TextV1` field projection: a domain-separated SHA-256 digest of complete canonical UTF-8 text. It supports equality membership only; range requests cannot use the digest path. Core build and commit materialization derive the same projection. The query planner derives it from each equality operand, selects bounded candidates, then compares the full stored text before returning or counting rows. Hash collisions may add candidate work but never produce a false match; complete-set overflow refuses rather than truncates. Null and missing values retain their existing distinct encodings. Physical relational-table lowering rejects this logical-only index kind instead of silently producing a different SQL index.

The schema compiler derives this access path for the native SalesChannel name. The existing primary-ID index stays ordered. No per-shop table or index DDL, adapter SQL, second writer, or second publication owner is added. Document-index and native unique-key semantics retain their existing codecs; the nonunique equality path does not change them. The distinct versioned field projection changes the authenticated physical requirement, so an old ordered-name definition cannot be reinterpreted as an equality definition. Any existing installed candidate using the tentative ordered-name definition needs explicit rebuild/reset disposition; this development slice has not converted named durable data.

When a bounded relational result is ordered by text, the reader compares the complete UTF-8 bytes in memory. It does not pass long text through the ordered-key codec. Integer ordering retains that codec. This preserves byte ordering, including supplementary Unicode characters, while allowing a selected long text value to be ordered.

## Connected proof and cleanup

Prove a native-valid long name can be created, selected exactly, counted, updated to another long name and deleted on PGlite and ordinary-role PostgreSQL. Add two different full names that share a long prefix, plus a forced digest-collision unit witness if the digest seam permits it, to show exact post-filtering. Prove bounded selective work for many SalesChannel rows, pending write visibility, replay, rollback and two-shop isolation. Preserve the ID inequality and event-receipt witnesses from the displaced physical fixture. Run protocol/core/adapter typechecks, focused tests, source guard and lint, then both required reviews against the final staged checkpoint. Remove the tentative ordered-name index and displaced physical standalone test in the same coherent commit. Product–SalesChannel Link/workflow remains a separately named physical consumer and removal gate.
