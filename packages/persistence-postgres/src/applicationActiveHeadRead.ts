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

import {
  applicationActivationFrame,
  applicationActiveHeadFrame,
  type ApplicationActivationReadinessCommitment,
} from "./applicationActivationFrames";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "./applicationActivationSchema";
import {
  fxSystemApplicationRevisionSchemas,
} from "./applicationRelationSchema";
import type { AppRowTransaction } from "./appRows";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { fxSystemApplicationRevisionSchemasV1 } from "./schema";

const UTF8 = new TextEncoder();
const MAX_FRAME_BYTES = 1_048_576;

export class ApplicationActiveHeadStateError extends Data.TaggedError(
  "ApplicationActiveHeadStateError",
)<{
  readonly reason: "storedState" | "resourceFailure";
  readonly retryable: boolean;
  readonly revisionId?: string;
  readonly cause?: unknown;
}> {}

interface DecodedApplicationActiveHeadBase {
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export type DecodedApplicationActiveHead =
  | Readonly<DecodedApplicationActiveHeadBase & {
      readonly readinessKind: "legacy";
      readonly readinessContractVersion: 1;
      readonly relationSetReadinessSha256: null;
      readonly relationCount: null;
    }>
  | Readonly<DecodedApplicationActiveHeadBase & {
      readonly readinessKind: "relation";
      readonly readinessContractVersion: 2;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

interface DecodedApplicationActivationBase {
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly activationRequestSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
  readonly activatedAt: Date;
}

export type DecodedApplicationActivation =
  | Readonly<DecodedApplicationActivationBase & {
      readonly readinessKind: "legacy";
      readonly readinessContractVersion: 1;
      readonly relationSetReadinessSha256: null;
      readonly relationCount: null;
    }>
  | Readonly<DecodedApplicationActivationBase & {
      readonly readinessKind: "relation";
      readonly readinessContractVersion: 2;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

export interface CoherentApplicationActiveHead {
  readonly head: DecodedApplicationActiveHead;
  readonly activation: DecodedApplicationActivation;
}

export const decodeApplicationActiveHeadRowEffect = Effect.fn(
  "ApplicationActiveHead.decodeRow",
)(function* (
  row: typeof fxSystemApplicationActiveHeads.$inferSelect,
) {
  const readiness = yield* decodeHeadReadiness(row);
  const expected = applicationActiveHeadFrame({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    revisionId: row.revisionId,
    readiness: readiness.commitment,
    activationSha256: encodeBytesToLowercaseHex(row.activationSha256),
  });
  yield* validateFrame(
    row.headBytes,
    row.headSha256,
    expected,
    row.revisionId,
  );
  const common = {
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(row.readinessSha256),
    activationSha256: copyBytes(row.activationSha256),
    headSha256: copyBytes(row.headSha256),
  } as const;
  return readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        readinessKind: "legacy" as const,
        readinessContractVersion: 1 as const,
        relationSetReadinessSha256: null,
        relationCount: null,
      })
    : Object.freeze({
        ...common,
        readinessKind: "relation" as const,
        readinessContractVersion: 2 as const,
        relationSetReadinessSha256:
          copyBytes(readiness.relationSetReadinessSha256),
        relationCount: readiness.relationCount,
      });
});

export const decodeApplicationActivationRowEffect = Effect.fn(
  "ApplicationActivation.decodeRow",
)(function* (
  row: typeof fxSystemApplicationActivations.$inferSelect,
) {
  const readiness = yield* decodeActivationReadiness(row);
  const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
  if (activatedAt === null) return yield* storedState(row.revisionId);
  const expected = applicationActivationFrame({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    previousActivationSequence:
      row.previousActivationSequence?.toString() ?? null,
    revisionId: row.revisionId,
    readiness: readiness.commitment,
    activationRequestSha256:
      encodeBytesToLowercaseHex(row.activationRequestSha256),
    activatedAt: activatedAt.toISOString(),
  });
  yield* validateFrame(
    row.activationBytes,
    row.activationSha256,
    expected,
    row.revisionId,
  );
  const common = {
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    previousActivationSequence: row.previousActivationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(row.readinessSha256),
    activationRequestSha256: copyBytes(row.activationRequestSha256),
    activationSha256: copyBytes(row.activationSha256),
    activatedAt: new Date(activatedAt.getTime()),
  } as const;
  return readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        readinessKind: "legacy" as const,
        readinessContractVersion: 1 as const,
        relationSetReadinessSha256: null,
        relationCount: null,
      })
    : Object.freeze({
        ...common,
        readinessKind: "relation" as const,
        readinessContractVersion: 2 as const,
        relationSetReadinessSha256:
          copyBytes(readiness.relationSetReadinessSha256),
        relationCount: readiness.relationCount,
      });
});

export const readApplicationActiveRevisionForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readRevisionForShareInTransaction")(
    function* (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) {
      const active = yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(
        tx,
        scopeId,
      );
      if (active === null) return null;
      const head = active.head;
      const bindings = head.readinessKind === "legacy"
        ? yield* query(
            tx.select().from(fxSystemApplicationRevisionSchemasV1).where(and(
              eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId),
              eq(
                fxSystemApplicationRevisionSchemasV1.revisionId,
                head.revisionId,
              ),
            )).limit(2).for("share"),
            head.revisionId,
          )
        : yield* query(
            tx.select().from(fxSystemApplicationRevisionSchemas).where(and(
              eq(fxSystemApplicationRevisionSchemas.scopeId, scopeId),
              eq(fxSystemApplicationRevisionSchemas.revisionId, head.revisionId),
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
        databaseTimestampFromUnknown(binding.boundAt) === null) {
        return yield* storedState(head.revisionId);
      }
      if (head.readinessKind === "legacy") {
        if (!("schemaBindingSha256" in binding) ||
          !isUint8ArrayWithByteLength(binding.schemaBindingSha256, 32)) {
          return yield* storedState(head.revisionId);
        }
      } else if (!("manifestSchemaBindingSha256" in binding) ||
        !isUint8ArrayWithByteLength(
          binding.manifestSchemaBindingSha256,
          32,
        ) || !("boundPublicationSha256" in binding) ||
        !isUint8ArrayWithByteLength(binding.boundPublicationSha256, 32)) {
        return yield* storedState(head.revisionId);
      }
      return Object.freeze({
        revisionId: head.revisionId,
        deploymentId: binding.deploymentId,
        schemaVersionId: binding.schemaVersionId,
      });
    },
  );

/** Authenticates the exact current persisted active-head frame. */
export const readApplicationActiveHeadForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readForShareInTransaction")(
    function* (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) {
      const rows = yield* query(
        tx.select().from(fxSystemApplicationActiveHeads).where(eq(
          fxSystemApplicationActiveHeads.scopeId,
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

/** Authenticates one head and the immutable activation row it selects. */
export const readCoherentApplicationActiveHeadForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readCoherentForShareInTransaction")(
    function* (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ): Effect.fn.Return<
      CoherentApplicationActiveHead | null,
      ApplicationActiveHeadStateError
    > {
      const head = yield* readApplicationActiveHeadForShareInTransactionEffect(
        tx,
        scopeId,
      );
      if (head === null) return null;
      const rows = yield* query(
        tx.select().from(fxSystemApplicationActivations).where(and(
          eq(fxSystemApplicationActivations.scopeId, scopeId),
          eq(
            fxSystemApplicationActivations.activationSequence,
            head.activationSequence,
          ),
        )).limit(1).for("share"),
        head.revisionId,
      );
      const row = rows[0];
      if (row === undefined) return yield* storedState(head.revisionId);
      const activation = yield* decodeApplicationActivationRowEffect(row);
      if (!activationMatchesHead(activation, head)) {
        return yield* storedState(head.revisionId);
      }
      return Object.freeze({ head, activation });
    },
  );

export function activationMatchesHead(
  activation: DecodedApplicationActivation,
  head: DecodedApplicationActiveHead,
): boolean {
  if (activation.scopeId !== head.scopeId ||
    activation.activationSequence !== head.activationSequence ||
    activation.revisionId !== head.revisionId ||
    activation.readinessContractVersion !== head.readinessContractVersion ||
    !bytesEqualFullScan(activation.readinessSha256, head.readinessSha256) ||
    !bytesEqualFullScan(activation.activationSha256, head.activationSha256)) {
    return false;
  }
  return activation.readinessKind === "legacy" && head.readinessKind === "legacy" ||
    activation.readinessKind === "relation" && head.readinessKind === "relation" &&
      activation.relationCount === head.relationCount &&
      bytesEqualFullScan(
        activation.relationSetReadinessSha256,
        head.relationSetReadinessSha256,
      );
}

type DecodedReadiness =
  | Readonly<{
      readonly kind: "legacy";
      readonly commitment: Extract<
        ApplicationActivationReadinessCommitment,
        { readonly kind: "legacy" }
      >;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly commitment: Extract<
        ApplicationActivationReadinessCommitment,
        { readonly kind: "relation" }
      >;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

function decodeHeadReadiness(
  row: typeof fxSystemApplicationActiveHeads.$inferSelect,
): Effect.Effect<DecodedReadiness, ApplicationActiveHeadStateError> {
  if (!commonDigestsAreValid(
    row.readinessSha256,
    row.activationSha256,
    row.headSha256,
  )) return storedState(row.revisionId);
  if (row.readinessContractVersion === 1 &&
    row.relationSetReadinessSha256 === null && row.relationCount === null) {
    return Effect.succeed(Object.freeze({
      kind: "legacy" as const,
      commitment: Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
      }),
    }));
  }
  if (row.readinessContractVersion === 2 &&
    isUint8ArrayWithByteLength(row.relationSetReadinessSha256, 32) &&
    validRelationCount(row.relationCount)) {
    return Effect.succeed(Object.freeze({
      kind: "relation" as const,
      commitment: Object.freeze({
        kind: "relation" as const,
        contractVersion: 2 as const,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
        relationSetReadinessSha256:
          encodeBytesToLowercaseHex(row.relationSetReadinessSha256),
        relationCount: row.relationCount,
      }),
      relationSetReadinessSha256: copyBytes(row.relationSetReadinessSha256),
      relationCount: row.relationCount,
    }));
  }
  return storedState(row.revisionId);
}

function decodeActivationReadiness(
  row: typeof fxSystemApplicationActivations.$inferSelect,
): Effect.Effect<DecodedReadiness, ApplicationActiveHeadStateError> {
  if (!isUint8ArrayWithByteLength(row.readinessSha256, 32) ||
    !isUint8ArrayWithByteLength(row.activationRequestSha256, 32) ||
    !isUint8ArrayWithByteLength(row.activationSha256, 32)) {
    return storedState(row.revisionId);
  }
  if (row.readinessContractVersion === 1 &&
    isUint8ArrayWithByteLength(row.legacyReadinessSha256, 32) &&
    bytesEqualFullScan(row.legacyReadinessSha256, row.readinessSha256) &&
    row.relationReadinessSha256 === null &&
    row.relationSetReadinessSha256 === null && row.relationCount === null) {
    return Effect.succeed(Object.freeze({
      kind: "legacy" as const,
      commitment: Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
      }),
    }));
  }
  if (row.readinessContractVersion === 2 && row.legacyReadinessSha256 === null &&
    isUint8ArrayWithByteLength(row.relationReadinessSha256, 32) &&
    bytesEqualFullScan(row.relationReadinessSha256, row.readinessSha256) &&
    isUint8ArrayWithByteLength(row.relationSetReadinessSha256, 32) &&
    validRelationCount(row.relationCount)) {
    return Effect.succeed(Object.freeze({
      kind: "relation" as const,
      commitment: Object.freeze({
        kind: "relation" as const,
        contractVersion: 2 as const,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
        relationSetReadinessSha256:
          encodeBytesToLowercaseHex(row.relationSetReadinessSha256),
        relationCount: row.relationCount,
      }),
      relationSetReadinessSha256: copyBytes(row.relationSetReadinessSha256),
      relationCount: row.relationCount,
    }));
  }
  return storedState(row.revisionId);
}

function commonDigestsAreValid(...values: ReadonlyArray<unknown>): boolean {
  return values.every(value => isUint8ArrayWithByteLength(value, 32));
}

function validRelationCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" &&
    value >= 1 && value <= 1_024;
}

const validateFrame = Effect.fn("ApplicationActiveHead.validateFrame")(
  function* (
    bytes: Uint8Array,
    expectedSha256: Uint8Array,
    expected: Readonly<Record<string, unknown>>,
    revisionId: string,
  ) {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES ||
      !bytesEqualFullScan(yield* sha256(bytes), expectedSha256) ||
      !isJson(expected) || !bytesEqualFullScan(
        UTF8.encode(encodeCanonicalJson(expected, invariant)),
        bytes,
      )) return yield* storedState(revisionId);
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
    catch: cause => new Error("Application activation SHA-256 failed.", {
      cause,
    }),
  }).pipe(Effect.orDie);
}

function invariant(issue: Readonly<{ reason: string }>): never {
  throw new Error(`Application activation frame invariant: ${issue.reason}`);
}
