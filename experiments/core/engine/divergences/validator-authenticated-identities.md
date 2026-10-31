# Validator identity generations for retained Cloudflare artifacts

Status: **Implemented for current CoreProgram identities; external/native cutover gated**.
Owning slice: [source validator translation](../slices/09-source-validator-wire-parity.md).

## Why the source mechanism cannot be used directly

Pinned Convex `ValidatorJson` uses source record wrappers and `DocumentSchema`
normalization. Those mechanisms are the fresh destination. Flarex also has
Cloudflare managed-artifact manifest/publication/target/authority byte contracts
and immutable program/head/request identities, which have no identical Convex
wire envelope. Existing private record encoding is already committed into those
hashes. Replacing its projector while re-reading retained programs would change
authentication and can prevent outcome recovery despite successfully decoding an
old shape. The historical appDocument definition version 1 is separately frozen
as object-only by the accepted design.

This is an identity/host adaptation, not permission to retain the old source
parser, private fresh record grammar or a second transaction engine.

## Replacement

Fresh authenticated projections carry `validatorIdentityEncoding: 2`, independent
of manifest feature versions 1/2/3. The marker participates in manifest, schema,
catalog, function-entry and runtime-target canonical bytes; existing digest
chains bind publication and mutation authorities. Fresh program metadata has a
closed current envelope and stores its wire metadata as JSON strings, matching
the source distinction between validator declarations and general value objects.
Convex source schema JSON/content hashes remain source-derived and unmarked.

The stored-program reader alone selects an unversioned pre-change program's
narrow `Legacy` canonical projection. It preserves original hashes and requires
agreement between selected generation and every authenticated envelope. Unknown
formats/versions/markers fail without retrying a historical decoder. Current
constructors do not publish Legacy programs. A fresh appDocument definition
version 2 supports source document roots using Source DTO JSON text inside the
private JSONB envelope; version 1 keeps its old closed meaning.

Carry the verified generation into Worker/grant/request identity checks. The
current Source DTO transports already verified semantic validators to Workers;
it is distinct from historical identity bytes. Untrusted request data cannot
select a historical verification mode. Function Metadata V1 and c554 keep their
own named historical codecs, not this new source grammar.

No physical table, request schema, durable result, program/head key or settlement
owner changes. Keep authentication before claim/recovery. Preserve committed
replay, live-claim busy outcomes, fencing and uncertain-save reconciliation;
never reexecute a result merely because a serializer changed.

## Scope and removal gate

The selected local inventory contains no current core physical family, but does
contain a retained analyzed developer push. Preserve it; do not infer absence of
shared, external, custom or resident state. No destructive migration or reset is
selected. Actual active/public/inflight/outcome obligations govern retention;
this record adds no blanket right to execute every inactive revision.

Remove the narrow Legacy identity path only after its named retained programs,
heads, requests and outcomes are proved migrated or retired under their actual
owners. Unknown external stores are not an automatic deletion disposition.
Required proof includes a frozen pre-change positive-record program/head/outcome
cold-reopen trace, marker tampering/unknown-generation refusal and real Worker
execution with current transport after historical authentication. PGlite and
ordinary-role PostgreSQL are separate gates. Managed-host capacity is unmeasured.

The executing reader is `readCoreApplicationProgram` with the narrow
`LegacyApplicationProgramIdentity` projector. It freezes original table/function
validators before hashing; current root normalization never rewrites historical
identity payloads. `ApplicationWorkerDefinition`, the Worker request decoder and
Core query/mutation runners carry the verified generation. Baseline physical-row
fixtures include an executable SDK record artifact and underscore/name cases.

The local developer push is raw DeploymentSchema/DeploymentFunctions and needs
no ApplicationManifest discriminator. The owned PostgreSQL target has no old
relational analysis table; external/shared state is unknown. This adaptation does
not migrate non-Core relational analysis/publication/activation/history identities.
Their retained-store inventory and correlated cutover remain required before
activation over such data. No generic Legacy fallback or reset is selected.
