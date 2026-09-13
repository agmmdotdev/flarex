# Single-Pass Application Manifest Verification

Status: proposed; shared Analysis owner correction awaits specific approval.

## Outcome And Evidence

Remove duplicate whole-manifest canonicalization inside the existing
`verifyApplicationManifestWithRelations` owner in
`packages/analysis/src/applicationAnalysisV2.ts`. The nearest end-to-end proof
is the actual preference-enabled Payload Local API operation matrix on
ordinary-role PostgreSQL. This is not a Payload adapter optimization or a
change to authoritative database acceptance.

The shared verifier currently calls `canonicalizeApplicationManifest(value)`
to obtain a version-discriminated result. For V2 it then canonicalizes that
owned result again; for V3 it passes the owned result to
`verifyApplicationManifestV3`, which canonicalizes again before authenticating
write-policy references. Both branches repeat capture, validation, bounded
canonical encoding and byte allocation within one verifier invocation.

The retained fixed-document CPU diagnostic described in
[preflight 69](./69-located-transaction-static-drizzle-metadata.md) identifies
manifest canonicalization as a material synchronous stack alongside SQL
construction. Its inclusive samples overlap and predate the static Drizzle
metadata correction. Only part of that stack is duplicate work: neither the
sample nor the source finding establishes the eventual request-time saving.
Numerical attribution and benchmark receipts belong in Git, not this status
record. The current implementation must be the next frozen comparison baseline.

The [accepted database design](../../../design-notes/flarex-db-accepted-design.md)
and [package boundaries](../../16-package-boundaries.md) retain Analysis as the
manifest contract owner and Postgres as committed-state authority. Persistence
consumers must continue obtaining and validating fresh authoritative evidence.
No SQL call reduction is expected from this proposal.

## Proposed Change And Boundaries

Reuse the existing private `manifestVersion(value)` discriminator, then invoke
the existing version-specific canonicalizer/verifier directly on the original
input. Its own-data-property inspection must continue refusing unsupported,
missing, inherited and accessor versions without executing getters, with its
existing trap-error mapping. Do not introduce another discriminator or cast a
union result merely to narrow its correlated manifest and bytes.

- V2: call `canonicalizeApplicationManifestV2(value)` once.
- V3: call `verifyApplicationManifestV3(value)` once. That owner still
  canonicalizes, verifies provenance/configuration/table/policy-set hashes and
  returns its owned canonical result.
- V1: retain canonicalization before the existing version refusal. An early
  version-only rejection would change which error wins for a malformed or
  oversized V1 input and is not approved by this proposal.

Preserve the named Effect boundary, result/error/environment contracts,
validation and first-failure order, defensive byte copies, deep ownership,
strict field capture, canonical text/bytes, size/depth bounds and policy
authentication. No new trusted-input public API or unchecked fast path is
needed. The proposed runtime owner is the shared Analysis dispatcher; tests
remain with Analysis and the existing connected consumer harnesses.

### Retain, Replace, Delete And Defer

- Retain: all version-specific canonicalizers, the general union canonicalizer
  for its existing callers, policy verification and its own input boundary,
  current persistence reads, locks, readiness and integrity acceptance,
  transaction lifetimes and settlement.
- Replace: the dispatcher's canonicalize-then-canonicalize sequence with safe
  version dispatch followed by the existing complete version-specific owner.
- Delete: only the redundant pass in that dispatcher and temporary diagnostic
  instrumentation after validation. No parallel compatibility implementation
  remains in runtime code.
- Defer: broader policy-decoder or canonical JSON changes, prepared SQL/query
  caching, catalog/authority caching, installer-history work, query batching,
  dependency upgrades and adapter changes.

Removing validation or introducing a cache is not an alternative to this
correction. General codec redesign affects more contracts than the measured
duplication requires. There is no proposed schema migration, identity change,
public API change, deployment activation or expansion of Payload capabilities.

## Validation And Completion Gates

Add focused tests at the shared dispatch boundary using existing real manifest
fixture owners. Compare V2/V3 results with their authoritative version-specific
owners, including identical canonical text/bytes, frozen owned values,
caller-input isolation and detached byte access. Establish deterministic
evidence that the redundant canonicalization no longer runs; do not substitute
source-layout matching for a behavioral witness.

Retain and extend refusals for valid/malformed/oversized V1, invalid versions,
accessors and proxy traps, strict unknown fields, malformed relations,
size/depth bounds and invalid policy hashes. Preserve first-error provenance;
do not catch defects or interruption as ordinary contract failures. The
proposal does not remove independent policy verification inside the V3 owner.

Run Analysis tests/typechecking, affected persistence and Payload typechecks,
and focused consumers of this verifier: schema admission/readiness, fresh
catalog-integrity refusal, publication/materialization and recovery. Exercise
the relevant PGlite and ordinary-role PostgreSQL lanes separately. Reuse the
existing CMS, preference-enabled and combined-command proofs proportionally;
do not copy their authority logic into a new benchmark fixture.

Compare frozen current source and candidate using the unchanged opt-in actual
Payload Local API matrix, with serialized baseline/candidate/candidate/baseline
ordinary-role PostgreSQL runs. Report untraced request medians/tails and SQL
counts separately from CPU samples and construction. Retain the candidate only
if complete-request measurements demonstrate a reproducible useful improvement
without a material unexplained regression. Withdraw it if the gate fails.

After implementation, run core/diff lint and both project reviewers against the
exact owned checkpoint, then staged lint before a scoped commit. Reconcile
status with the measured outcome, remove owned temporary diagnostics and stop
owned runtime resources. Preserve the parallel Medusa/installer work and
serialize heavy validation with its owner. Passing local tests do not establish
deployed latency, arbitrary Payload compatibility or production readiness.
