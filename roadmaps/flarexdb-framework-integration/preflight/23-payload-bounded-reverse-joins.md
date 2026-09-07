# Payload Bounded Reverse Joins

## Status And Recommendation

Status: researched implementation proposal; capability approval pending.
The [fresh many profile](./22-payload-many-installation-and-migration-boundary.md)
is implemented. Payload join fields remain disabled in executable profiles.

Recommend one private capability: actual Payload standalone `findByID` and
`find` return bounded virtual reverse fields for both optional-one and many
references, with identities at depth zero and source documents at depth one.
Include the CMS relation-read capability, exact configuration/binding, adapter
response shaping and both-driver consumer proof in the same implementation.
Do not split these into successive research gates.

This closes the remaining bounded reverse-consumer gap in the
[non-reactive Payload relation milestone](./05-core-first-three-lane-readiness.md#payload-native-onemany-relations).
The intended outcome remains a shared Flarex core proven by Payload and Medusa.
After this proof, reconcile that milestone and select the first actual Medusa
service conformance capability under its existing gates. General Payload join
parity and an existing-installation migration host are not prerequisites without
a recorded supported obligation.

## Evidence And Design Challenges

Payload is installed at `3.88.0`; its recorded source revision is
`fea6f8a47a50ff1330d8a5071b43e7dcffb97b22`. The installed distribution and these
pinned sources govern implementation; current documentation explains the model.

| Source | Finding and consequence |
| --- | --- |
| [Payload join documentation](https://payloadcms.com/docs/fields/join) | Joins expose reverse relationships as virtual fields. Results contain `docs` and `hasNextPage`; totals require counting. Do not store a second reverse array. |
| [Pinned join sanitation](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/config/sanitizeJoinField.ts) | Resolves the forward field, marks it indexed when necessary, and derives join metadata. `orderable` can introduce ordering machinery. Inspect sanitized configuration, not only the handwritten field list. |
| [Pinned join query sanitation](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/database/sanitizeJoinQuery.ts) | Runs joined-collection access and combines query constraints. Keep real access execution with the closed fixed policies; refuse unadmitted predicates rather than discarding them. |
| [Pinned Drizzle traversal](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/drizzle/src/find/traverseFields.ts) | The adapter fetches join identities; nonzero limits use lookahead and counting is separate. Flarex can port that result contract over native edges without importing Payload relational storage or SQL traversal. |
| [Pinned relationship population](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/fields/hooks/afterRead/relationshipPopulationPromise.ts) | Populates `join.docs` through the request loader and mutates result slots. Return owned arrays/objects, never canonical CMS cache objects. |
| [Pinned loader](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/collections/dataloader.ts) | Its internal identity batch invokes `payload.find` without automatically disabling joins. Reusing the forward loader unchanged could expand reverse reads at the depth boundary. |
| `src/cmsTransaction/host.ts`, `admission.ts`, `documents.ts` in `packages/persistence-postgres` | Standalone reads hold the scope-clock share lock and authenticate combined binding. The document port has point/batch/scan reads but no incoming-relation operation. |
| `src/applicationRelationRead/Repository.ts` | Existing preparation, resolution and in-transaction validation authenticate selected relation definitions against active selection, readiness, scope and fences. Reuse these owners. |
| `src/appRelationEdges/Repository.ts`, `readIncomingAppRelationEdgePageInTransactionEffect` | Existing indexed window returns identities, adjacency versions, lookahead/exhaustion and inspected-row accounting in a supplied transaction. Order is source row bytes then duplicate ordinal. |
| `src/applicationQuerySnapshot.ts`, `readRelationInTransaction` | Existing Application query composition validates its own snapshot and relation capability. It is a reference for validation, not a second snapshot to open during a CMS read. |

[Convex index reads](https://docs.convex.dev/database/reading-data/indexes/)
bind ordering and bounded retrieval to the selected index. Preserve that
principle and explicit transaction consistency. Native Flarex reverse-edge
identity windows and Payload virtual join envelopes are deliberate Flarex
extensions, not claims of a Convex join API or reactive query support.

The rejected shortcuts are significant: a posts scan duplicates native relation
query logic; a second connection separates edge and row visibility; stored
reverse arrays create another write owner; sorting a truncated native window
cannot establish a globally sorted first page; and one window cannot establish
`totalDocs`. None is needed for the proposed capability.

## Exact Private Profile

Introduce `payload.content-joins` as a fresh-only configuration profile. Retain
the exact bytes and decoder meanings of the scalar, optional-one and fresh-many
profiles. Its stored posts fields and two native relations match fresh-many.
Add strictly decoded virtual join declarations to this profile's canonical
configuration, separately from stored document fields:

| Virtual field | Source collection and field | Meaning |
| --- | --- | --- |
| `referencedBy` | `posts.relatedPost` | Posts whose optional-one reference points to this post. |
| `referencedByMany` | `posts.relatedPosts` | Posts whose many array contains this post. |

Both are top-level, nonlocalized, monomorphic, non-orderable and read-only.
Neither adds a stored validator field, third native relation, edge definition,
inverse write, index DDL or lifecycle table. Native inverse names remain as
declared by the existing physical profile. Payload's sanitizer-added index hint
is fulfilled by native relation indexing; it is not authority to run DDL.
The sanitized configuration must contain only the expected metadata changes.

New configuration/write-policy identities must enter ordinary fresh ownership,
readiness, activation and exact combined content/preference binding. No blanket
same-owner successor exception. A virtual-only schema difference still changes
authenticated behavior; retained installations cannot silently acquire it.
An upgrade path is deferred alongside the existing conversion boundary.

## Query And Response Contract

| Dimension | Proposed contract |
| --- | --- |
| Entry | Existing standalone `findByID` and `find`, depth 0 or 1, on the new profile. Root CRUD/query semantics remain unchanged. |
| Selection | Omitted `joins` enables both fixed fields; `joins: false` disables both. A known field may be `false` or an object containing only admitted options. Unknown fields fail before Payload execution. |
| Window | Per enabled field, default limit 8, integer limits 1 through 16, page omitted or exactly 1. Count omitted or false. Refuse zero, later pages, cursors, sort, where, arbitrary projections and malformed values. |
| Output | `{ docs: [...], hasNextPage: boolean }`. No `totalDocs`, total pages or invented continuation token. Empty window is `docs: []` and `hasNextPage: false`. Disabled virtual fields are omitted. |
| Ordering | Preserve native ascending source-row identity order. Forward array positions do not order incoming sources. No promise of lexicographic encoded-ID, title or creation-time order. |
| Depth | Root depth 0 returns canonical source IDs. Root depth 1 populates one source-document hop; stored forward fields in those documents stay IDs/null/arrays. Their virtual join fields are omitted at the boundary. |
| Write requests | Reverse reads are unavailable in creates, updates, deletes and nested commands. Reject virtual input fields before normalization. Suppress virtual fields in write responses; existing forward depth-zero behavior remains. |
| Access | Run the pinned fixed collection access policies with `overrideAccess: false`. Dynamic policies, access-derived predicates and access-filtered completeness remain outside this profile. |

Native order is an explicit private adapter constraint. The scalar collection's
`defaultSort: id` does not prove an encoded-ID order for native reverse windows.
Keep root sorting separate, leave join defaultSort unset, reject caller join
sorting, and test the emitted native order. Do not reinterpret any nonempty
sanitized sort or filter as an accepted native query.

First-window `hasNextPage` reports that more sources exist; it does not promise
that this private profile supports navigating them. A later pagination contract
must reconcile Payload page numbers with native bounded continuation explicitly.

## Ownership And Execution Flow

```text
exact profile / active selection / combined binding
  -> existing CMS standalone read + scope-clock share lock
  -> request-lifetime-bound incoming-source capability
  -> authenticated relation definition + native indexed edge window
  -> owned virtual identity envelopes on root documents
  -> pinned Payload afterRead / request loader
  -> existing CMS getMany on the same transaction
  -> bounded depth-one result / request cleanup
```

Add a narrow CMS relation-read owner and command-context capability. It accepts
only the live request context/transaction identity, a fixed admitted source
reference, target posts ID and bounded limit. Derive scope, table IDs, physical
definition and transaction internally; never accept them from Payload arguments.

Prepare native relation-read capabilities from the same Application selection
used for CMS admission, using the existing read port and exact composition.
Validate them again inside the admitted transaction against its scope clock and
selection before reading. Require live admission and standalone root-read
authority on every call. A command-context Boolean alone cannot issue authority;
the host/lifetime owner must enforce it, including nested calls under a read root.

Read edges through the existing native repository on `CmsAdmission`'s transaction.
Require equal before/after adjacency versions, neither ahead of the admitted
clock, and retain the repository's corruption/provenance checks. Authenticate
target table identity and the root's existence; map source rows to canonical
source-table IDs. A returned source missing from the same admitted document read
is corruption, not a successful fallback to an ID. Do not add pending-edge
overlays, OCC dependencies, snapshot retries or a second commit owner.

The existing share lock excludes participating publication for the whole
root/edge/population read. Retarget/delete races therefore observe one coherent
before or after state. Preserve lock ownership, timeout, cancellation and
request disposal. Failed or interrupted reads publish nothing; next requests
must acquire normally. Changed selection/binding/fence and retained authority
used after close fail closed.

Extend the existing request population ledger to register virtual references
alongside forward references before fetching populated documents. The pinned
loader's authenticated internal batch must suppress reverse expansion and omit
virtual fields at the frontier even though Payload regenerates join arguments.
This internal suppression must not admit caller `id.in`, unbounded limits or
foreign request objects. Do not solve it by globally disabling hooks/access.

## Resource And Failure Contract

- Keep 32 root rows, two virtual fields, at most 16 identities per window and
  one native lookahead row per window: at most 64 windows and 1,088 inspected
  edge rows per root request. Charge work before each query and include native
  inspected-row accounting. Do not scan to exhaustion to calculate totals.
- Keep the existing aggregate 32 distinct population targets across forward and
  reverse fields, including repeated sources across roots. Depth-zero join
  output still has occurrence/byte limits even though it does not load sources.
- Bound reference allocation by 2,080 occurrences: 32 roots times the existing
  33 forward references plus 32 reverse references. Repeated populated document
  copies each count against the existing 1 MiB command/output budget. Retain
  document, loaded-identity, operation and timeout limits; smaller effective
  requests are expected when those independent limits bind first.
- Serialize database work through the existing request/session boundary. Payload
  loader concurrency does not authorize concurrent use of a transaction or a
  process-global result cache.
- Preserve typed input/profile, authority/binding, limit, corruption and storage
  failures. No null/empty success on unsupported requests, no truncated success
  when the overall budget is exceeded, and no retry after admission closes.

## Implementation Boundaries And Completion

| Owner | Classification and work |
| --- | --- |
| Analysis configuration / compatibility | **Port** strict virtual metadata into a fourth explicit profile; preserve two native declarations and old profiles. |
| CMS admission / host / lifetime / new relation-read module | **Port** existing authenticated native read capabilities into one standalone CMS read context. This is the material capability boundary proposed for approval. |
| Private Payload contract / profile / runtime / adapter / population | **Port** the fixed join envelope, sanitation, input refusal, loader frontier and aggregate accounting. |
| Native relation read / edge repository / scope-clock transaction owner | **Keep** existing readiness, validation, paging, SQL, lock and failure contracts. A discovered defect requires the owning boundary decision. |
| Native commit / ownership successor / migration coordinator | **Keep** mutation and migration authority unchanged. |
| Existing profile fixtures and lanes | **Keep** old meaning and reuse the file-scoped database lifecycle and shared two-driver scenarios. No legacy path or temporary bridge is required. |

Completion must exercise actual pinned Payload operations, not manually assembled
join results:

1. Pure exact-profile and query tests cover old digests, sanitized metadata,
   unsupported options, virtual writes, fresh-only admission and all aggregate
   accounting. Verify no virtual field enters stored documents or native DDL.
2. One shared populated scenario covers both join fields, depth 0/1, no sources,
   one source, full window and lookahead, disabled fields, self-reference,
   multiple roots and shared sources. Verify native source order, reorder versus
   retarget/clear/delete behavior, no totals and no recursive expansion.
3. Observe native query shape/limits and loader batches. Test combined
   forward/reverse target and output limits without oversized index keys or
   enlarged budgets. Test missing sources, wrong-table targets, forged context,
   stale binding/fence and closed/nested/write-context refusal.
4. Ordinary-role PostgreSQL proves read-versus-retarget/delete in both lock
   orderings and interruption releasing the session. PGlite proves functional
   parity and retained file reopen; both rebuild exact runtime/binding admission.
   Do not claim a PostgreSQL server restart, hosted or live-sync proof.
5. Use one shared consumer scenario and existing fixture lifecycle per driver,
   pure tests without a database and manifest-owned focused lanes. Run affected
   Application/old Payload preservation once, bounded typecheck and required
   lint/reviewer gates. Add no per-case database bootstrap or broad compiler run.

On completion, reconcile this record, the three-lane plan, Payload adoption and
capability map against observed behavior. The bounded non-reactive relation
milestone may then close if its declared guarantees pass; broader pagination,
dynamic access, upgrades, public packages, hosted operation and production remain
separate. Medusa promotion still requires its own service/conformance approval.
