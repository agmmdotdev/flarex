# Payload consumer baseline

Status: **Private bounded profiles inspected; validation not rerun**.
The executing integration is `@flarex/payload-adapter` with genuine
`payload@3.88.0`. Native provenance is recorded in
[contract.ts](../../../../packages/payload-adapter/src/contract.ts); npm artifact
identity and the recorded Git release identity are distinct facts.

## Executing profiles

| Profile | Supported entry boundary |
| --- | --- |
| Direct command | [runtime.bind](../../../../packages/payload-adapter/src/runtime.ts) and [direct binding](../../../../packages/payload-adapter/src/direct/binding.ts): create, update, delete, find, findByID and count through native Local API. |
| Direct read | `bindRead`: find, findByID and count. |
| Borrowed Application participant | [bindPayloadParticipant](../../../../packages/payload-adapter/src/participant/binding.ts): payload-create, payload-update, payload-delete and payload-findByID only. |
| Borrowed CMS configuration | [CMS owner](../../../../packages/persistence-postgres/src/frameworks/cmsTransaction/): payload.scalar and payload.content-relations; delete additionally requires the finite-root/preference-cleanup contract. |
| Private reference extensions | Existing private reference-read/save/reverse-page consumers preserve protected source access, Product retrieval/assignment and bounded reverse discovery. They do not enable general target population. |

The native chain is binding -> [makePayloadOperations](../../../../packages/payload-adapter/src/operations.ts)
-> genuine Local API -> [database adapter](../../../../packages/payload-adapter/src/adapter.ts)
-> CMS document/relation/preference capabilities -> trusted outer publication.
Operations use `overrideAccess: false`, fresh outer request/dataloader state and
same-request nesting. The adapter owns no raw database or independent settlement.

## Admitted content behavior

- Compiler-owned scalar collections with bounded text, number, checkbox and
  date fields; defaults, native validation, managed timestamps, selected
  nullability/uniqueness and configured multi-collection CRUD.
- Ordinary scalar/compound indexes with admitted equality prefixes and numeric
  ranges, native ID pagination order and bounded exact counts.
- One admitted optional monomorphic relationship with bounded depth-one forward
  population and detached mutable results.
- Fresh-install `payload.content-many`: ordered relatedPosts, at most 32 targets,
  omission/preserve/clear behavior and duplicate refusal.
- Fresh-install `payload.content-joins`: referencedBy/referencedByMany, depth one,
  first window only, default 8/maximum 16, without exact total count.
- Exact internal payload-preferences cleanup during delete and atomic facts.
- Selected private cross-framework reference authorization, integrity and recovery.

These are separately admitted profiles. Their union is not one generic request
shape. The canonical [release capability map](../../../../roadmaps/flarexdb-framework-integration/preflight/payload-release-capability-map.json)
contains native source inventory, historical firstProfile and later private
evidence. Read its sections by status, alongside the executing contracts and
[adoption owner](../../../../roadmaps/flarexdb-framework-integration/07-payload-adoption.md).

## Refusals and pending capability

Globals, drafts, versions, jobs, general migrations/schema generation,
findDistinct, updateMany, ordinary deleteMany and upsert fail through the
unsupported adapter path. deleteMany has only the exact internal preference
cleanup exception. Caller-selected IDs, numeric transaction IDs and unsupported
request/locale/select/sort/paging/query/field forms remain refused.

The admitted query grammar is equality plus bounded numeric comparisons over
selected ID, unique and indexed fields. The native operator list is broader.
Admin/public ctx.cms/production routing, general auth/uploads/blocks/arrays,
arbitrary hooks/remote effects, broad relation parity and populated-data
conversion remain outside these existing profiles. Native construction currently
uses Node integration; private RPC/Node tests do not prove native execution in a DO.

## Concrete validation and identity owners

Use the six [adapter test files](../../../../packages/payload-adapter/test/), the
48 files under [Payload persistence integration](../../../../packages/persistence-postgres/test/integration/payload/),
CMS lifecycle/concurrency/publication tests and the
[mixed participant test](../../../../packages/executor/test/integration/mixedMutationPayloadAttempt.test.ts).
Those are file counts, including fixtures and wrappers. Private reference
consumers and their existing backend Workerd tests retain their own connected
obligations. PGlite, ordinary-role PostgreSQL and actual host proofs stay separate.

At the inspection checkpoint, SHA-256 of sorted UTF-8 lines
`<slash-normalized relative path> <raw-file sha256>\n` was:

| Source set | Files | Manifest SHA-256 |
| --- | ---: | --- |
| packages/payload-adapter/src | 30 | `f6d3fe3eab577db8350e22688564c6948651a84b188a4a796b85566158081a97` |
| packages/payload-adapter/test | 6 | `503d616d86d7ccbd5174f771497fafc2e00bb9c900179e59d5a1f80e9e21b126` |
| packages/persistence-postgres/test/integration/payload | 48 | `404df27e5e4a53d90959030f1017580e0f23de318dbf2490009f03b6971583e3` |

These identify bounded source sets, not a complete transitive runtime closure
or a test receipt. The direct/participant/runtime and borrowed CMS files were
status-dirty but showed no semantic diff during inspection; preserve and recheck
their working bytes before assigning edits.
