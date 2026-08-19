import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import type { AppRowTransaction } from "./appRows";
import {
  decodeApplicationActiveHeadRowEffect,
  type DecodedApplicationActiveHead,
} from "./applicationActiveHeadRead";
import {
  hasApplicationReadinessComposition,
  hasApplicationReadinessPlanningComposition,
  validateApplicationReadinessForActivationInTransaction,
  validateStoredApplicationReadinessForActivationInTransaction,
  type ApplicationReadinessActivationBasis,
  type ApplicationReadinessRepository,
  type ApplicationReadinessResult,
  type ReadApplicationReadinessError,
  type SettleApplicationReadinessError,
} from "./applicationReadiness";
import type { ApplicationSchemaAuthorityPublisher } from
  "./applicationSchemaAuthority";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  fxSystemApplicationActivationsV1,
  fxSystemApplicationActiveHeadsV1,
  fxSystemScopeClocks,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_IDENTITY_BYTES = 1_024;
const MAX_FRAME_BYTES = 1_048_576;
const MAX_SEQUENCE = 9_223_372_036_854_775_807n;

export interface ApplicationActiveCasToken {
  readonly activationSequence: bigint;
  readonly headSha256: string;
}

export interface ApplicationActivationReceipt {
  readonly status: "activated";
  readonly disposition: "inserted" | "replayed";
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly revisionId: string;
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly readinessSha256: string;
  readonly activationSha256: string;
  readonly activationRequestSha256: string;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly activatedAt: Date;
}

declare const applicationActiveSelectionBrand: unique symbol;
export interface ApplicationActiveSelection {
  readonly [applicationActiveSelectionBrand]: true;
}

export interface ApplicationActiveSelectionBasis
  extends ApplicationReadinessActivationBasis {
  readonly activationSequence: bigint;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export interface CoherentActiveApplication {
  readonly selection: ApplicationActiveSelection;
  readonly expectedActiveHead: ApplicationActiveCasToken;
  readonly basis: ApplicationActiveSelectionBasis;
}

export class ApplicationActivationError extends Data.TaggedError(
  "ApplicationActivationError",
)<{
  readonly operation: "activate" | "read" | "validateSelection";
  readonly reason:
    | "invalidInput"
    | "invalidComposition"
    | "notReady"
    | "activeMissing"
    | "alreadyActive"
    | "expectedHead"
    | "scopeAuthority"
    | "concurrentHead"
    | "storedState"
    | "decisionUncertain"
    | "resourceFailure";
  readonly revisionId?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationActivationContext<SchemaFailure, ColdFailure> {
  readonly deploymentId: string;
  readonly readiness: ApplicationReadinessRepository<SchemaFailure, ColdFailure>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly faultAfter?: (
    point: "activationInserted" | "headWritten",
  ) => void;
}

export interface ApplicationActivationRepository<SchemaFailure, ColdFailure> {
  readonly activate: (input: {
    readonly revisionId: string;
    readonly expectedActiveHead: ApplicationActiveCasToken | null;
  }) => Effect.Effect<
    ApplicationActivationReceipt,
    | ApplicationActivationError
    | SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    | TrustedScopeAuthorityError
    | LockScopeClockForUpdateError
  >;
  readonly readActive: () => Effect.Effect<
    CoherentActiveApplication,
    | ApplicationActivationError
    | ReadApplicationReadinessError
    | TrustedScopeAuthorityError
    | LockScopeClockForShareError
  >;
}

interface SelectionState {
  readonly basis: ApplicationActiveSelectionBasis;
}

const selectionStates = new WeakMap<ApplicationActiveSelection, SelectionState>();
interface ApplicationActivationRepositoryState {
  readonly readiness: unknown;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

const activationRepositoryStates = new WeakMap<
  ApplicationActivationRepository<unknown, unknown>,
  ApplicationActivationRepositoryState
>();

export function hasApplicationActivationPlanningComposition(
  repository: ApplicationActivationRepository<unknown, unknown>,
  controlDb: FlarexMetadataDatabase,
  schema: ApplicationSchemaAuthorityPublisher<unknown>,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  const state = activationRepositoryStates.get(repository);
  return state !== undefined && state.authority === authority &&
    hasApplicationReadinessPlanningComposition(
      state.readiness,
      controlDb,
      schema,
      authority,
    );
}

export function claimApplicationActiveSelection(
  selection: unknown,
): Result.Result<ApplicationActiveSelectionBasis, ApplicationActivationError> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(activationError("validateSelection", "invalidComposition"));
  }
  const state = selectionStates.get(selection as ApplicationActiveSelection);
  return state === undefined
    ? Result.fail(activationError("validateSelection", "invalidComposition"))
    : Result.succeed(copySelectionBasis(state.basis));
}

export function makeApplicationActivationRepository<SchemaFailure, ColdFailure>(
  context: ApplicationActivationContext<SchemaFailure, ColdFailure>,
): ApplicationActivationRepository<SchemaFailure, ColdFailure> {
  const captured = Object.freeze({
    deploymentId: context.deploymentId,
    readiness: context.readiness,
    authority: context.authority,
    ...(context.faultAfter === undefined ? {} : { faultAfter: context.faultAfter }),
  });

  const activate = Effect.fn("ApplicationActivation.activate")(
    function* (input: {
      readonly revisionId: string;
      readonly expectedActiveHead: ApplicationActiveCasToken | null;
    }) {
      if (!validIdentity(captured.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* activationFailure("activate", "invalidInput", input.revisionId);
      }
      const expected = yield* Effect.fromResult(
        captureCasToken(input.expectedActiveHead, "activate", input.revisionId),
      );
      if (!hasApplicationReadinessComposition(
        captured.readiness,
        captured.authority,
      )) {
        return yield* activationFailure(
          "activate",
          "invalidComposition",
          input.revisionId,
        );
      }
      const readiness = yield* captured.readiness.settle(Object.freeze({
        deploymentId: captured.deploymentId,
        revisionId: input.revisionId,
      }));
      if (readiness.status !== "ready") {
        return yield* activationFailure("activate", "notReady", input.revisionId);
      }
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
        captured.authority,
      );
      return yield* runLocatedTransaction(
        located.target,
        "activate",
        input.revisionId,
        tx => activateInTransaction(
          tx,
          located.authority,
          captured.readiness,
          readiness,
          expected,
          captured.faultAfter,
        ),
      );
    },
  );

  const readActive = Effect.fn("ApplicationActivation.readActive")(
    function* () {
      if (!validIdentity(captured.deploymentId) ||
        !hasApplicationReadinessComposition(
          captured.readiness,
          captured.authority,
        )) return yield* activationFailure("read", "invalidComposition");
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
        captured.authority,
      );
      const revisionId = yield* runLocatedTransaction(
        located.target,
        "read",
        undefined,
        tx => loadActiveRevisionHint(tx, located.authority.scopeId),
      );
      const readiness = yield* loadReadyForActiveRead(
        captured.readiness,
        captured.deploymentId,
        revisionId,
      );
      const state = yield* runLocatedTransaction(
        located.target,
        "read",
        revisionId,
        tx => readActiveInTransaction(
          tx,
          located.authority,
          captured.readiness,
          readiness,
        ),
      );
      const selection = Object.freeze({}) as ApplicationActiveSelection;
      selectionStates.set(selection, Object.freeze({
        basis: copySelectionBasis(state.basis),
      }));
      return Object.freeze({
        selection,
        expectedActiveHead: copyCasToken(state.expectedActiveHead),
        basis: copySelectionBasis(state.basis),
      });
    },
  );

  const repository = Object.freeze({ activate, readActive });
  activationRepositoryStates.set(repository, Object.freeze({
    readiness: captured.readiness,
    authority: captured.authority,
  }));
  return repository;
}

const loadReadyForActiveRead = Effect.fn(
  "ApplicationActivation.loadReadyForActiveRead",
)(function* <SchemaFailure, ColdFailure>(
  readinessRepository: ApplicationReadinessRepository<SchemaFailure, ColdFailure>,
  deploymentId: string,
  revisionId: string,
) {
  const readiness = yield* readinessRepository.readReady(Object.freeze({
    deploymentId,
    revisionId,
  }));
  if (readiness.status !== "ready") {
    return yield* activationFailure("read", "notReady", revisionId);
  }
  return readiness;
});

export const validateApplicationActiveSelectionInTransaction = Effect.fn(
  "ApplicationActivation.validateSelectionInTransaction",
)(function* (
  selection: unknown,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
) {
  const basis = yield* Effect.fromResult(claimApplicationActiveSelection(selection));
  if (!clockMatches(basis.authority, currentClock)) {
    return yield* activationFailure(
      "validateSelection",
      "scopeAuthority",
      basis.revisionId,
    );
  }
  const rows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeadsV1).where(eq(
      fxSystemApplicationActiveHeadsV1.scopeId,
      basis.authority.scopeId,
    )).limit(1).for("share"),
    "validateSelection",
    basis.revisionId,
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  const head = yield* decodeHead(row, "validateSelection", basis.revisionId);
  if (!headMatchesBasis(head, basis)) {
    return yield* activationFailure(
      "validateSelection",
      "concurrentHead",
      basis.revisionId,
    );
  }
  return copySelectionBasis(basis);
});

const activateInTransaction = Effect.fn("ApplicationActivation.activateTransaction")(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
  expected: ApplicationActiveCasToken | null,
  faultAfter: ApplicationActivationContext<unknown, unknown>["faultAfter"],
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure(
      "activate",
      "scopeAuthority",
      readiness.status === "ready" ? readiness.revisionId : undefined,
    );
  }
  const validated = yield* validateApplicationReadinessForActivationInTransaction(
    readinessRepository,
    readiness,
    tx,
    clock,
  );
  if (validated.status !== "ready") {
    return yield* activationFailure(
      "activate",
      "notReady",
      validated.revisionId,
    );
  }
  const basis = validated.basis;
  const headRows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeadsV1).where(eq(
      fxSystemApplicationActiveHeadsV1.scopeId,
      authority.scopeId,
    )).limit(1).for("update"),
    "activate",
    basis.revisionId,
  );
  const headRow = headRows[0];
  const head = headRow === undefined
    ? null
    : yield* decodeHead(headRow, "activate", basis.revisionId);
  const request = yield* canonicalFrame({
    format: "flarex.application-activation-request",
    version: 1,
    scopeId: authority.scopeId,
    revisionId: basis.revisionId,
    readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256),
    expectedActiveHead: expected === null ? null : {
      activationSequence: expected.activationSequence.toString(),
      headSha256: expected.headSha256,
    },
  }, "activate", basis.revisionId);
  const replayRows = yield* query(
    tx.select().from(fxSystemApplicationActivationsV1).where(and(
      eq(fxSystemApplicationActivationsV1.scopeId, authority.scopeId),
      eq(
        fxSystemApplicationActivationsV1.activationRequestSha256,
        request.sha256,
      ),
    )).limit(1).for("share"),
    "activate",
    basis.revisionId,
  );
  const replay = replayRows[0];
  if (replay !== undefined) {
    const decoded = yield* decodeActivation(replay, "activate", basis.revisionId);
    if (decoded.revisionId !== basis.revisionId ||
      !bytesEqualFullScan(decoded.readinessSha256, basis.readinessSha256) ||
      !bytesEqualFullScan(decoded.activationRequestSha256, request.sha256)) {
      return yield* activationFailure(
        "activate",
        "storedState",
        basis.revisionId,
      );
    }
    return yield* activationReceipt("replayed", replay, decoded, request.sha256);
  }
  if (head !== null && head.revisionId === basis.revisionId &&
    bytesEqualFullScan(head.readinessSha256, basis.readinessSha256)) {
    return yield* activationFailure("activate", "alreadyActive", basis.revisionId);
  }
  if (!expectedMatchesHead(expected, head)) {
    return yield* activationFailure("activate", "expectedHead", basis.revisionId);
  }
  const previousActivationSequence = head?.activationSequence ?? null;
  if (previousActivationSequence === MAX_SEQUENCE) {
    return yield* activationFailure("activate", "storedState", basis.revisionId);
  }
  const activationSequence = previousActivationSequence === null
    ? 1n
    : previousActivationSequence + 1n;
  const activatedAt = yield* databaseTime(
    tx,
    authority.scopeId,
    "activate",
    basis.revisionId,
  );
  const activation = yield* canonicalFrame({
    format: "flarex.application-activation",
    version: 1,
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    previousActivationSequence: previousActivationSequence?.toString() ?? null,
    revisionId: basis.revisionId,
    readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256),
    activationRequestSha256: encodeBytesToLowercaseHex(request.sha256),
    activatedAt: activatedAt.toISOString(),
  }, "activate", basis.revisionId);
  yield* query(
    tx.insert(fxSystemApplicationActivationsV1).values({
      scopeId: authority.scopeId,
      activationSequence,
      previousActivationSequence,
      revisionId: basis.revisionId,
      readinessSha256: copyBytes(basis.readinessSha256),
      activationRequestSha256: copyBytes(request.sha256),
      activationSha256: copyBytes(activation.sha256),
      activationBytes: copyBytes(activation.bytes),
      activatedAt,
    }).returning({
      activationSequence: fxSystemApplicationActivationsV1.activationSequence,
    }),
    "activate",
    basis.revisionId,
  );
  yield* runFault(faultAfter, "activationInserted", basis.revisionId);
  const nextHead = yield* canonicalFrame({
    format: "flarex.application-active-head",
    version: 1,
    scopeId: authority.scopeId,
    activationSequence: activationSequence.toString(),
    revisionId: basis.revisionId,
    readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
  }, "activate", basis.revisionId);
  if (head === null) {
    const inserted = yield* query(
      tx.insert(fxSystemApplicationActiveHeadsV1).values({
        scopeId: authority.scopeId,
        activationSequence,
        revisionId: basis.revisionId,
        readinessSha256: copyBytes(basis.readinessSha256),
        activationSha256: copyBytes(activation.sha256),
        headSha256: copyBytes(nextHead.sha256),
        headBytes: copyBytes(nextHead.bytes),
        createdAt: activatedAt,
        updatedAt: activatedAt,
      }).onConflictDoNothing().returning({
        activationSequence: fxSystemApplicationActiveHeadsV1.activationSequence,
      }),
      "activate",
      basis.revisionId,
    );
    if (inserted.length !== 1) {
      return yield* activationFailure(
        "activate",
        "concurrentHead",
        basis.revisionId,
      );
    }
  } else {
    const updated = yield* query(
      tx.update(fxSystemApplicationActiveHeadsV1).set({
        activationSequence,
        revisionId: basis.revisionId,
        readinessSha256: copyBytes(basis.readinessSha256),
        activationSha256: copyBytes(activation.sha256),
        headSha256: copyBytes(nextHead.sha256),
        headBytes: copyBytes(nextHead.bytes),
        updatedAt: activatedAt,
      }).where(and(
        eq(fxSystemApplicationActiveHeadsV1.scopeId, authority.scopeId),
        eq(
          fxSystemApplicationActiveHeadsV1.activationSequence,
          head.activationSequence,
        ),
        eq(fxSystemApplicationActiveHeadsV1.headSha256, head.headSha256),
      )).returning({
        activationSequence: fxSystemApplicationActiveHeadsV1.activationSequence,
      }),
      "activate",
      basis.revisionId,
    );
    if (updated.length !== 1) {
      return yield* activationFailure(
        "activate",
        "concurrentHead",
        basis.revisionId,
      );
    }
  }
  yield* runFault(faultAfter, "headWritten", basis.revisionId);
  return Object.freeze({
    status: "activated",
    disposition: "inserted",
    scopeId: authority.scopeId,
    revisionId: basis.revisionId,
    activationSequence,
    previousActivationSequence,
    readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256),
    activationSha256: encodeBytesToLowercaseHex(activation.sha256),
    activationRequestSha256: encodeBytesToLowercaseHex(request.sha256),
    expectedActiveHead: Object.freeze({
      activationSequence,
      headSha256: encodeBytesToLowercaseHex(nextHead.sha256),
    }),
    activatedAt: new Date(activatedAt.getTime()),
  } as const);
});

const readActiveInTransaction = Effect.fn("ApplicationActivation.readTransaction")(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  readinessRepository: unknown,
  readiness: ApplicationReadinessResult,
) {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  if (!clockMatches(authority, clock)) {
    return yield* activationFailure("read", "scopeAuthority");
  }
  const validated = yield* validateStoredApplicationReadinessForActivationInTransaction(
    readinessRepository,
    readiness,
    tx,
    clock,
  );
  const basis = validated.basis;
  const rows = yield* query(
    tx.select().from(fxSystemApplicationActiveHeadsV1).where(eq(
      fxSystemApplicationActiveHeadsV1.scopeId,
      authority.scopeId,
    )).limit(1).for("share"),
    "read",
    basis.revisionId,
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* activationFailure("read", "activeMissing", basis.revisionId);
  }
  const head = yield* decodeHead(row, "read", basis.revisionId);
  if (head.revisionId !== basis.revisionId ||
    !bytesEqualFullScan(head.readinessSha256, basis.readinessSha256)) {
    return yield* activationFailure("read", "concurrentHead", basis.revisionId);
  }
  const activationRows = yield* query(
    tx.select().from(fxSystemApplicationActivationsV1).where(and(
      eq(fxSystemApplicationActivationsV1.scopeId, authority.scopeId),
      eq(
        fxSystemApplicationActivationsV1.activationSequence,
        head.activationSequence,
      ),
    )).limit(1).for("share"),
    "read",
    basis.revisionId,
  );
  const activationRow = activationRows[0];
  if (activationRow === undefined) {
    return yield* activationFailure("read", "storedState", basis.revisionId);
  }
  const activation = yield* decodeActivation(
    activationRow,
    "read",
    basis.revisionId,
  );
  if (activation.revisionId !== head.revisionId ||
    !bytesEqualFullScan(activation.readinessSha256, head.readinessSha256) ||
    !bytesEqualFullScan(activation.activationSha256, head.activationSha256)) {
    return yield* activationFailure("read", "storedState", basis.revisionId);
  }
  const selectionBasis = copySelectionBasis(Object.freeze({
    ...basis,
    activationSequence: head.activationSequence,
    activationSha256: copyBytes(head.activationSha256),
    headSha256: copyBytes(head.headSha256),
  }));
  return Object.freeze({
    expectedActiveHead: Object.freeze({
      activationSequence: head.activationSequence,
      headSha256: encodeBytesToLowercaseHex(head.headSha256),
    }),
    basis: selectionBasis,
  });
});

const loadActiveRevisionHint = Effect.fn("ApplicationActivation.loadHeadHint")(
function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
) {
  const rows = yield* query(
    tx.select({ revisionId: fxSystemApplicationActiveHeadsV1.revisionId })
      .from(fxSystemApplicationActiveHeadsV1).where(eq(
        fxSystemApplicationActiveHeadsV1.scopeId,
        scopeId,
      )).limit(1),
    "read",
  );
  if (rows.length !== 1 || !validIdentity(rows[0]?.revisionId ?? "")) {
    return yield* activationFailure("read", "activeMissing");
  }
  return rows[0]!.revisionId;
});

type DecodedHead = DecodedApplicationActiveHead;

interface DecodedActivation {
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly activationRequestSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
}

function decodeHead(
  row: typeof fxSystemApplicationActiveHeadsV1.$inferSelect,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<DecodedHead, ApplicationActivationError> {
  return decodeApplicationActiveHeadRowEffect(row).pipe(Effect.mapError(error =>
    activationError(
      operation,
      error.reason === "resourceFailure" ? "resourceFailure" : "storedState",
      revisionId ?? error.revisionId,
      error.retryable,
      error.cause,
    )
  ));
}

function decodeActivation(
  row: typeof fxSystemApplicationActivationsV1.$inferSelect,
  operation: ApplicationActivationError["operation"],
  revisionId: string,
): Effect.Effect<DecodedActivation, ApplicationActivationError> {
  return Effect.gen(function* () {
    yield* validateStoredFrame(
      row.activationBytes,
      row.activationSha256,
      operation,
      revisionId,
    );
    const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
    if (activatedAt === null) {
      return yield* activationFailure(operation, "storedState", revisionId);
    }
    const expected = {
      format: "flarex.application-activation",
      version: 1,
      scopeId: row.scopeId,
      activationSequence: row.activationSequence.toString(),
      previousActivationSequence:
        row.previousActivationSequence?.toString() ?? null,
      revisionId: row.revisionId,
      readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
      activationRequestSha256:
        encodeBytesToLowercaseHex(row.activationRequestSha256),
      activatedAt: activatedAt.toISOString(),
    };
    const canonical = yield* canonicalFrame(expected, operation, revisionId);
    if (!bytesEqualFullScan(canonical.bytes, row.activationBytes)) {
      return yield* activationFailure(operation, "storedState", revisionId);
    }
    return Object.freeze({
      scopeId: row.scopeId,
      activationSequence: row.activationSequence,
      previousActivationSequence: row.previousActivationSequence,
      revisionId: row.revisionId,
      readinessSha256: copyBytes(row.readinessSha256),
      activationRequestSha256: copyBytes(row.activationRequestSha256),
      activationSha256: copyBytes(row.activationSha256),
    });
  });
}

function activationReceipt(
  disposition: "replayed",
  row: typeof fxSystemApplicationActivationsV1.$inferSelect,
  decoded: DecodedActivation,
  requestSha256: Uint8Array,
): Effect.Effect<ApplicationActivationReceipt, ApplicationActivationError> {
  return Effect.gen(function* () {
    const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
    if (activatedAt === null) {
      return yield* activationFailure(
        "activate",
        "storedState",
        decoded.revisionId,
      );
    }
    const head = yield* canonicalFrame({
      format: "flarex.application-active-head",
      version: 1,
      scopeId: decoded.scopeId,
      activationSequence: decoded.activationSequence.toString(),
      revisionId: decoded.revisionId,
      readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
      activationSha256: encodeBytesToLowercaseHex(decoded.activationSha256),
    }, "activate", decoded.revisionId);
    return Object.freeze({
      status: "activated",
      disposition,
      scopeId: decoded.scopeId,
      revisionId: decoded.revisionId,
      activationSequence: decoded.activationSequence,
      previousActivationSequence: decoded.previousActivationSequence,
      readinessSha256: encodeBytesToLowercaseHex(decoded.readinessSha256),
      activationSha256: encodeBytesToLowercaseHex(decoded.activationSha256),
      activationRequestSha256: encodeBytesToLowercaseHex(requestSha256),
      expectedActiveHead: Object.freeze({
        activationSequence: decoded.activationSequence,
        headSha256: encodeBytesToLowercaseHex(head.sha256),
      }),
      activatedAt: new Date(activatedAt.getTime()),
    });
  });
}

function expectedMatchesHead(
  expected: ApplicationActiveCasToken | null,
  head: DecodedHead | null,
): boolean {
  return expected === null
    ? head === null
    : head !== null && expected.activationSequence === head.activationSequence &&
      expected.headSha256 === encodeBytesToLowercaseHex(head.headSha256);
}

function captureCasToken(
  input: ApplicationActiveCasToken | null,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Result.Result<ApplicationActiveCasToken | null, ApplicationActivationError> {
  if (input === null) return Result.succeed(null);
  return Result.try({
    try: () => {
      if (typeof input !== "object" || Array.isArray(input) ||
        Reflect.ownKeys(input).length !== 2) throw new Error("invalid token");
      const sequence = Object.getOwnPropertyDescriptor(input, "activationSequence");
      const digest = Object.getOwnPropertyDescriptor(input, "headSha256");
      if (sequence === undefined || !("value" in sequence) ||
        sequence.enumerable !== true || typeof sequence.value !== "bigint" ||
        sequence.value < 1n || sequence.value > MAX_SEQUENCE ||
        digest === undefined || !("value" in digest) ||
        digest.enumerable !== true || typeof digest.value !== "string" ||
        !/^[0-9a-f]{64}$/.test(digest.value)) throw new Error("invalid token");
      return Object.freeze({
        activationSequence: sequence.value,
        headSha256: digest.value,
      });
    },
    catch: cause => activationError(
      operation,
      "invalidInput",
      revisionId,
      false,
      cause,
    ),
  });
}

function headMatchesBasis(
  head: DecodedHead,
  basis: ApplicationActiveSelectionBasis,
): boolean {
  return head.scopeId === basis.authority.scopeId &&
    head.activationSequence === basis.activationSequence &&
    head.revisionId === basis.revisionId &&
    bytesEqualFullScan(head.readinessSha256, basis.readinessSha256) &&
    bytesEqualFullScan(head.activationSha256, basis.activationSha256) &&
    bytesEqualFullScan(head.headSha256, basis.headSha256);
}

function clockMatches(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
): boolean {
  return authority.scopeId === clock.scopeId &&
    authority.storageGeneration === clock.storageGeneration &&
    authority.storageGenerationFence === clock.storageGenerationFence &&
    authority.epoch === clock.epoch;
}

function copySelectionBasis(
  basis: ApplicationActiveSelectionBasis,
): ApplicationActiveSelectionBasis {
  return Object.freeze({
    ...basis,
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256),
    manifestSha256: copyBytes(basis.manifestSha256),
    publicationSha256: copyBytes(basis.publicationSha256),
    functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
    applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
    schemaBindingSha256: copyBytes(basis.schemaBindingSha256),
    taskCatalogSha256: copyBytes(basis.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(basis.taskCatalogBindingSha256),
    readinessSha256: copyBytes(basis.readinessSha256),
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

function copyCasToken(token: ApplicationActiveCasToken): ApplicationActiveCasToken {
  return Object.freeze({ ...token });
}

function canonicalFrame(
  value: Readonly<Record<string, unknown>>,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<Readonly<{ bytes: Uint8Array; sha256: Uint8Array }>, ApplicationActivationError> {
  return Effect.gen(function* () {
    if (!isJson(value)) {
      return yield* activationFailure(operation, "storedState", revisionId);
    }
    const bytes = UTF8.encode(encodeCanonicalJson(value, issue => {
      throw new Error(`Application activation frame invariant: ${issue.reason}`);
    }));
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES) {
      return yield* activationFailure(operation, "storedState", revisionId);
    }
    return Object.freeze({ bytes, sha256: yield* sha256(bytes) });
  });
}

function parseFrame(
  bytes: Uint8Array,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<unknown, ApplicationActivationError> {
  return Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => activationError(
      operation,
      "storedState",
      revisionId,
      false,
      cause,
    ),
  });
}

function validateStoredFrame(
  bytes: Uint8Array,
  expectedSha256: Uint8Array,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<void, ApplicationActivationError> {
  return Effect.gen(function* () {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES ||
      !bytesEqualFullScan(yield* sha256(bytes), expectedSha256)) {
      return yield* activationFailure(operation, "storedState", revisionId);
    }
    const parsed = yield* parseFrame(bytes, operation, revisionId);
    if (!isJson(parsed) || !bytesEqualFullScan(
      UTF8.encode(encodeCanonicalJson(parsed, issue => {
        throw new Error(`Stored activation frame invariant: ${issue.reason}`);
      })),
      bytes,
    )) {
      return yield* activationFailure(operation, "storedState", revisionId);
    }
  });
}

function databaseTime(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<Date, ApplicationActivationError> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
    operation,
    revisionId,
  ).pipe(Effect.flatMap(rows => {
    const first = rows[0] as Readonly<Record<string, unknown>> | undefined;
    const value = first === undefined ? null : databaseTimestampFromUnknown(first.now);
    return value === null
      ? activationFailure(operation, "storedState", revisionId)
      : Effect.succeed(value);
  }));
}

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.promise(() =>
    globalThis.crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes))
      .then(value => new Uint8Array(value))
  );
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  operation: ApplicationActivationError["operation"],
  revisionId?: string,
): Effect.Effect<ReadonlyArray<Row>, ApplicationActivationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => activationError(
      operation,
      "resourceFailure",
      revisionId,
      retryableCause(cause),
      cause,
    ),
  });
}

const runLocatedTransaction = Effect.fn("ApplicationActivation.runTransaction")(
function* <A, E>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: "activate" | "read",
  revisionId: string | undefined,
  body: (tx: AppRowTransaction) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | ApplicationActivationError> {
  const rollbackSignal = Object.freeze({ kind: "ApplicationActivationRollback" });
  let callbackCause: Cause.Cause<E> | undefined;
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const result = await Effect.runPromiseExit(body(tx));
    if (Exit.isSuccess(result)) return result.value;
    callbackCause = result.cause;
    throw rollbackSignal;
  });
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => promise,
    catch: cause => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const error = Cause.findErrorOption(settled.cause);
  if (error._tag === "None") {
    return yield* Effect.failCause(Cause.map(
      settled.cause,
      cause => activationError(
        operation,
        "resourceFailure",
        revisionId,
        false,
        cause,
      ),
    ));
  }
  const cause = error.value;
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === rollbackSignal && callbackCause !== undefined) {
    return yield* Effect.failCause(callbackCause);
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" && callbackCause !== undefined) {
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(activationError(
        operation,
        "resourceFailure",
        revisionId,
        false,
        cause,
      )),
    ));
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain") {
    return yield* activationFailure(
      operation,
      "decisionUncertain",
      revisionId,
      false,
      cause,
    );
  }
  return yield* activationFailure(
    operation,
    "resourceFailure",
    revisionId,
    retryableCause(cause),
    cause,
  );
});

function runFault(
  faultAfter: ApplicationActivationContext<unknown, unknown>["faultAfter"],
  point: "activationInserted" | "headWritten",
  revisionId: string,
): Effect.Effect<void, ApplicationActivationError> {
  return faultAfter === undefined
    ? Effect.void
    : Effect.try({
        try: () => faultAfter(point),
        catch: cause => activationError(
          "activate",
          "resourceFailure",
          revisionId,
          false,
          cause,
        ),
      });
}

function validIdentity(value: string): boolean {
  return isNonBlankString(value) && !value.includes("\0") &&
    value.length <= MAX_IDENTITY_BYTES &&
    UTF8.encode(value).byteLength <= MAX_IDENTITY_BYTES;
}

function retryableCause(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}

function activationFailure(
  operation: ApplicationActivationError["operation"],
  reason: ApplicationActivationError["reason"],
  revisionId?: string,
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationActivationError> {
  return Effect.fail(activationError(
    operation,
    reason,
    revisionId,
    retryable,
    cause,
  ));
}

function activationError(
  operation: ApplicationActivationError["operation"],
  reason: ApplicationActivationError["reason"],
  revisionId?: string,
  retryable = false,
  cause?: unknown,
): ApplicationActivationError {
  return new ApplicationActivationError({
    operation,
    reason,
    retryable,
    ...(revisionId === undefined ? {} : { revisionId }),
    ...(cause === undefined ? {} : { cause }),
  });
}
