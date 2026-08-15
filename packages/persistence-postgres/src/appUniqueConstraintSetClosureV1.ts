import {
  bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
  MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
  AppUniqueConstraintSetSha256HexV1Schema,
  appUniqueConstraintSetSha256HexV1ToBytes,
  canonicalizeAppUniqueConstraintSetV1,
  type AppUniqueConstraintSetMemberV1,
  type AppUniqueConstraintSetSha256HexV1,
  type CanonicalAppUniqueConstraintSetV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";

import {
  listAppUniqueConstraintDefinitionSetMembersV1Effect,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "./appUniqueConstraintDefinitions";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  lockSchemaManifestBindingDeploymentEffect,
  type SchemaManifestTableBindingPersistenceError,
} from "./schemaManifestTableBindings";
import {
  fxControlSchemaVersionUniqueConstraintSets,
  fxControlSchemaVersions,
} from "./schema";
import {
  readSchemaVersionArtifactByIdEffect,
  type SchemaVersionArtifactCorruptionError,
  type SchemaVersionArtifactPersistenceError,
} from "./schemaVersionArtifacts";
import type {
  StableTableCatalogDeploymentNotFoundError,
  StableTableCatalogTransaction,
} from "./stableTableCatalog";

const INPUT_KEYS = Object.freeze(["deploymentId", "schemaVersionId"] as const);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeSetSha256HexResult = Schema.decodeUnknownResult(
  AppUniqueConstraintSetSha256HexV1Schema,
);

export interface PrepareAppUniqueConstraintSetClosureV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

const preparedBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppUniqueConstraintSetClosureV1",
);
export interface PreparedAppUniqueConstraintSetClosureV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly [preparedBrand]: true;
}

interface PreparedState {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly manifestSha256: Uint8Array;
  readonly canonical: CanonicalAppUniqueConstraintSetV1;
}

const preparedStates = new WeakMap<
  PreparedAppUniqueConstraintSetClosureV1,
  PreparedState
>();

export interface AppUniqueConstraintSetClosureRecordV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly definitionCount: number;
  readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
  readonly closedAt: Date;
}

export interface CloseAppUniqueConstraintSetV1Result {
  readonly status: "closed" | "replayed";
  readonly closure: AppUniqueConstraintSetClosureRecordV1;
  readonly members: ReadonlyArray<AppUniqueConstraintSetMemberV1>;
}

export interface LocatedAppUniqueConstraintSetClosureV1 {
  readonly closure: AppUniqueConstraintSetClosureRecordV1;
  readonly members: ReadonlyArray<AppUniqueConstraintSetMemberV1>;
}

export class InvalidAppUniqueConstraintSetClosureInputV1Error
  extends Data.TaggedError("InvalidAppUniqueConstraintSetClosureInputV1Error")<{
    readonly field: "input" | "deploymentId" | "schemaVersionId";
  }> {}

export class InvalidPreparedAppUniqueConstraintSetClosureV1Error
  extends Data.TaggedError(
    "InvalidPreparedAppUniqueConstraintSetClosureV1Error",
  )<{}> {}

export class AppUniqueConstraintSetClosureParentV1Error
  extends Data.TaggedError("AppUniqueConstraintSetClosureParentV1Error")<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }> {}

export class AppUniqueConstraintSetChangedV1Error
  extends Data.TaggedError("AppUniqueConstraintSetChangedV1Error")<{
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
  }> {}

export class AppUniqueConstraintSetClosureCorruptionV1Error
  extends Data.TaggedError("AppUniqueConstraintSetClosureCorruptionV1Error")<{
    readonly detail: string;
    readonly cause?: unknown;
  }> {}

export class AppUniqueConstraintSetClosurePersistenceV1Error
  extends Data.TaggedError("AppUniqueConstraintSetClosurePersistenceV1Error")<{
    readonly operation: string;
    readonly cause: unknown;
  }> {}

export type PrepareAppUniqueConstraintSetClosureV1Error =
  | InvalidAppUniqueConstraintSetClosureInputV1Error
  | AppUniqueConstraintSetClosureParentV1Error
  | ReadAppUniqueConstraintDefinitionV1Error
  | SchemaVersionArtifactCorruptionError
  | SchemaVersionArtifactPersistenceError;

export type CloseAppUniqueConstraintSetV1Error =
  | InvalidPreparedAppUniqueConstraintSetClosureV1Error
  | AppUniqueConstraintSetClosureParentV1Error
  | AppUniqueConstraintSetChangedV1Error
  | AppUniqueConstraintSetClosureCorruptionV1Error
  | AppUniqueConstraintSetClosurePersistenceV1Error
  | ReadAppUniqueConstraintDefinitionV1Error
  | SchemaManifestTableBindingPersistenceError
  | StableTableCatalogDeploymentNotFoundError;

export type EnsureAppUniqueConstraintSetClosureV1Error =
  | PrepareAppUniqueConstraintSetClosureV1Error
  | CloseAppUniqueConstraintSetV1Error;

export type ReadAppUniqueConstraintSetClosureV1Error =
  | AppUniqueConstraintSetClosureCorruptionV1Error
  | AppUniqueConstraintSetClosurePersistenceV1Error
  | ReadAppUniqueConstraintDefinitionV1Error;

export const readAppUniqueConstraintSetClosureV1Effect = Effect.fn(
  "AppUniqueConstraintSetClosure.read",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<
  LocatedAppUniqueConstraintSetClosureV1 | null,
  ReadAppUniqueConstraintSetClosureV1Error
> {
  const rows = yield* queryEffect("readClosure", () =>
    db.select().from(fxControlSchemaVersionUniqueConstraintSets).where(and(
      eq(fxControlSchemaVersionUniqueConstraintSets.deploymentId, deploymentId),
      eq(
        fxControlSchemaVersionUniqueConstraintSets.schemaVersionId,
        schemaVersionId,
      ),
    )).limit(1));
  const row = rows[0];
  if (row === undefined) return null;
  const closure = yield* decodeClosureRowEffect(row);
  const members = yield* listAppUniqueConstraintDefinitionSetMembersV1Effect(
    db,
    deploymentId,
    schemaVersionId,
    MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
  );
  const canonical = yield* Effect.promise(() =>
    canonicalizeAppUniqueConstraintSetV1(members)
  );
  if (
    canonical.memberCount !== closure.definitionCount ||
    canonical.sha256Hex !== closure.definitionSetSha256Hex
  ) {
    return yield* Effect.fail(corruption("closure no longer matches bindings"));
  }
  return Object.freeze({ closure, members: canonical.members });
});

export const prepareAppUniqueConstraintSetClosureV1Effect = Effect.fn(
  "AppUniqueConstraintSetClosure.prepare",
)(function* (
  db: FlarexMetadataDatabase,
  input: PrepareAppUniqueConstraintSetClosureV1Input,
): Effect.fn.Return<
  PreparedAppUniqueConstraintSetClosureV1,
  PrepareAppUniqueConstraintSetClosureV1Error
> {
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const artifact = yield* readSchemaVersionArtifactByIdEffect(
    db,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  if (artifact === null) {
    return yield* Effect.fail(new AppUniqueConstraintSetClosureParentV1Error({
      deploymentId: decoded.deploymentId,
      schemaVersionId: decoded.schemaVersionId,
    }));
  }
  const members = yield* listAppUniqueConstraintDefinitionSetMembersV1Effect(
    db,
    decoded.deploymentId,
    decoded.schemaVersionId,
    MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
  );
  const canonical = yield* Effect.promise(() =>
    canonicalizeAppUniqueConstraintSetV1(members)
  );
  const token = Object.freeze({
    ...decoded,
    [preparedBrand]: true,
  } satisfies PreparedAppUniqueConstraintSetClosureV1);
  preparedStates.set(token, Object.freeze({
    ...decoded,
    manifestSha256: copyBytes(artifact.manifestSha256),
    canonical,
  }));
  return token;
});

export const closeAppUniqueConstraintSetV1InTransactionEffect = Effect.fn(
  "AppUniqueConstraintSetClosure.closeInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  prepared: PreparedAppUniqueConstraintSetClosureV1,
): Effect.fn.Return<
  CloseAppUniqueConstraintSetV1Result,
  CloseAppUniqueConstraintSetV1Error
> {
  const state = preparedStates.get(prepared);
  if (state === undefined) {
    return yield* Effect.fail(
      new InvalidPreparedAppUniqueConstraintSetClosureV1Error(),
    );
  }
  yield* lockSchemaManifestBindingDeploymentEffect(tx, state.deploymentId);
  yield* verifySchemaParentEffect(tx, state);
  const currentMembers = yield*
    listAppUniqueConstraintDefinitionSetMembersV1Effect(
      tx,
      state.deploymentId,
      state.schemaVersionId,
      MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
    );
  if (!membersEqual(currentMembers, state.canonical.members)) {
    return yield* Effect.fail(new AppUniqueConstraintSetChangedV1Error({
      deploymentId: state.deploymentId,
      schemaVersionId: state.schemaVersionId,
    }));
  }

  const existingRows = yield* queryEffect("readClosure", () =>
    tx.select().from(fxControlSchemaVersionUniqueConstraintSets).where(and(
      eq(
        fxControlSchemaVersionUniqueConstraintSets.deploymentId,
        state.deploymentId,
      ),
      eq(
        fxControlSchemaVersionUniqueConstraintSets.schemaVersionId,
        state.schemaVersionId,
      ),
    )).limit(1));
  const existing = existingRows[0];
  if (existing !== undefined) {
    const closure = yield* decodeClosureRowEffect(existing);
    if (
      closure.definitionCount !== state.canonical.memberCount ||
      closure.definitionSetSha256Hex !== state.canonical.sha256Hex
    ) {
      return yield* Effect.fail(corruption("stored closure disagrees with set"));
    }
    return Object.freeze({
      status: "replayed" as const,
      closure,
      members: state.canonical.members,
    });
  }

  const inserted = yield* queryEffect("insertClosure", () =>
    tx.insert(fxControlSchemaVersionUniqueConstraintSets).values({
      deploymentId: state.deploymentId,
      schemaVersionId: state.schemaVersionId,
      setCodecVersion: state.canonical.codecVersion,
      definitionCount: state.canonical.memberCount,
      definitionSetSha256: appUniqueConstraintSetSha256HexV1ToBytes(
        state.canonical.sha256Hex,
      ),
    }).returning());
  const row = inserted[0];
  if (row === undefined) {
    return yield* Effect.fail(corruption("closure insert returned no row"));
  }
  return Object.freeze({
    status: "closed" as const,
    closure: yield* decodeClosureRowEffect(row),
    members: state.canonical.members,
  });
});

/** Prepare and close the immutable set through one rollback-safe owner call. */
export const ensureAppUniqueConstraintSetClosureV1Effect = Effect.fn(
  "AppUniqueConstraintSetClosure.ensure",
)(function* (
  db: FlarexMetadataDatabase,
  input: PrepareAppUniqueConstraintSetClosureV1Input,
): Effect.fn.Return<
  CloseAppUniqueConstraintSetV1Result,
  EnsureAppUniqueConstraintSetClosureV1Error
> {
  const prepared = yield* prepareAppUniqueConstraintSetClosureV1Effect(
    db,
    input,
  );
  return yield* runEffectTransaction<
    CloseAppUniqueConstraintSetV1Result,
    CloseAppUniqueConstraintSetV1Error,
    AppUniqueConstraintSetClosurePersistenceV1Error,
    StableTableCatalogTransaction
  >(
    callback => db.transaction(tx => callback(tx)),
    "Application unique-constraint set closure rolled back.",
    tx => closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
    cause => new AppUniqueConstraintSetClosurePersistenceV1Error({
      operation: "closeTransaction",
      cause,
    }),
  );
});

function decodeInputResult(input: PrepareAppUniqueConstraintSetClosureV1Input) {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(invalidInput("input"));
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(invalidInput("deploymentId"));
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError(() => invalidInput("schemaVersionId")));
    return Object.freeze({
      deploymentId: input.deploymentId,
      schemaVersionId,
    });
  });
}

function invalidInput(
  field: InvalidAppUniqueConstraintSetClosureInputV1Error["field"],
) {
  return new InvalidAppUniqueConstraintSetClosureInputV1Error({ field });
}

function verifySchemaParentEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
) {
  return Effect.gen(function* () {
    const rows = yield* queryEffect("readSchemaParent", () =>
      tx.select({
        manifestSha256: fxControlSchemaVersions.manifestSha256,
      }).from(fxControlSchemaVersions).where(and(
        eq(fxControlSchemaVersions.deploymentId, state.deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, state.schemaVersionId),
      )).limit(1));
    const digest = rows[0]?.manifestSha256;
    if (digest === undefined) {
      return yield* Effect.fail(new AppUniqueConstraintSetClosureParentV1Error({
        deploymentId: state.deploymentId,
        schemaVersionId: state.schemaVersionId,
      }));
    }
    if (!isUint8Array(digest) || !bytesEqual(digest, state.manifestSha256)) {
      return yield* Effect.fail(corruption("schema commitment changed"));
    }
  });
}

function decodeClosureRowEffect(
  row: typeof fxControlSchemaVersionUniqueConstraintSets.$inferSelect,
) {
  return Effect.gen(function* () {
    if (
      row.setCodecVersion !== APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1 ||
      !Number.isSafeInteger(row.definitionCount) ||
      row.definitionCount < 0 ||
      row.definitionCount > MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1 ||
      !isUint8Array(row.definitionSetSha256) ||
      row.definitionSetSha256.byteLength !== 32
    ) {
      return yield* Effect.fail(corruption("stored closure shape is invalid"));
    }
    const closedAt = copyFiniteDate(row.closedAt);
    if (closedAt === undefined) {
      return yield* Effect.fail(corruption("stored closure time is invalid"));
    }
    const definitionSetSha256Hex = yield* Effect.fromResult(
      decodeSetSha256HexResult(
        encodeBytesToLowercaseHex(row.definitionSetSha256),
      ).pipe(
        Result.mapError((cause) => corruption("stored closure digest is invalid", cause)),
      ),
    );
    return Object.freeze({
      deploymentId: row.deploymentId,
      schemaVersionId: row.schemaVersionId,
      definitionCount: row.definitionCount,
      definitionSetSha256Hex,
      closedAt,
    } satisfies AppUniqueConstraintSetClosureRecordV1);
  });
}

function membersEqual(
  left: ReadonlyArray<AppUniqueConstraintSetMemberV1>,
  right: ReadonlyArray<AppUniqueConstraintSetMemberV1>,
): boolean {
  return left.length === right.length && left.every((member, index) => {
    const expected = right[index];
    return expected !== undefined &&
      member.logicalUniqueConstraintId === expected.logicalUniqueConstraintId &&
      member.uniqueConstraintDefinitionId ===
        expected.uniqueConstraintDefinitionId &&
      member.tableId === expected.tableId &&
      member.physicalSpecSha256Hex === expected.physicalSpecSha256Hex;
  });
}

function queryEffect<A>(operation: string, query: () => Promise<A>) {
  return Effect.tryPromise({
    try: query,
    catch: (cause) =>
      new AppUniqueConstraintSetClosurePersistenceV1Error({ operation, cause }),
  }).pipe(Effect.uninterruptible);
}

function corruption(detail: string, cause?: unknown) {
  return new AppUniqueConstraintSetClosureCorruptionV1Error({ detail, cause });
}
