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

The stored-program reader accepts only the current closed envelope and encoding
2. The pre-change program projector is retired under the owner's no-data
disposition. Unknown formats/versions/markers and obsolete object envelopes fail
without retrying another decoder. A fresh appDocument definition
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

The owner confirms that no live database or retained deployment data exists.
The [local retirement scope](../slices/16d-local-legacy-core-retirement.md) removes
the pre09 stored-program projector and its fixtures. Current program construction,
hash/authority verification, cold reconstruction and original-outcome recovery
remain covered at their executing owners. PGlite and ordinary-role PostgreSQL
remain separate validation gates; managed-host capacity is unmeasured.

`readCoreApplicationProgram` accepts encoding 2 only. `ApplicationWorkerDefinition`,
the Worker request decoder and Core query/mutation runners carry that verified
generation. Broader encoding-1 protocol support still has legacy runtime callers;
its removal depends on their behavior-preserving migration, rather than a
hypothetical external dataset. Source DTO transport and appDocument V1/V2
contracts retain their separate current meanings.
