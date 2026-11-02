# Declared native equality indexes through ordinary Source indexes

Status: **Shared correction implemented after independent current/design/Convex
challenge and actual neutral PGlite RED. Paired owner, schema and authentic
producer proof, complete native-consumer coverage and connected regressions are
complete. Populated transitions and wider hosting/performance gates remain open.**

Baseline: `a0df230bf05d09a70ebb25a61464d32b0b4ac2c3`.
Convex: `db914cf06e2b06ee985646611b9e12ed7a770318`.
This is the shared prerequisite of the complete
[Inventory continuation](./20-native-inventory-maintenance-workflows.md).

## Actual mismatch and independent findings

Inventory `modules/inventory/schema.ts:47-49` declares unconditional
`reservation-item.line-item-equality` over nullable `line_item_id`. Its genuine
`modules/inventory/reservation-line-item-repository.ts` consumes active and deleted
history. Before correction, `nativeRelationalSchema.ts:64` skipped `textEquality`, while protocol
`relational-schema/access.ts:12-16` treats it as covered and suppresses reverse
derivation. An active-only path cannot replace complete history. The actual
neutral PGlite owner witness reproduces the omission: two matching active/deleted
rows exceed an eight-identity capture because ten unrelated and ten null rows
enter the fallback. The bound stays unchanged. Authentic neutral and three real
producer metadata frames are captured before correction for stored-proof checks.

Current-core, accepted-direction and pinned-source readers independently checked
the omission, then exchanged counterexamples. Protocol `policy.ts:878-880`
already restricts this declaration to one unconditional local text column;
nullable values are admitted. Sales Channel `name-equality` and ShippingProfile
`type-equality` are real affected producers used by Native18/19. Store is a later
retained producer, not newly activated support.

| Pinned owner | Mechanism to retain |
| --- | --- |
| `common/src/index.rs:99-142`, `common/src/document.rs:507-516`, `value/src/sorting.rs:308-310,374-381` | Ordinary field indexes, document-ID tie-breaking and distinct null/missing encoding. Native nullable fields remain required values; missing does not become null. |
| `database/src/transaction_index.rs:246-325`, `query/index_range.rs:210-261`, `reads.rs:167-191` | Pending replacement/tombstone merge and consumed-prefix/EOF dependencies. Returned IDs alone do not prove absence or complete history. |
| `database/src/committer.rs:915-1045` and existing schema/index owners | Published and accepted-unsaved validation, logical install/build/readiness and ordinary index persistence. No new query algorithm or callback replay. |
| `postgres/src/sql.rs:257-263`, `postgres/src/lib.rs:515-617` | The same five physical tables and fenced persistence transaction. No physical Inventory index family. |

Relevant pinned transaction/PostgreSQL test bodies are unavailable; helper
scaffolding is not runtime proof. The neutral and genuine local witnesses supply
the required implementation evidence.

## Selected translation and counterexamples

Process declared equality in a late pass after existing key/B-tree/FK/reverse
paths. Merely unskipping the first declaration loop can rename a later existing
B-tree/FK path through exact-field name reuse. Preserve existing descriptors and
relative order first. Reuse only an exact field tuple's physical name; otherwise
emit the ordinary one-field index. Retain authentic native IDs. Do not alias
only a leading prefix, introduce a predicate/null filter, or add uniqueness/FK
semantics. JSON containment and native range/search restrictions stay unchanged.

Fail closed when the same kind/native ID already indexes different fields: an
authentic declaration may use `foreign-key/<id>` on `note` while the FK path
indexes `lookup`, or `key-reverse/right` on another field. Exact duplicate
coverage must not create ambiguous metadata entries.

Preserve existing hash framing. Enhanced definitions include lowered schema;
flat definitions may keep `definitionHash` while metadata and bundle schema
change. Compare actual affected bytes, reject old omitted-index installed proofs
and preserve unaffected Currency identity/metadata. Do not add a compatibility
version, assume universal hash changes, reset data or claim populated conversion.

The [declared equality record](../divergences/native-declared-equality-indexes.md)
links this correction to the existing ordinary native query/index adaptation.

## Ownership and proof gates

- Shared worker: only `packages/persistence-postgres/src/core/nativeRelationalSchema.ts`,
  after the actual neutral RED. No other owner or unrelated edits.
- Proof worker: new `nativeDeclaredEqualityIndexScenario.ts`, driver entries,
  `nativeDeclaredEqualitySchema.test.ts` and authentic pre-correction metadata
  under `packages/persistence-postgres/test/core/`.
- Fixture/consumer workers: the explicit Native20 map, using existing owners.
- Root: documentation/provenance, serial validation/resources, both independent
  project reviews, exact integration and the scoped commit.

Use a nullable lookup, single-column primary ID and no FK/composite key able to
infer access. Matching active/deleted history fits the unchanged read bound;
unrelated history/null rows exceed it. Run the actual owner witness before
production edits and retain its RED receipt; a mocked plan or shape assertion
does not substitute for execution.

Cover duplicates, null/absence distinctions, alias/order/collision, pending
insert/move/delete, negative/EOF observations, relevant published/accepted-unsaved
changes versus unrelated changes, cold reopen and old-proof refusal. Check real
Inventory/SalesChannel/ShippingProfile declarations and unaffected Currency bytes.
Source indexes do not add reservation business constraints or native methods.

Then run complete Line Item history/overflow/deleted-only inverse cases, all
eleven Inventory suites, affected Native18/19 consumers and connected owners on
PGlite and ordinary-role PostgreSQL. Source/promotion/portability, Oxc fast checks,
core/diff/exact-index lint and both required reviewers remain cutover gates.
Stop owned resources. Wider hosting, retained data and performance remain open.
