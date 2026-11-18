# Application execution-group catalog coverage

Design status: **Selected correction of accepted consumed-metadata coverage**.
Implementation status: **Implemented, including explicit installation reconciliation**.
Measurement status: **Unmeasured**.
Owner: [04C2](../slices/04c2-exact-selection-preparation.md).

## Pinned mechanism and existing difference

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`, function validation,
module/source selection, nested resolution and schema/table registries consume
transaction metadata at the original snapshot, including cached paths. The
[original backend transaction](../../../../../../crates/application/src/application_function_runner/mod.rs)
retains preparation reads; the
[function runner](../../../../../../crates/function_runner/src/in_memory_indexes.rs)
reconstructs matching registries, and
[UdfPhase::get_module](../../../../../../crates/isolate/src/environment/udf/phase.rs)
selects module/source-package metadata before using its cache.

Flarex's accepted finite profile records root-function semantics plus an
authenticated execution group instead of inventing a per-function executable
closure ([finite contract](../../../../roadmaps/mixed-mutation-core/23-finite-execution-contract-preflight.md)).
The current Worker embeds a complete manifest-derived callable catalog, but the
previous group preimage contained only sourceArtifact, runtime host and compatibility date.
Canonical registration can publish different child metadata under the same source
root, so that preimage does not cover all consumed catalog semantics.

## Selected correction

Include the existing verified functionCatalogSha256 in the same execution group.
The [V1](../../../../packages/analysis/src/applicationPublicationFramesV1.ts) and
[V2](../../../../packages/analysis/src/applicationPublicationFramesV2.ts) catalog
frames commit the complete ordered manifest.functions array. V2/V3 use the V2
frame. The digest covers membership, path/module/export, kind, visibility,
args/returns, partition and implicit ordinals; the retained sourceArtifact covers
their code correlation. Reuse this digest and its canonical owners rather than
copying the catalog, creating another codec or adding per-child tokens/RPCs.

The shared execution projection serves preparation, activation and canonical
backfill. Activation/preparation already have an authenticated basis digest.
Backfill derives/verifies that digest from the authenticated manifest through
the existing frame owner before using it. Do not trust a newly forwarded stored
digest without its existing publication evidence.

Same-source child metadata changes and ABA now change the consumed group. This
is deliberately conservative across the whole callable catalog. Existing live
revocation additionally handles withdrawal/removal. Unrelated schema/table-only
changes do not enter the execution-group preimage. Root-plus-group dependency
recording and current metadata sequence/tombstone enforcement remain unchanged.

An unchanged execution group does not bypass other validation. A read-only
contribution can survive an unrelated schema change, while a contribution with
row intents retains its original candidate-schema guard and can refuse the same
candidate movement. The runtime witnesses keep both controls.

## Existing data and upgrade disposition

Use public persistence migrate/explicit installation reconciliation, even without
pending SQL migrations. Its canonical Application backfill updates generic
current metadata semantics through the existing initializer/activation writer.
No new table, column, anchor/reservation/dependency codec or synthetic watermark
is required. Equal projections preserve their sequence; changed group values
advance the existing metadata clock; tombstones and ABA history remain intact.

Preparation/entry never repairs old observations. Replaying an already active
publication is insufficient because that path returns before projection work.
Preserve existing anchors, reservations, captured watermarks and outcomes. Old
graphs must refuse or use existing authenticated conflict/recovery/expiry owners;
maintenance is not fresh execution authority.

Coordinate affected writer/runtime replacement with maintenance. Installation
maintenance drains admitted SQL and invalidates issued installation capabilities,
not all logical attempts. Current attestation does not enforce a JavaScript
projection-algorithm version, so mixed old/new writer compatibility is not
supported by this change. Failure/restart uses the existing durable maintenance
owner and must not reopen incomplete state.

## Evidence and cost

04C2 requires actual canonical same-source metadata edits and ABA after genuine
finite entry, an actual Worker/native consumer, unchanged revocation controls,
unrelated schema/table controls, and populated predecessor reconciliation on
PGlite and ordinary PostgreSQL. Unit projection equality alone is insufficient.

The group adds a bounded digest member and may conservatively conflict on any
callable-catalog change. There is no per-child round trip or new dependency
registry. Preparation/activation reuse verified digests; maintenance authenticates
its own input. No throughput, deployment or rolling-upgrade claim is made.
