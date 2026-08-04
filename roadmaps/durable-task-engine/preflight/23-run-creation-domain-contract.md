# DTE04-P23: Task Input And Run-Creation Domain Contract

## Status

**Status:** **Complete: admit DTE04-A2a.** This file admits
only storage-neutral values, codecs, canonical digest preimages, typed
validation/conflict errors, and focused tests in `@flarex/durable-task`.
It does not admit DDL, hashing authority, object-store writes, a creation
service, application task lookup, or production routing.

## Ownership Decision

Run creation is not a synthetic run-attempt transition. The durable-task
domain owns the closed values that the later scope-bound Task System creation
operation consumes and returns:

- `TaskInputReferenceV1`;
- `TaskRunCreationRequestKeyV1`;
- `TaskRunCreationRequestV1`;
- `TaskRunCreationReceiptV1`;
- the canonical request-key and creation-request SHA-256 preimages; and
- request-validation and idempotency-conflict errors.

The Standard Application owner still resolves `TaskIdV1`, authenticates the
active task basis, and supplies the immutable task-definition revision plus
creation-authority receipt. The Postgres adapter will hash the canonical
preimages and atomically persist their digests. Neither concern moves into
the durable-task package.

This split intentionally keeps `TaskIdV1` out of the creation request. The
host resolves the developer task key before entering the Task System. The
closed request carries the resulting `TaskDefinitionRevisionIdV1`, so an
idempotency key cannot silently retarget to a newly active definition.

## Task Input Reference

The first vertical stores input bytes in one immutable, content-addressed task
input object store. The task-state row stores only this reference:

```ts
interface TaskInputReferenceV1 {
  readonly codec: "flarex.task-input-reference.v1";
  readonly store: "flarex.task-input-object-store.v1";
  readonly valueCodec: "flarex-value/v1";
  readonly objectKey: string;
  readonly byteLength: number;
  readonly sha256: Uint8Array;
  readonly retention: { readonly kind: "run_lifetime" };
}
```

`sha256` is exactly 32 owned bytes. `byteLength` is a positive safe integer no
greater than 32 MiB. The only valid object-key spelling is derived from the
digest:

```text
durable-task-input/v1/sha256/<64 lowercase hexadecimal digits>
```

Callers do not choose a bucket, account, region, URL, credential, or arbitrary
object key. The value codec commits the existing canonical Flarex Value V1
envelope without importing that payload body into task state.

`run_lifetime` means the referenced bytes must remain fetchable for every
non-deleted run and for any retained terminal run. This checkpoint admits no
automatic expiry. A later deletion/retention roadmap must remove or tombstone
the owning run before it may reclaim the last referenced input object, and it
must account for digest deduplication. Application deactivation, a later task
revision, or terminalization alone never authorizes input deletion.

## Request Key And Canonical Preimages

`TaskRunCreationRequestKeyV1` is an opaque exact string. It accepts valid
Unicode scalar text from 1 through 255 UTF-8 bytes, rejects C0/C1 controls and
leading or trailing ECMAScript whitespace, and performs no trimming,
normalization, case folding, or aliasing. Raw keys are transient input and
must not be stored, logged, or returned in a durable success receipt.

Two distinct versioned canonical JSON preimages are defined:

1. `flarex.task-run-creation-request-key-preimage.v1` contains the exact raw
   request key. Its SHA-256 becomes the scope-local request identity used by
   the unique constraint.
2. `flarex.task-run-creation-request-preimage.v1` contains the immutable task
   definition revision plus the complete canonical input reference. Its
   SHA-256 distinguishes an exact replay from an idempotency conflict.

The request-key preimage is deliberately separate from the request preimage.
Changing a key does not change the semantic request, while reusing one key for
a different definition or input conflicts. PostgreSQL JSONB serialization is
never a digest preimage.

## Receipt And Conflict

The committed receipt is stable replay data, not an indication of whether the
current call inserted or replayed the row. It contains:

- `status = "created"` and `version = 1`;
- the storage-issued `TaskRunIdV1`;
- captured `TaskDefinitionRevisionIdV1`;
- database-derived `createdAtMs`;
- the request-key SHA-256;
- the canonical creation-request SHA-256; and
- the canonical creation-authority receipt SHA-256.

All digest fields are owned 32-byte values. An exact replay returns the same
receipt fields. An operation-local diagnostic may report replay without
mutating the durable receipt.

`TaskRunCreationIdempotencyConflictError` means the same validated request key
resolved to a different canonical request digest. It may return the key to the
trusted private caller for correlation, but must not expose the existing run,
definition, input digest, scope, or authority receipt. Invalid unknown input
maps to `InvalidTaskRunCreationRequestError` before storage access.

## Effect And Storage Boundary

The codecs and preimage builders are pure and return `Result`. They establish
owned byte snapshots before returning. Hashing remains an Effectful foreign
capability at the later persistence/application composition boundary; this
slice does not call global crypto or introduce a second SHA-256 implementation.
Intrinsic digest classification, copying, and lowercase hexadecimal encoding
reuse only `@flarex/utils/bytes`; the compatibility boundary admits no other
utility subpath.

The future creation service remains separate from
`TaskSystemRunAttemptStore`. Its transaction will consume a decoded request,
trusted Standard Application creation authority, and scope-bound store
capability, then build the only legal initial aggregate using database time.

## Admission Tests

DTE04-A2a must prove:

1. request-key Unicode, byte, control, and boundary behavior;
2. input-reference digest ownership, exact object-key derivation, size bounds,
   and strict unknown-key rejection;
3. deterministic canonical preimages and field separation;
4. request and receipt digest ownership after caller mutation;
5. malformed run/definition IDs, digests, numbers, and cross-field reference
   mismatches fail with the typed validation error; and
6. no `TaskIdV1`, tenant, deployment, scope, locator, SQL, Drizzle, Prisma,
   Cloudflare, or object-store client enters the new package surface.

## Remaining DTE04-A2b Blocker

This checkpoint does not close DTE04-A2. DTE04-A2b must still implement, in
the Standard Application owners, the canonical task catalog and `TaskIdV1`,
`TaskDefinitionRuntimeBindingV1`, and
`TaskRunCreationAuthorityReceiptV1`. DTE04-A3 remains closed until both halves
are complete and their digest/correlation contract has one final admission
receipt.

## Admission Receipt

Closed on 2026-08-04:

1. `@flarex/durable-task/internal/run-creation-v1` owns the immutable input
   reference, opaque request key, closed request, stable receipt, typed
   validation/conflict errors, and canonical key/request preimages;
2. exact own-data capture rejects excess keys, accessors, hostile proxies, and
   forged digest views without invoking caller behavior;
3. intrinsic byte copies prevent caller `slice` or iterator overrides from
   changing content-addressed identity, and every returned digest is detached;
4. validation preserves request and receipt first-failure order before later
   hostile nested values are inspected;
5. the complete request-key and request-preimage JSON spellings are golden
   tested; and
6. package typecheck, all 51 durable-task tests, the 29-entry source-map gate,
   65 lifecycle vectors with 37 named differences, the 17-test compatibility
   checker, the live boundary gate, and both required final reviewers pass.

This receipt does not admit DTE04-A2b, DTE04-A3, a creation service, hashing,
object-store I/O, persistence, host composition, or activation.
