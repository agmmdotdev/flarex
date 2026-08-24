import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import type { AppRowTransaction } from "./appRows";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import {
  fxSystemApplicationActiveHeadsV1,
  fxSystemApplicationRevisionSchemasV1,
} from "./schema";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_FRAME_BYTES = 1_048_576;

export class ApplicationActiveHeadStateError extends Data.TaggedError(
  "ApplicationActiveHeadStateError",
)<{
  readonly reason: "storedState" | "resourceFailure";
  readonly retryable: boolean;
  readonly revisionId?: string;
  readonly cause?: unknown;
}> {}

export interface DecodedApplicationActiveHead {
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export const decodeApplicationActiveHeadRowEffect = Effect.fn(
  "ApplicationActiveHead.decodeRow",
)(function* (
  row: typeof fxSystemApplicationActiveHeadsV1.$inferSelect,
) {
  const bytes = row.headBytes;
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES ||
    !bytesEqualFullScan(yield* sha256(bytes), row.headSha256)) {
    return yield* storedState(row.revisionId);
  }
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => new ApplicationActiveHeadStateError({
      reason: "storedState",
      retryable: false,
      revisionId: row.revisionId,
      cause,
    }),
  });
  const expected = {
    format: "flarex.application-active-head",
    version: 1,
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    revisionId: row.revisionId,
    readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(row.activationSha256),
  };
  if (!isJson(parsed) || !isJson(expected) ||
    !bytesEqualFullScan(
      UTF8.encode(encodeCanonicalJson(parsed, invariant)),
      bytes,
    ) || !bytesEqualFullScan(
      UTF8.encode(encodeCanonicalJson(expected, invariant)),
      bytes,
    )) return yield* storedState(row.revisionId);
  return Object.freeze({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(row.readinessSha256),
    activationSha256: copyBytes(row.activationSha256),
    headSha256: copyBytes(row.headSha256),
  });
});

export const readApplicationActiveRevisionForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readRevisionForShareInTransaction")(
    function* (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) {
      const head = yield* readApplicationActiveHeadForShareInTransactionEffect(
        tx,
        scopeId,
      );
      if (head === null) return null;
      const bindings = yield* query(
        tx.select().from(fxSystemApplicationRevisionSchemasV1).where(and(
          eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId),
          eq(fxSystemApplicationRevisionSchemasV1.revisionId, head.revisionId),
        )).limit(2).for("share"),
        head.revisionId,
      );
      const binding = bindings[0];
      if (bindings.length !== 1 || binding === undefined ||
        binding.scopeId !== scopeId || binding.revisionId !== head.revisionId ||
        !isNonBlankString(binding.deploymentId) ||
        !isNonBlankString(binding.schemaVersionId) ||
        !Number.isSafeInteger(binding.schemaVersion) || binding.schemaVersion < 1 ||
        !isUint8ArrayWithByteLength(binding.applicationSchemaSha256, 32) ||
        !isUint8ArrayWithByteLength(binding.schemaManifestSha256, 32) ||
        !isUint8ArrayWithByteLength(binding.schemaBindingSha256, 32) ||
        databaseTimestampFromUnknown(binding.boundAt) === null) {
        return yield* storedState(head.revisionId);
      }
      return Object.freeze({
        revisionId: head.revisionId,
        deploymentId: binding.deploymentId,
        schemaVersionId: binding.schemaVersionId,
      });
    },
  );

/**
 * Authenticates the exact current persisted active-head frame while retaining
 * the caller-owned transaction and lock ordering. It deliberately does not
 * infer a revision schema or readiness generation from the revision ID.
 */
export const readApplicationActiveHeadForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readForShareInTransaction")(
    function* (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) {
      const rows = yield* query(
        tx.select().from(fxSystemApplicationActiveHeadsV1).where(eq(
          fxSystemApplicationActiveHeadsV1.scopeId,
          scopeId,
        )).limit(1).for("share"),
      );
      const row = rows[0];
      if (row === undefined) return null;
      const head = yield* decodeApplicationActiveHeadRowEffect(row);
      return head.scopeId === scopeId
        ? head
        : yield* storedState(head.revisionId);
    },
  );

function storedState(revisionId?: string) {
  return Effect.fail(new ApplicationActiveHeadStateError({
    reason: "storedState",
    retryable: false,
    ...(revisionId === undefined ? {} : { revisionId }),
  }));
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  revisionId?: string,
) {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => new ApplicationActiveHeadStateError({
      reason: "resourceFailure",
      retryable: retryableCause(cause),
      ...(revisionId === undefined ? {} : { revisionId }),
      cause,
    }),
  });
}

function retryableCause(cause: unknown): boolean {
  const code = isNonArrayRecord(cause) ? cause.code : undefined;
  return code === "40001" || code === "40P01" || code === "55P03";
}

function sha256(bytes: Uint8Array) {
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.digest(
        "SHA-256",
        copyBytesToArrayBuffer(bytes),
      ).then(value => new Uint8Array(value)),
    catch: cause => new Error("Application active-head SHA-256 failed.", {
      cause,
    }),
  }).pipe(Effect.orDie);
}

function invariant(issue: Readonly<{ reason: string }>): never {
  throw new Error(`Application active-head frame invariant: ${issue.reason}`);
}
