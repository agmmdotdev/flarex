# Catalog Restoration During Active Requests

Status: implemented catalog restoration reuse under the standing core-redesign
approval. Complete-request readiness/audit redesign remains open.

## Outcome And Evidence

The active CMS workload in [preflight 27](./27-ce2-active-request-measurement.md)
exposes substantial preparation and acceptance work even for durable replay.
Existing Effect spans attribute repeated schema artifact restoration to the
Application relation-binding and schema-authority owners. A schema resolution
calls the manifest-binding locator, whose bound-root locator already validates
the schema artifact, then reacquires that same artifact itself. Bound-root
restoration also queries stable relations and physical edges for empty ID sets.

This slice removes that redundant acquisition within one restoration. It does
not retain preparation across requests or treat a digest as integrity proof.
The nearest connected proof is the existing active CMS insert/replay workload;
independent relation-binding callers and native readiness use the same owner.

## Contract And Alternatives

- Extend the private located bound-root result with its already validated schema
  artifact. The schema resolver consumes that value and retains its correlation,
  schema decoding and issued-authority checks. The artifact owner still verifies
  canonical bytes, digest and stored JSON on every bound-root restoration.
- Skip only stable-relation/edge lookups whose selected ID list is empty. Retain
  the schema-version relation-binding query, including for zero expected rows:
  that query detects unexpected normalized bindings. Nonempty sets keep exact
  cardinality, identity, canonical bytes and lineage validation.
- Preserve fresh, independent preparation and accepting resolution. Corruption
  between those observations must still be refused. No cache, new readiness
  root, lock change, transaction merge, metadata mutability policy or public
  framework capability is introduced.
- Reject a host-local cache or digest-only shortcut. The broader runtime
  readiness/audit redesign needs the explicit protection and invalidation
  contract required by [runtime scalability](./09-runtime-scalability-redesign.md).
  It is not justified by deleting the checks that currently detect corruption.

## Breaks, Cutover And Cleanup

The internal `LocatedApplicationRelationBinding` result gains required artifact
evidence; its sole producer supplies it. The schema resolver stops exposing the
error branch attributable solely to its redundant artifact read; the bound-root
owner continues to classify artifact read failures through the existing binding
error boundary. No persisted format, data, external API or supported schema
changes. No compatibility wrapper, duplicate decoder or fallback acquisition is
retained. Remove the temporary request-attribution probe after investigation.

## Validation And Completion

The shared PGlite/ordinary-role PostgreSQL witness covers corrupt artifact bytes
and JSON after preparation, restoration and successful fresh acceptance. It
retains the changed manifest-binding and unique-closure cases and verifies one
artifact acquisition per schema resolution through existing spans. Empty and
nonempty relation cases cover missing normalized bindings, corrupted physical
definition bytes, changed stable lineage and unexpected normalized rows under an
empty root. A detached planning copy cannot mutate retained artifact bytes.
Re-run active CMS publication/replay and existing
Payload scalar request/recovery regressions. Compare the same full-request
workload and report SQL reduction separately from noisy timing; this local
change does not complete CE0 attribution, reference equivalence or capacity gates.
Typecheck, lint, both project reviews, owned-resource cleanup and a scoped commit
complete the slice.
