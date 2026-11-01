# Public Application source and activation

Status: **Bounded fresh public activation implemented and reviewed; unmeasured.**

Owner: [fresh public activation](../slices/18-public-application-activation.md).
Pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Pinned mechanism

Convex `application/src/deploy_config.rs::start_push/finish_push` prepares and
analyzes immutable packages outside its activation transaction, then publishes
module/source/component/schema/index metadata through the same transaction.
`database/src/bootstrap_model/schema/mod.rs` requires the submitted proposal to
remain validated or active. An overwritten or failed proposal cannot activate.

## Why and how the host differs

Flarex uploads framed SourceArtifactV2 contents to R2, with the existing
Cloudflare attempt store coordinating upload progress. Its public package digest
is a different framed identity, including source maps and selectors; it is not
the raw module digest or finalized root. The production producer authenticates
and binds both identities from the same bytes. Inline authentication settings
remain package provenance; unsupported executable auth modules refuse.

The producer verifies exact source-map presence and bytes through the existing
authenticated finalized-content reader and preserves UTF-8 byte-order marks.
The current artifact framing cannot represent a present zero-byte source map;
the public producer refuses that input before storage side effects rather than
silently turning it into an absent map. Ordinary analysis retains its existing
source-map ignore mode.

An ordinary dependency has role bitset zero: it is uploaded and authenticated
without falsely making it an analyzed function, schema or execution entry. The
shared source-role decoder admits this membership while preserving unknown-bit,
negative and noninteger refusals. This corrects the old positive-role-only
assumption; the binary framing stays unchanged.

The fresh Core package codec admits validated inline declarative JWT settings
and binds them to the package/candidate activation. The retained legacy decoder
still requires its executable auth-module contract. This explicit Core profile
does not evaluate Convex-style auth modules; it refuses those modules before
upload/publication. There is no implicit anonymous downgrade or old-config reuse.

The existing PostgreSQL logical `_schemas` registration proposal owns the fresh
public candidate and its canonical manifest/package evidence. Preparation,
readiness, cancellation and complete program activation use existing Core admin
transactions, observations and publication. No extra physical table, backend
installer, cross-store transaction or serving-time registration is added.
Cloudflare public metadata is a projection; the Core profile bypasses the legacy
SQLite activation gate. Remote upload and analysis never hold a database
transaction. Cold retries reconstruct from persisted authenticated evidence.

Public candidate identity/status is an admitted recovery obligation. These
candidate rows survive the ordinary internal failed/overwritten-schema cleanup
window, so a delayed finish/status/abandon retry cannot forget its disposition.
They retain source evidence and historical schema identity until a separately
specified public-candidate retention/removal policy permits retirement. This is
an explicit difference from Source's temporary internal-schema cleanup; it does
not select production retention/capacity settings.

## Guarantees and limits

PostgreSQL alone owns active application identity and durable outcomes.
Competing candidate changes and finish/abandon resolve in the same OCC domain.
Empty candidate cleanup retires only authenticated staged logical metadata and
retains physical history; foreign data/ownership prevents it. Exact active retry
is idempotent after writes. Changed-source runtime upgrades remain refused in
this bounded fresh profile; this does not claim Convex's full deployment support.

Preserve exact public visibility, validators, admitted inline JWT identity and
committed mutation recovery. Do not treat old numeric sync dependencies as Core
tokens. Independent legacy writers still require exclusion before activation.

PGlite and ordinary PostgreSQL prove state/transaction behavior separately.
Actual Workerd must prove the complete public route/source/analyzer/DO/execution
graph, restart/ack loss and resource disposal. No deployment, managed production
activation, capacity or performance proof follows from this local slice.

Cancelling a never-activated candidate may tombstone its authenticated empty
logical table/index/validation catalog entries immediately while retaining
physical document/index/catalog history. Pinned `TableModel` ordinarily marks a
table Deleting before retention-driven catalog removal. The bounded cancellation
requires complete ownership/emptiness observations and uses shared transaction
and committer registry-removal propagation; it is not general table-retirement
or physical-history deletion support.
