import type {
  CatalogIndexDefinitionId,
  CatalogIndexId,
} from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import {
  getPreparedAppSchemaPublicationV1State,
  type PreparedAppSchemaPublicationV1,
} from "./appSchemaPublicationPreparation";
import {
  ensureAppCreationTimeIndexDefinitionV1InTransaction,
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  listAppSchemaVersionIndexBindings,
  prepareAppCreationTimeIndexDefinitionsV1,
  prepareAppDeveloperIndexDefinitionBindingsV1,
  type AppIndexDefinitionRecordForAccessKindV1,
  type AppSchemaVersionIndexBindingRecord,
  type EnsureAppDeveloperIndexDefinitionBindingV1Result,
} from "./appIndexDefinitions";
import { applySchemaManifestAppSchemaBindingsV1InTransaction } from "./schemaManifestAppSchemaBindings";
import {
  ensureSchemaVersionArtifactInTransaction,
  verifyPreparedSchemaVersionArtifactInTransaction,
  type SchemaVersionArtifact,
} from "./schemaVersionArtifacts";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

export interface AppSchemaPublicationV1Result {
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly artifact: SchemaVersionArtifact;
  readonly creationTimeIndexDefinitions: ReadonlyArray<
    AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">
  >;
  readonly developerIndexDefinitions: ReadonlyArray<
    AppIndexDefinitionRecordForAccessKindV1<"developer">
  >;
  readonly schemaVersionIndexBindings:
    ReadonlyArray<AppSchemaVersionIndexBindingRecord>;
}

export type AppSchemaPublicationV1ProjectionIssue =
  | {
      readonly reason: "schemaBindingCountMismatch";
      readonly expectedCount: number;
      readonly actualCount: number;
    }
  | {
      readonly reason: "schemaBindingMismatch";
      readonly position: number;
      readonly expectedLogicalIndexId: CatalogIndexId;
      readonly expectedIndexDefinitionId: CatalogIndexDefinitionId;
      readonly actualLogicalIndexId: CatalogIndexId;
      readonly actualIndexDefinitionId: CatalogIndexDefinitionId;
    };

export class AppSchemaPublicationV1ProjectionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly schemaVersionId: CatalogSchemaVersionId,
    readonly issue: AppSchemaPublicationV1ProjectionIssue,
  ) {
    super(
      `App-schema V1 publication is incomplete or contradictory for ${deploymentId}/${schemaVersionId}: ${projectionIssueMessage(issue)}`,
    );
    this.name = "AppSchemaPublicationV1ProjectionError";
  }
}

/**
 * Atomically apply and verify one already-prepared full app-schema projection.
 *
 * This package-internal D2c primitive owns no transaction, commit, retry,
 * quota, routing, build state, readiness, or activation. The caller must invoke
 * it inside one short control-database transaction. Every child token is
 * derived from the authenticated D2a envelope before the first SQL await, and
 * the locked phase performs no canonical encoding or hashing.
 */
export async function publishPreparedAppSchemaV1InTransaction(
  tx: StableTableCatalogTransaction,
  publication: PreparedAppSchemaPublicationV1,
): Promise<AppSchemaPublicationV1Result> {
  const state = getPreparedAppSchemaPublicationV1State(publication);
  const creationTimeTokens =
    prepareAppCreationTimeIndexDefinitionsV1(publication);
  const developerTokens =
    prepareAppDeveloperIndexDefinitionBindingsV1(publication);

  const manifest = await applySchemaManifestAppSchemaBindingsV1InTransaction(
    tx,
    state.logicalBindings,
  );
  await ensureSchemaVersionArtifactInTransaction(tx, state.artifact);

  const creationTimeIndexDefinitions: Array<
    AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">
  > = [];
  for (const token of creationTimeTokens) {
    const ensured =
      await ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, token);
    creationTimeIndexDefinitions.push(ensured.definition);
  }

  const developerResults: EnsureAppDeveloperIndexDefinitionBindingV1Result[] = [];
  for (const token of developerTokens) {
    developerResults.push(
      await ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, token),
    );
  }

  const artifact = await verifyPreparedSchemaVersionArtifactInTransaction(
    tx,
    state.artifact,
  );
  const schemaVersionIndexBindings = await listAppSchemaVersionIndexBindings(
    tx,
    publication.deploymentId,
    publication.schemaVersionId,
  );
  verifyExactSchemaVersionBindings(
    publication,
    developerResults,
    schemaVersionIndexBindings,
  );

  return Object.freeze({
    manifest,
    artifact,
    creationTimeIndexDefinitions: Object.freeze(creationTimeIndexDefinitions),
    developerIndexDefinitions: Object.freeze(
      developerResults.map((result) => result.definition),
    ),
    schemaVersionIndexBindings,
  } satisfies AppSchemaPublicationV1Result);
}

function verifyExactSchemaVersionBindings(
  publication: PreparedAppSchemaPublicationV1,
  expected: ReadonlyArray<EnsureAppDeveloperIndexDefinitionBindingV1Result>,
  actual: ReadonlyArray<AppSchemaVersionIndexBindingRecord>,
): void {
  if (actual.length !== expected.length) {
    throw new AppSchemaPublicationV1ProjectionError(
      publication.deploymentId,
      publication.schemaVersionId,
      {
        reason: "schemaBindingCountMismatch",
        expectedCount: expected.length,
        actualCount: actual.length,
      },
    );
  }
  for (const [position, expectedResult] of expected.entries()) {
    const actualBinding = actual[position];
    if (actualBinding === undefined) {
      throw new AppSchemaPublicationV1ProjectionError(
        publication.deploymentId,
        publication.schemaVersionId,
        {
          reason: "schemaBindingCountMismatch",
          expectedCount: expected.length,
          actualCount: actual.length,
        },
      );
    }
    if (
      actualBinding.logicalIndexId !== expectedResult.binding.logicalIndexId ||
      actualBinding.indexDefinitionId !== expectedResult.binding.indexDefinitionId
    ) {
      throw new AppSchemaPublicationV1ProjectionError(
        publication.deploymentId,
        publication.schemaVersionId,
        {
          reason: "schemaBindingMismatch",
          position,
          expectedLogicalIndexId: expectedResult.binding.logicalIndexId,
          expectedIndexDefinitionId: expectedResult.binding.indexDefinitionId,
          actualLogicalIndexId: actualBinding.logicalIndexId,
          actualIndexDefinitionId: actualBinding.indexDefinitionId,
        },
      );
    }
  }
}

function projectionIssueMessage(
  issue: AppSchemaPublicationV1ProjectionIssue,
): string {
  switch (issue.reason) {
    case "schemaBindingCountMismatch":
      return `expected ${issue.expectedCount} schema bindings but found ${issue.actualCount}`;
    case "schemaBindingMismatch":
      return `binding ${issue.position} is ${issue.actualLogicalIndexId}/${issue.actualIndexDefinitionId}, not ${issue.expectedLogicalIndexId}/${issue.expectedIndexDefinitionId}`;
  }
}
