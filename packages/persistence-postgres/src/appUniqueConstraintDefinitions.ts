import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  CatalogTableIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
  CatalogUniqueConstraintIdSchema,
  MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID,
  MAX_CATALOG_UNIQUE_CONSTRAINT_ID,
  type CatalogTableId,
  type CatalogUniqueConstraintDefinitionId,
  type CatalogUniqueConstraintId,
} from "flarex-protocol/catalog";
import {
  appUniqueConstraintSpecSha256HexV1ToBytes,
  canonicalAppUniqueConstraintSpecBytesHexV1ToBytes,
  canonicalizeAppUniqueConstraintPhysicalSpecV1,
  decodeAppUniqueConstraintPhysicalSpecV1Result,
  type AppUniqueConstraintPhysicalSpecCodecVersion,
  type AppUniqueConstraintPhysicalSpecV1,
  type AppUniqueConstraintSpecSha256HexV1,
  type CanonicalAppUniqueConstraintPhysicalSpecV1,
  type CanonicalAppUniqueConstraintSpecBytesHexV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  CatalogSchemaVersionIdSchema,
  SchemaManifestAppIndexDescriptorSchema,
  decodeSchemaManifestAppSchemaV1Result,
  type CatalogSchemaVersionId,
  type SchemaManifestAppIndexDescriptor,
} from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";

import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  lockSchemaManifestBindingDeploymentEffect,
  type SchemaManifestTableBindingPersistenceError,
} from "./schemaManifestTableBindings";
import {
  fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersions,
  fxControlScopes,
  fxControlTables,
  fxControlUniqueConstraintDefinitions,
  fxControlUniqueConstraints,
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

const PREPARE_KEYS = Object.freeze([
  "deploymentId",
  "schemaVersionId",
  "tableId",
  "descriptor",
  "physicalSpec",
]);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeTableIdResult = Schema.decodeUnknownResult(CatalogTableIdSchema);
const decodeLogicalIdResult = Schema.decodeUnknownResult(
  CatalogUniqueConstraintIdSchema,
);
const decodeDefinitionIdResult = Schema.decodeUnknownResult(
  CatalogUniqueConstraintDefinitionIdSchema,
);
const decodeDescriptorResult = Schema.decodeUnknownResult(
  SchemaManifestAppIndexDescriptorSchema,
);

export interface PrepareAppUniqueConstraintDefinitionBindingV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
  readonly physicalSpec: AppUniqueConstraintPhysicalSpecV1;
  readonly logicalUniqueConstraintId?: never;
  readonly uniqueConstraintDefinitionId?: never;
  readonly requiredForActivation?: never;
}

const preparedBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppUniqueConstraintDefinitionBindingV1",
);
export interface PreparedAppUniqueConstraintDefinitionBindingV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
  readonly [preparedBrand]: true;
}

interface PreparedState {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
  readonly manifestSha256: Uint8Array;
  readonly canonical: CanonicalAppUniqueConstraintPhysicalSpecV1;
}
const preparedStates = new WeakMap<
  PreparedAppUniqueConstraintDefinitionBindingV1,
  PreparedState
>();

export interface AppUniqueConstraintIdentityRecordV1 {
  readonly deploymentId: string;
  readonly logicalUniqueConstraintId: CatalogUniqueConstraintId;
  readonly tableId: CatalogTableId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
  readonly createdAt: Date;
}

export interface AppUniqueConstraintDefinitionRecordV1 {
  readonly deploymentId: string;
  readonly uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId;
  readonly logicalUniqueConstraintId: CatalogUniqueConstraintId;
  readonly tableId: CatalogTableId;
  readonly physicalSpecCodecVersion: AppUniqueConstraintPhysicalSpecCodecVersion;
  readonly physicalSpec: AppUniqueConstraintPhysicalSpecV1;
  readonly physicalSpecBytesHex: CanonicalAppUniqueConstraintSpecBytesHexV1;
  readonly physicalSpecSha256Hex: AppUniqueConstraintSpecSha256HexV1;
  readonly createdAt: Date;
}

const locatedDefinitionBrand: unique symbol = Symbol(
  "FlarexDB/LocatedAppUniqueConstraintDefinitionV1",
);

export interface LocatedAppUniqueConstraintDefinitionV1
  extends AppUniqueConstraintDefinitionRecordV1 {
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly [locatedDefinitionBrand]: true;
}

const locatedDefinitions = new WeakSet<object>();

export function isLocatedAppUniqueConstraintDefinitionV1(
  value: unknown,
): value is LocatedAppUniqueConstraintDefinitionV1 {
  return typeof value === "object" && value !== null &&
    locatedDefinitions.has(value);
}

export interface AppSchemaVersionUniqueConstraintBindingRecordV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly logicalUniqueConstraintId: CatalogUniqueConstraintId;
  readonly uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId;
  readonly requiredForActivation: true;
  readonly createdAt: Date;
}

export interface EnsureAppUniqueConstraintDefinitionBindingV1Result {
  readonly identityStatus: "created" | "existing";
  readonly definitionStatus: "created" | "existing";
  readonly bindingStatus: "created" | "existing";
  readonly identity: AppUniqueConstraintIdentityRecordV1;
  readonly definition: AppUniqueConstraintDefinitionRecordV1;
  readonly binding: AppSchemaVersionUniqueConstraintBindingRecordV1;
}

export class InvalidAppUniqueConstraintDefinitionInputError extends Data.TaggedError(
  "InvalidAppUniqueConstraintDefinitionInputError",
)<{ readonly field: string }> {}

export class InvalidPreparedAppUniqueConstraintDefinitionError extends Data.TaggedError(
  "InvalidPreparedAppUniqueConstraintDefinitionError",
)<{}> {}

export class AppUniqueConstraintCatalogParentError extends Data.TaggedError(
  "AppUniqueConstraintCatalogParentError",
)<{
  readonly parent: "schemaVersion" | "table" | "schemaTableBinding";
  readonly deploymentId: string;
}> {}

export class AppUniqueConstraintCatalogCorruptionError extends Data.TaggedError(
  "AppUniqueConstraintCatalogCorruptionError",
)<{ readonly detail: string; readonly cause?: unknown }> {}

export class AppUniqueConstraintCatalogPersistenceError extends Data.TaggedError(
  "AppUniqueConstraintCatalogPersistenceError",
)<{ readonly operation: string; readonly cause: unknown }> {}

export class AppUniqueConstraintCatalogIdExhaustedError extends Data.TaggedError(
  "AppUniqueConstraintCatalogIdExhaustedError",
)<{ readonly identity: "logical" | "definition" }> {}

export class AppSchemaVersionUniqueConstraintBindingConflictError extends Data.TaggedError(
  "AppSchemaVersionUniqueConstraintBindingConflictError",
)<{
  readonly existingDefinitionId: CatalogUniqueConstraintDefinitionId;
  readonly requestedDefinitionId: CatalogUniqueConstraintDefinitionId | null;
}> {}

export type PrepareAppUniqueConstraintDefinitionBindingV1Error =
  | InvalidAppUniqueConstraintDefinitionInputError
  | AppUniqueConstraintCatalogParentError
  | AppUniqueConstraintCatalogCorruptionError
  | SchemaVersionArtifactCorruptionError
  | SchemaVersionArtifactPersistenceError;

export type EnsureAppUniqueConstraintDefinitionBindingV1Error =
  | InvalidPreparedAppUniqueConstraintDefinitionError
  | AppUniqueConstraintCatalogParentError
  | AppUniqueConstraintCatalogCorruptionError
  | AppUniqueConstraintCatalogPersistenceError
  | AppUniqueConstraintCatalogIdExhaustedError
  | AppSchemaVersionUniqueConstraintBindingConflictError
  | SchemaManifestTableBindingPersistenceError
  | StableTableCatalogDeploymentNotFoundError;

export type ReadAppUniqueConstraintDefinitionV1Error =
  | AppUniqueConstraintCatalogCorruptionError
  | AppUniqueConstraintCatalogPersistenceError;

/**
 * Package-private C08-B2 locator for the exact touched-table unique definition
 * set of one pinned schema. Returned definitions are opaque process-local
 * capabilities; the immutable catalog evidence remains the source of truth.
 */
export const locateAppUniqueConstraintDefinitionsForSchemaEffect = Effect.fn(
  "AppUniqueConstraintDefinitions.locateForSchema",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
  tableIds: ReadonlyArray<CatalogTableId>,
  maximumDefinitions: number,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1> | null,
  ReadAppUniqueConstraintDefinitionV1Error
> {
  const scopeRows = yield* queryEffect("readScopeDeployment", () =>
    db.select({ deploymentId: fxControlScopes.deploymentId })
      .from(fxControlScopes)
      .where(eq(fxControlScopes.scopeId, scopeId))
      .limit(1));
  if (scopeRows[0]?.deploymentId !== deploymentId) return null;
  if (tableIds.length === 0) return Object.freeze([]);

  const rows = yield* queryEffect("listSchemaDefinitions", () =>
    db.select({
      definition: fxControlUniqueConstraintDefinitions,
      binding: fxControlSchemaVersionUniqueConstraintBindings,
    }).from(fxControlSchemaVersionUniqueConstraintBindings)
      .innerJoin(fxControlUniqueConstraintDefinitions, and(
        eq(
          fxControlUniqueConstraintDefinitions.deploymentId,
          fxControlSchemaVersionUniqueConstraintBindings.deploymentId,
        ),
        eq(
          fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId,
          fxControlSchemaVersionUniqueConstraintBindings
            .uniqueConstraintDefinitionId,
        ),
        eq(
          fxControlUniqueConstraintDefinitions.logicalUniqueConstraintId,
          fxControlSchemaVersionUniqueConstraintBindings
            .logicalUniqueConstraintId,
        ),
      ))
      .where(and(
        eq(
          fxControlSchemaVersionUniqueConstraintBindings.deploymentId,
          deploymentId,
        ),
        eq(
          fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId,
          schemaVersionId,
        ),
        inArray(fxControlUniqueConstraintDefinitions.tableId, tableIds),
      ))
      .orderBy(
        fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId,
      )
      .limit(maximumDefinitions + 1));
  if (rows.length > maximumDefinitions) return null;

  const located: LocatedAppUniqueConstraintDefinitionV1[] = [];
  for (const row of rows) {
    const definition = yield* decodeDefinitionRow(row.definition);
    const binding = yield* decodeBindingRow(row.binding);
    if (
      definition.deploymentId !== deploymentId ||
      binding.deploymentId !== deploymentId ||
      binding.schemaVersionId !== schemaVersionId ||
      binding.logicalUniqueConstraintId !==
        definition.logicalUniqueConstraintId ||
      binding.uniqueConstraintDefinitionId !==
        definition.uniqueConstraintDefinitionId
    ) return null;
    located.push(markLocatedDefinition(scopeId, schemaVersionId, definition));
  }
  return Object.freeze(located);
});

export const prepareAppUniqueConstraintDefinitionBindingV1Effect = Effect.fn(
  "AppUniqueConstraintDefinitions.prepareBinding",
)(function* (
  db: FlarexMetadataDatabase,
  input: PrepareAppUniqueConstraintDefinitionBindingV1Input,
): Effect.fn.Return<
  PreparedAppUniqueConstraintDefinitionBindingV1,
  PrepareAppUniqueConstraintDefinitionBindingV1Error
> {
  const decoded = yield* Effect.fromResult(decodePrepareInputResult(input));
  const artifact = yield* readSchemaVersionArtifactByIdEffect(
    db,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  if (artifact === null) {
    return yield* Effect.fail(new AppUniqueConstraintCatalogParentError({
      parent: "schemaVersion",
      deploymentId: decoded.deploymentId,
    }));
  }
  const manifest = yield* Effect.fromResult(
    decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(
      Result.mapError((cause) =>
        corruption("stored schema artifact is not app-schema v1", cause)
      ),
    ),
  );
  if (
    !manifest.tableDefinitions.tables.some((table) =>
      table.tableId === decoded.tableId && table.namespace === "app"
    )
  ) {
    return yield* Effect.fail(new AppUniqueConstraintCatalogParentError({
      parent: "schemaTableBinding",
      deploymentId: decoded.deploymentId,
    }));
  }
  const canonical = yield* Effect.promise(() =>
    canonicalizeAppUniqueConstraintPhysicalSpecV1(decoded.physicalSpec)
  );
  const token = Object.freeze({
    deploymentId: decoded.deploymentId,
    schemaVersionId: decoded.schemaVersionId,
    tableId: decoded.tableId,
    descriptor: decoded.descriptor,
    [preparedBrand]: true,
  } satisfies PreparedAppUniqueConstraintDefinitionBindingV1);
  preparedStates.set(token, Object.freeze({
    ...decoded,
    manifestSha256: new Uint8Array(artifact.manifestSha256),
    canonical,
  }));
  return token;
});

export const ensureAppUniqueConstraintDefinitionBindingV1InTransaction =
  Effect.fn("AppUniqueConstraintDefinitions.ensureBindingInTransaction")(
    function* (
      tx: StableTableCatalogTransaction,
      prepared: PreparedAppUniqueConstraintDefinitionBindingV1,
    ): Effect.fn.Return<
      EnsureAppUniqueConstraintDefinitionBindingV1Result,
      EnsureAppUniqueConstraintDefinitionBindingV1Error
    > {
      const state = preparedStates.get(prepared);
      if (state === undefined) {
        return yield* Effect.fail(
          new InvalidPreparedAppUniqueConstraintDefinitionError(),
        );
      }
      yield* lockSchemaManifestBindingDeploymentEffect(tx, state.deploymentId);
      yield* verifyParentsEffect(tx, state);

      const ensuredIdentity = yield* ensureLogicalIdentityEffect(tx, state);
      const existingDefinition = yield* findDefinitionEffect(
        tx,
        state,
        ensuredIdentity.identity.logicalUniqueConstraintId,
      );
      const existingBinding = yield* readBindingEffect(
        tx,
        state,
        ensuredIdentity.identity.logicalUniqueConstraintId,
      );
      if (existingBinding !== null) {
        if (
          existingDefinition !== null &&
          existingBinding.uniqueConstraintDefinitionId ===
            existingDefinition.uniqueConstraintDefinitionId
        ) {
          return Object.freeze({
            identityStatus: ensuredIdentity.status,
            definitionStatus: "existing",
            bindingStatus: "existing",
            identity: ensuredIdentity.identity,
            definition: existingDefinition,
            binding: existingBinding,
          });
        }
        return yield* Effect.fail(
          new AppSchemaVersionUniqueConstraintBindingConflictError({
            existingDefinitionId: existingBinding.uniqueConstraintDefinitionId,
            requestedDefinitionId:
              existingDefinition?.uniqueConstraintDefinitionId ?? null,
          }),
        );
      }

      const ensuredDefinition = existingDefinition === null
        ? yield* insertDefinitionEffect(
          tx,
          state,
          ensuredIdentity.identity.logicalUniqueConstraintId,
        )
        : Object.freeze({ status: "existing" as const, definition: existingDefinition });
      const binding = yield* insertBindingEffect(
        tx,
        state,
        ensuredIdentity.identity.logicalUniqueConstraintId,
        ensuredDefinition.definition.uniqueConstraintDefinitionId,
      );
      return Object.freeze({
        identityStatus: ensuredIdentity.status,
        definitionStatus: ensuredDefinition.status,
        bindingStatus: "created",
        identity: ensuredIdentity.identity,
        definition: ensuredDefinition.definition,
        binding,
      });
    },
  );

function decodePrepareInputResult(
  input: PrepareAppUniqueConstraintDefinitionBindingV1Input,
): Result.Result<
  {
    readonly deploymentId: string;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly tableId: CatalogTableId;
    readonly descriptor: SchemaManifestAppIndexDescriptor;
    readonly physicalSpec: AppUniqueConstraintPhysicalSpecV1;
  },
  InvalidAppUniqueConstraintDefinitionInputError
> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, PREPARE_KEYS)) {
      return yield* Result.fail(invalidInput("input"));
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(invalidInput("deploymentId"));
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError(() => invalidInput("schemaVersionId")));
    const tableId = yield* decodeTableIdResult(input.tableId).pipe(
      Result.mapError(() => invalidInput("tableId")),
    );
    const descriptor = yield* decodeDescriptorResult(input.descriptor).pipe(
      Result.mapError(() => invalidInput("descriptor")),
    );
    const physicalSpec = yield* decodeAppUniqueConstraintPhysicalSpecV1Result(
      input.physicalSpec,
    ).pipe(Result.mapError(() => invalidInput("physicalSpec")));
    return Object.freeze({
      deploymentId: input.deploymentId,
      schemaVersionId,
      tableId,
      descriptor,
      physicalSpec,
    });
  });
}

function invalidInput(field: string) {
  return new InvalidAppUniqueConstraintDefinitionInputError({ field });
}

function queryEffect<A>(operation: string, query: () => Promise<A>) {
  return Effect.tryPromise({
    try: query,
    catch: (cause) =>
      new AppUniqueConstraintCatalogPersistenceError({ operation, cause }),
  }).pipe(Effect.uninterruptible);
}

function verifyParentsEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
) {
  return Effect.gen(function* () {
    const schemaRows = yield* queryEffect("readSchemaParent", () =>
      tx.select({
        schemaVersionId: fxControlSchemaVersions.schemaVersionId,
        manifestSha256: fxControlSchemaVersions.manifestSha256,
      })
        .from(fxControlSchemaVersions)
        .where(and(
          eq(fxControlSchemaVersions.deploymentId, state.deploymentId),
          eq(fxControlSchemaVersions.schemaVersionId, state.schemaVersionId),
        )).limit(1));
    const schemaRow = schemaRows[0];
    if (schemaRow === undefined) {
      return yield* Effect.fail(new AppUniqueConstraintCatalogParentError({
        parent: "schemaVersion",
        deploymentId: state.deploymentId,
      }));
    }
    if (
      !isUint8Array(schemaRow.manifestSha256) ||
      !bytesEqual(schemaRow.manifestSha256, state.manifestSha256)
    ) {
      return yield* Effect.fail(
        corruption("schema manifest commitment changed after preparation"),
      );
    }
    const tableRows = yield* queryEffect("readTableParent", () =>
      tx.select({ namespace: fxControlTables.namespace })
        .from(fxControlTables)
        .where(and(
          eq(fxControlTables.deploymentId, state.deploymentId),
          eq(fxControlTables.tableId, state.tableId),
        )).limit(1));
    if (tableRows[0]?.namespace !== "app") {
      return yield* Effect.fail(new AppUniqueConstraintCatalogParentError({
        parent: "table",
        deploymentId: state.deploymentId,
      }));
    }
  });
}

function ensureLogicalIdentityEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
) {
  return Effect.gen(function* () {
    const rows = yield* queryEffect("readLogicalIdentity", () =>
      tx.select().from(fxControlUniqueConstraints).where(and(
        eq(fxControlUniqueConstraints.deploymentId, state.deploymentId),
        eq(fxControlUniqueConstraints.tableId, state.tableId),
        eq(fxControlUniqueConstraints.descriptor, state.descriptor),
      )).limit(1));
    const existing = rows[0];
    if (existing !== undefined) {
      return Object.freeze({
        status: "existing" as const,
        identity: yield* decodeIdentityRow(existing),
      });
    }
    const highRows = yield* queryEffect("readLogicalHighWater", () =>
      tx.select({ id: fxControlUniqueConstraints.logicalUniqueConstraintId })
        .from(fxControlUniqueConstraints)
        .where(eq(fxControlUniqueConstraints.deploymentId, state.deploymentId))
        .orderBy(desc(fxControlUniqueConstraints.logicalUniqueConstraintId))
        .limit(1));
    const current = highRows[0]?.id ?? 0;
    if (current >= MAX_CATALOG_UNIQUE_CONSTRAINT_ID) {
      return yield* Effect.fail(
        new AppUniqueConstraintCatalogIdExhaustedError({ identity: "logical" }),
      );
    }
    const logicalUniqueConstraintId = yield* Effect.fromResult(
      decodeLogicalIdResult(current + 1).pipe(
        Result.mapError((cause) => corruption("invalid logical high-water", cause)),
      ),
    );
    const inserted = yield* queryEffect("insertLogicalIdentity", () =>
      tx.insert(fxControlUniqueConstraints).values({
        deploymentId: state.deploymentId,
        logicalUniqueConstraintId,
        tableId: state.tableId,
        descriptor: state.descriptor,
      }).returning());
    const row = inserted[0];
    if (row === undefined) {
      return yield* Effect.fail(corruption("logical insert returned no row"));
    }
    return Object.freeze({ status: "created" as const, identity: yield* decodeIdentityRow(row) });
  });
}

function findDefinitionEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
  logicalId: CatalogUniqueConstraintId,
) {
  return Effect.gen(function* () {
    const digest = appUniqueConstraintSpecSha256HexV1ToBytes(
      state.canonical.sha256Hex,
    );
    const rows = yield* queryEffect("readDefinition", () =>
      tx.select().from(fxControlUniqueConstraintDefinitions).where(and(
        eq(fxControlUniqueConstraintDefinitions.deploymentId, state.deploymentId),
        eq(fxControlUniqueConstraintDefinitions.logicalUniqueConstraintId, logicalId),
        eq(fxControlUniqueConstraintDefinitions.physicalSpecSha256, digest),
      )).limit(1));
    return rows[0] === undefined ? null : yield* decodeDefinitionRow(rows[0], state.canonical);
  });
}

function readBindingEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
  logicalId: CatalogUniqueConstraintId,
) {
  return Effect.gen(function* () {
    const rows = yield* queryEffect("readBinding", () =>
      tx.select().from(fxControlSchemaVersionUniqueConstraintBindings).where(and(
        eq(fxControlSchemaVersionUniqueConstraintBindings.deploymentId, state.deploymentId),
        eq(fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId, state.schemaVersionId),
        eq(fxControlSchemaVersionUniqueConstraintBindings.logicalUniqueConstraintId, logicalId),
      )).limit(1));
    return rows[0] === undefined ? null : yield* decodeBindingRow(rows[0]);
  });
}

function insertDefinitionEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
  logicalId: CatalogUniqueConstraintId,
) {
  return Effect.gen(function* () {
    const highRows = yield* queryEffect("readDefinitionHighWater", () =>
      tx.select({ id: fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId })
        .from(fxControlUniqueConstraintDefinitions)
        .where(eq(fxControlUniqueConstraintDefinitions.deploymentId, state.deploymentId))
        .orderBy(desc(fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId))
        .limit(1));
    const current = highRows[0]?.id ?? 0;
    if (current >= MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID) {
      return yield* Effect.fail(
        new AppUniqueConstraintCatalogIdExhaustedError({ identity: "definition" }),
      );
    }
    const definitionId = yield* Effect.fromResult(
      decodeDefinitionIdResult(current + 1).pipe(
        Result.mapError((cause) => corruption("invalid definition high-water", cause)),
      ),
    );
    const rows = yield* queryEffect("insertDefinition", () =>
      tx.insert(fxControlUniqueConstraintDefinitions).values({
        deploymentId: state.deploymentId,
        uniqueConstraintDefinitionId: definitionId,
        logicalUniqueConstraintId: logicalId,
        tableId: state.tableId,
        physicalSpecCodecVersion: state.canonical.codecVersion,
        physicalSpecJson: state.canonical.physicalSpec,
        physicalSpecBytes: canonicalAppUniqueConstraintSpecBytesHexV1ToBytes(
          state.canonical.canonicalBytesHex,
        ),
        physicalSpecSha256: appUniqueConstraintSpecSha256HexV1ToBytes(
          state.canonical.sha256Hex,
        ),
      }).returning());
    const row = rows[0];
    if (row === undefined) {
      return yield* Effect.fail(corruption("definition insert returned no row"));
    }
    return Object.freeze({
      status: "created" as const,
      definition: yield* decodeDefinitionRow(row, state.canonical),
    });
  });
}

function insertBindingEffect(
  tx: StableTableCatalogTransaction,
  state: PreparedState,
  logicalId: CatalogUniqueConstraintId,
  definitionId: CatalogUniqueConstraintDefinitionId,
) {
  return Effect.gen(function* () {
    const rows = yield* queryEffect("insertBinding", () =>
      tx.insert(fxControlSchemaVersionUniqueConstraintBindings).values({
        deploymentId: state.deploymentId,
        schemaVersionId: state.schemaVersionId,
        logicalUniqueConstraintId: logicalId,
        uniqueConstraintDefinitionId: definitionId,
        requiredForActivation: true,
      }).returning());
    const row = rows[0];
    if (row === undefined) {
      return yield* Effect.fail(corruption("binding insert returned no row"));
    }
    return yield* decodeBindingRow(row);
  });
}

function decodeIdentityRow(row: typeof fxControlUniqueConstraints.$inferSelect) {
  return Effect.gen(function* () {
    const logicalUniqueConstraintId = yield* Effect.fromResult(
      decodeLogicalIdResult(row.logicalUniqueConstraintId).pipe(
        Result.mapError((cause) => corruption("invalid logical ID", cause)),
      ),
    );
    const tableId = yield* Effect.fromResult(decodeTableIdResult(row.tableId).pipe(
      Result.mapError((cause) => corruption("invalid table ID", cause)),
    ));
    const descriptor = yield* Effect.fromResult(decodeDescriptorResult(row.descriptor).pipe(
      Result.mapError((cause) => corruption("invalid descriptor", cause)),
    ));
    const createdAt = copyFiniteDate(row.createdAt);
    if (createdAt === undefined) return yield* Effect.fail(corruption("invalid creation time"));
    return Object.freeze({
      deploymentId: row.deploymentId,
      logicalUniqueConstraintId,
      tableId,
      descriptor,
      createdAt,
    } satisfies AppUniqueConstraintIdentityRecordV1);
  });
}

function decodeDefinitionRow(
  row: typeof fxControlUniqueConstraintDefinitions.$inferSelect,
  expected?: CanonicalAppUniqueConstraintPhysicalSpecV1,
) {
  return Effect.gen(function* () {
    const uniqueConstraintDefinitionId = yield* Effect.fromResult(
      decodeDefinitionIdResult(row.uniqueConstraintDefinitionId).pipe(
        Result.mapError((cause) => corruption("invalid definition ID", cause)),
      ),
    );
    const logicalUniqueConstraintId = yield* Effect.fromResult(
      decodeLogicalIdResult(row.logicalUniqueConstraintId).pipe(
        Result.mapError((cause) => corruption("invalid logical ID", cause)),
      ),
    );
    const tableId = yield* Effect.fromResult(decodeTableIdResult(row.tableId).pipe(
      Result.mapError((cause) => corruption("invalid table ID", cause)),
    ));
    if (!isUint8Array(row.physicalSpecBytes) || !isUint8Array(row.physicalSpecSha256)) {
      return yield* Effect.fail(corruption("invalid physical evidence bytes"));
    }
    const physicalSpec = yield* Effect.fromResult(
      decodeAppUniqueConstraintPhysicalSpecV1Result(row.physicalSpecJson).pipe(
        Result.mapError((cause) => corruption("invalid physical spec", cause)),
      ),
    );
    const canonical = yield* Effect.promise(() =>
      canonicalizeAppUniqueConstraintPhysicalSpecV1(physicalSpec)
    );
    const expectedBytes = canonicalAppUniqueConstraintSpecBytesHexV1ToBytes(
      canonical.canonicalBytesHex,
    );
    const expectedSha = appUniqueConstraintSpecSha256HexV1ToBytes(canonical.sha256Hex);
    if (
      row.physicalSpecCodecVersion !== canonical.codecVersion ||
      !bytesEqual(row.physicalSpecBytes, expectedBytes) ||
      !bytesEqual(row.physicalSpecSha256, expectedSha) ||
      (expected !== undefined &&
        (canonical.sha256Hex !== expected.sha256Hex ||
          canonical.canonicalBytesHex !== expected.canonicalBytesHex))
    ) {
      return yield* Effect.fail(corruption("physical evidence mismatch"));
    }
    const createdAt = copyFiniteDate(row.createdAt);
    if (createdAt === undefined) return yield* Effect.fail(corruption("invalid creation time"));
    return Object.freeze({
      deploymentId: row.deploymentId,
      uniqueConstraintDefinitionId,
      logicalUniqueConstraintId,
      tableId,
      physicalSpecCodecVersion: canonical.codecVersion,
      physicalSpec: canonical.physicalSpec,
      physicalSpecBytesHex: canonical.canonicalBytesHex,
      physicalSpecSha256Hex: canonical.sha256Hex,
      createdAt,
    } satisfies AppUniqueConstraintDefinitionRecordV1);
  });
}

function markLocatedDefinition(
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
  definition: AppUniqueConstraintDefinitionRecordV1,
): LocatedAppUniqueConstraintDefinitionV1 {
  const located = {
    ...definition,
    scopeId,
    schemaVersionId,
  } as LocatedAppUniqueConstraintDefinitionV1;
  Object.defineProperty(located, locatedDefinitionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const frozen = Object.freeze(located);
  locatedDefinitions.add(frozen);
  return frozen;
}

function decodeBindingRow(
  row: typeof fxControlSchemaVersionUniqueConstraintBindings.$inferSelect,
) {
  return Effect.gen(function* () {
    const schemaVersionId = yield* Effect.fromResult(
      decodeSchemaVersionIdResult(row.schemaVersionId).pipe(
        Result.mapError((cause) => corruption("invalid schema version ID", cause)),
      ),
    );
    const logicalUniqueConstraintId = yield* Effect.fromResult(
      decodeLogicalIdResult(row.logicalUniqueConstraintId).pipe(
        Result.mapError((cause) => corruption("invalid logical ID", cause)),
      ),
    );
    const uniqueConstraintDefinitionId = yield* Effect.fromResult(
      decodeDefinitionIdResult(row.uniqueConstraintDefinitionId).pipe(
        Result.mapError((cause) => corruption("invalid definition ID", cause)),
      ),
    );
    const createdAt = copyFiniteDate(row.createdAt);
    if (row.requiredForActivation !== true || createdAt === undefined) {
      return yield* Effect.fail(corruption("invalid binding row"));
    }
    return Object.freeze({
      deploymentId: row.deploymentId,
      schemaVersionId,
      logicalUniqueConstraintId,
      uniqueConstraintDefinitionId,
      requiredForActivation: true,
      createdAt,
    } satisfies AppSchemaVersionUniqueConstraintBindingRecordV1);
  });
}

function corruption(detail: string, cause?: unknown) {
  return new AppUniqueConstraintCatalogCorruptionError({ detail, cause });
}
