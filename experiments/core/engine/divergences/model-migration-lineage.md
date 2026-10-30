# Translated model migration lineage

Design status: **Accepted local data cutover boundary**.
Implementation status: **Supported c554 cutover and reopen implemented**.
Measurement status: **Supported c554 preservation/reopen validated on both database lanes**.

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` has its own
historical model migration lineage (currently version 134). That number describes
upstream data, not data created by Flarex. Flarex cannot honestly mark its old
four-builtin store as having executed those migrations.

The translated `_db` metadata therefore starts at local version 1. The one-time
cutover in `src/core/bootstrap.ts`, using `src/core/legacySchema.ts`, recognizes
the preceding c554 metadata format, preserves existing table/document/index
identities and history, and translates its validators into an active `_schemas`
document. Previously maintained disabled indexes remain staged Backfilled
catalog rows and unavailable to ordinary reads. The active schema imports enabled
index declarations only: the old disabled catalog flag did not encode source staged
author intent, and some old stores have duplicate enabled/disabled field lists.
Preserving those catalog rows outside the active declaration follows the source
orphan-index model without weakening schema validation or deleting an identity.
Programs, durable request
outcomes and physical index keys retain their identity. The pinned PostgreSQL
adapter keys index rows by logical IndexId, even when metadata contains a
legacy PersistenceIndexId; no physical rekey is required.

This is a local version lineage, not an alternate schema lifecycle. New schema
installation and evolution use the translated shared logical models and worker.
Physical baseline adoption belongs to the separate privileged Drizzle maintenance
entry point and must precede ordinary runtime loading. The migration does not
reset application data, synthesize missing migration history or support arbitrary
unrecognized physical/model formats. The supported old-store adoption, reopen,
physical history, staged visibility, program and outcome preservation have local
PGlite and restricted-role PostgreSQL proofs. Older logical transaction admission
still obeys the recorded metadata/retention floor.