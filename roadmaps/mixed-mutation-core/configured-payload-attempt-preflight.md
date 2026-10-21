# Configured Scalar Payload Collections In Mixed Mutations

## Status And Scope

Status: implemented privately for compiler-owned scalar collections through the
existing mixed root. Public authoring/facades and cross-framework relationship execution
remain pending under the
[developer-contract proposal](../flarexdb-framework-integration/preflight/unified-application-cms-commerce-developer-contract.md).

Extend the existing borrowed Payload create/update/findByID path to compiler-owned
scalar collections. Preserve the ordinary native runtime, authenticated source
and table identities, one Application pending owner and one outer settlement.
The connected [optional-one relationship](./payload-relationships-attempt-preflight.md)
and [delete/preference lifecycle](./payload-delete-preferences-preflight.md)
follow-ups extend these same owners. Find/count, arbitrary hooks, another
execution engine and public/hosted activation remain outside this capability.

## Current Owners And Failing Boundary

- [Collection compiler](../../packages/payload-adapter/src/collections.ts)
  produces exact collection metadata, canonical definitions, content identity and
  write-policy evidence. Direct Payload supports configured scalar collections.
- [Document source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission.ts)
  authenticates the complete source definition/configuration and selected table
  bindings, and prepares table-aware write validation and index/unique mechanics.
- [Borrowed CMS execution](../../packages/persistence-postgres/src/frameworks/cmsTransaction/borrowedLogicalAttempt.ts)
  retains scalar-profile admission without requiring a single table named
  `posts`. Complete source/table authentication remains at its existing owner.
- [Payload participant binding](../../packages/payload-adapter/src/participant/binding.ts)
  selects only create, update and findByID. Method admission remains unchanged.
- [The connected Worker witness](../../packages/flarex-backend/test/mixedMutationConfiguredPayload.workerd.test.ts)
  supplies `articles` and `editor-notes`, then invokes native Product and Payload
  operations from a real Application mutation. Before the correction its first
  Payload create returns `unsupportedProfile` instead of accepting the admitted
  scalar source. The restriction belongs to borrowed CMS execution, not to an
  adapter workaround or the collection compiler.

## Selected Correction And Private Breaks

Keep the scalar-profile refusal and remove the borrowed owner's collection-name
and single-table restriction. Existing exact source admission, table-aware input
decoding/validation, prepared write mechanics, budgets, pending state, native
operation lifecycle and final publication remain authoritative. Unsupported
profiles/collections/methods still fail closed. Do not replace the check with a
second collection validator or add SQL/independent settlement in the adapter.

The existing test fixture accepts compiler input only for ordinary native Payload
construction; fixed conformance profiles retain their declared collections.
Its ordinary participant identity describes compiled scalar execution rather
than the displaced fixed `posts` fixture. Exact content/configuration evidence
continues to bind the selected source. Custom Application source is retained by
the fixture for genuine whole-root retry as well as initial execution.

This changes private isolated-test selection, not a public or durable wire
contract. No platform schema, retained row, journal format or named environment
is reset or reinterpreted. Existing `posts` conformance and ordinary consumers
remain regressions. The active Medusa module/workflow integration is untouched.

## Implemented Contract And Continuing Limits

- Two differently shaped scalar collections, neither named `posts`, must support
  native defaults/nullability, pending create/update/read and collection-scoped
  identity/uniqueness inside an Application/Product root.
- No business rows/outcome/events publish before outer settlement. Success
  publishes once; replay does not re-execute native operations. Late failures
  leave Application, Product and both collections uncommitted.
- Prove wrong-collection IDs, unconfigured collections and unselected methods
  refuse without widening lifecycle authority. Pre-admission method refusal
  executes no borrower; failures within admitted work retain sticky root failure.
  Preserve existing fixed-hook,
  cancellation, stale-authority, retry and unknown-COMMIT coverage; exercise the
  configured path where its source/table expansion affects those contracts.
- Validate PGlite and ordinary-role PostgreSQL separately through the real
  Worker boundary, plus affected owner/consumer regressions. Use the installed
  Pingdotgg `tsc-rs` checker for affected package typechecks, required lint/source
  guards and both read-only reviewers. Retire the fixed-name restriction and
  update capability status with the completed consumer cutover.

Performance optimization remains paused; this capability slice establishes no
native-relative latency/CPU or production-scale acceptance. Public API selection
and the shared-storage strong-reference gate keep their separate sequencing.
