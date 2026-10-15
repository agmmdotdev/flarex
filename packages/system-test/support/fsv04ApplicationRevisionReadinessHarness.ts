/** Historical setup for FSV06/PQV/SAP/action fixtures; remove when those consumers migrate to current owners. */
import { probeDeclarativeV2ColdMaterializationV1 } from "flarex-backend/internal/declarative-v2-cold-materialization-probe-v1";
import { Data, Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1, decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { SchemaManifestAppIndexDescriptorSchema, decodeSchemaManifestAppSchemaV1, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";

import { type ApplicationRevisionReadinessContextV1, type LocatedApplicationRevisionReadinessTargetV1 } from "@flarex/persistence-postgres/internal/system-test/applicationRevisionReadinessV1";
import { advanceAppSchemaCandidateValidationEffect, createAppSchemaCandidateReadinessPort, createAppSchemaCandidateValidationPort, installAppSchemaCandidateValidationEffect, settleAppSchemaCandidateValidationEffect } from "@flarex/persistence-postgres/internal/system-test/appSchemaCandidateValidation";
import { createAppUniqueConstraintDefinitionPortV1 } from "@flarex/persistence-postgres/internal/app-unique-constraint-commit-v1";
import { ensureAppUniqueConstraintDefinitionBindingV1InTransaction, prepareAppUniqueConstraintDefinitionBindingV1Effect } from "@flarex/persistence-postgres/internal/app-unique-constraint-definitions-v1";
import { closeAppUniqueConstraintSetV1InTransactionEffect, prepareAppUniqueConstraintSetClosureV1Effect } from "@flarex/persistence-postgres/internal/app-unique-constraint-set-closure-v1";
import { advanceAppUniqueConstraintSetBackfillV1Effect, createAppUniqueConstraintSetEligibilityPortV1, createLocatedAppUniqueConstraintSetBuildTargetV1, reconcileAppUniqueConstraintSetBuildV1Effect } from "@flarex/persistence-postgres/internal/app-unique-constraint-set-build-v1";
import { createPointCommitPublisherPortV1 } from "@flarex/persistence-postgres/internal/point-commit-construction";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/postgres";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres/internal/system-test/scopeMetadataTypes";
import { readSchemaVersionArtifactByIdEffect } from "@flarex/persistence-postgres/internal/system-test/schemaVersionArtifacts";
import type { LoadedCandidateRuntimePublicationV1 } from "@flarex/persistence-postgres/internal/system-test/candidateRuntimePublicationRepositoryV1";
import { makeMemoryRuntimeArtifactStoreV1 } from "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export class ReadinessUniqueConstraintSetSetupV1Error extends Data.TaggedError(
  "ReadinessUniqueConstraintSetSetupV1Error",
)<{
  readonly phase:
    | "prepareClosure"
    | "closeTransaction"
    | "readSchemaArtifact"
    | "prepareBinding"
    | "ensureBindingTransaction"
    | "reconcileBuild"
    | "advanceBackfill"
    | "fixtureInvariant";
  readonly cause: unknown;
}> {}

function uniqueConstraintSetupError(
  phase: ReadinessUniqueConstraintSetSetupV1Error["phase"],
  cause: unknown,
): ReadinessUniqueConstraintSetSetupV1Error {
  return new ReadinessUniqueConstraintSetSetupV1Error({ phase, cause });
}

const COLD_BUDGET = Object.freeze({
  maximumGroups: 2,
  maximumModulesPerGroup: 32,
  maximumRawBytesPerGroup: 64 * 1_048_576,
  maximumObjects: 128,
  maximumObjectBytes: 64 * 1_048_576,
  maximumCompressedBytesPerGroup: 64 * 1_048_576,
  maximumStartupMilliseconds: 30_000,
});

export function readinessContext(
  deploymentId: string,
  persistence: Persistence,
  target: LocatedApplicationRevisionReadinessTargetV1,
  runtimeArtifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
): ApplicationRevisionReadinessContextV1<unknown> {
  let materializationSequence = 0;
  const authority = authorityPorts(persistence, target);
  const candidateValidation = createAppSchemaCandidateReadinessPort(
    createAppSchemaCandidateValidationPort(Object.freeze({ controlDb: persistence.drizzle, authority })),
  );
  return Object.freeze({
    deploymentId, controlDb: persistence.drizzle,
    pointCommit: createReadinessPointCommitV1(persistence, authority),
    candidateValidation, authority,
    coldMaterialization: {
      probe: (publication: LoadedCandidateRuntimePublicationV1) =>
        probeDeclarativeV2ColdMaterializationV1({
          candidate: publication.candidate, candidateSha256: publication.candidateSha256,
          publication: publication.publication, budget: COLD_BUDGET,
        }, runtimeArtifacts.store, {
          identity: "flarex.test/cold-materializer/fsv04-v1",
          materialize: request => Effect.sync(() => Object.freeze({
            compressedByteLength: request.modules.reduce(
              (sum, module) => sum + new TextEncoder().encode(module.code).byteLength, 0,
            ),
            startupMilliseconds: ++materializationSequence,
          })),
        }).pipe(Effect.map(receipts => Object.freeze(receipts.map(receipt => Object.freeze({
          codecIdentity: receipt.codecIdentity, group: receipt.frame.group,
          sha256: receipt.sha256, canonicalBytes: receipt.canonicalBytes,
        }))))),
    },
  });
}

export const closeReadinessUniqueConstraintSetEffectV1 = Effect.fn(
  "SystemTest.closeReadinessUniqueConstraintSetV1",
)(function* (
  persistence: Persistence,
  deploymentId: string,
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<void, ReadinessUniqueConstraintSetSetupV1Error> {
  const prepared = yield*
    prepareAppUniqueConstraintSetClosureV1Effect(
      persistence.drizzle,
      { deploymentId, schemaVersionId },
    ).pipe(Effect.mapError(cause => uniqueConstraintSetupError(
      "prepareClosure",
      cause,
    )));
  yield* Effect.uninterruptible(Effect.tryPromise({
    try: () =>
      persistence.drizzle.transaction(tx =>
        Effect.runPromise(
          closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
        ),
      ),
    catch: cause => uniqueConstraintSetupError("closeTransaction", cause),
  }));
});

export const prepareReadinessUniqueConstraintSetEffectV1: (
  persistence: Persistence,
  deploymentId: string,
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
) => Effect.Effect<void, ReadinessUniqueConstraintSetSetupV1Error> = Effect.fn(
  "SystemTest.prepareReadinessUniqueConstraintSetV1",
)(function* (
  persistence: Persistence,
  deploymentId: string,
  scopeId: ScopeId,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<void, ReadinessUniqueConstraintSetSetupV1Error> {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(
    persistence.drizzle,
    deploymentId,
    schemaVersionId,
  ).pipe(Effect.mapError(cause => uniqueConstraintSetupError(
    "readSchemaArtifact",
    cause,
  )));
  if (artifact === null) {
    return yield* Effect.fail(uniqueConstraintSetupError(
      "fixtureInvariant",
      new Error("System-test unique readiness schema artifact is missing."),
    ));
  }
  const manifest = decodeSchemaManifestAppSchemaV1(artifact.manifestJson);
  const table = manifest.tableDefinitions.tables[0];
  if (table === undefined) {
    return yield* Effect.fail(uniqueConstraintSetupError(
      "fixtureInvariant",
      new Error("System-test unique readiness table is missing."),
    ));
  }
  const binding = yield*
    prepareAppUniqueConstraintDefinitionBindingV1Effect(
      persistence.drizzle,
      {
        deploymentId,
        schemaVersionId,
        tableId: table.tableId,
        descriptor: SchemaManifestAppIndexDescriptorSchema.make(
          "system_test_unique_probe",
        ),
        physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["__systemTestUniqueProbe"],
          sparse: true,
          localePolicy: { kind: "none" },
          keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }),
      },
    ).pipe(Effect.mapError(cause => uniqueConstraintSetupError(
      "prepareBinding",
      cause,
    )));
  yield* Effect.uninterruptible(Effect.tryPromise({
    try: () =>
      persistence.drizzle.transaction(tx =>
        Effect.runPromise(
          ensureAppUniqueConstraintDefinitionBindingV1InTransaction(
            tx,
            binding,
          ),
        ),
      ),
    catch: cause => uniqueConstraintSetupError(
      "ensureBindingTransaction",
      cause,
    ),
  }));
  yield* closeReadinessUniqueConstraintSetEffectV1(
    persistence,
    deploymentId,
    scopeId,
    schemaVersionId,
  );
  const ports = uniqueConstraintBuildPorts(persistence);
  const reconciled = yield*
    reconcileAppUniqueConstraintSetBuildV1Effect(
      ports,
      { deploymentId, scopeId, schemaVersionId },
    ).pipe(Effect.mapError(cause => uniqueConstraintSetupError(
      "reconcileBuild",
      cause,
    )));
  if (reconciled.status !== "reconciled") {
    return yield* Effect.fail(uniqueConstraintSetupError(
      "fixtureInvariant",
      new Error(
        `System-test unique readiness build was ${reconciled.reason}.`,
      ),
    ));
  }
  for (let step = 0; step < 16; step += 1) {
    const advanced = yield*
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports,
        { deploymentId, scopeId, schemaVersionId, pageSize: 16 },
      ).pipe(Effect.mapError(cause => uniqueConstraintSetupError(
        "advanceBackfill",
        cause,
      )));
    if (advanced.lifecycle === "enabled") return;
  }
  return yield* Effect.fail(uniqueConstraintSetupError(
    "fixtureInvariant",
    new Error("System-test unique readiness build did not enable."),
  ));
});

function uniqueConstraintBuildPorts(persistence: Persistence) {
  const unavailableProvisioningReceipts = Object.freeze({
    getScopeAuthorityProvisioningReceipt: async () => {
      throw new Error("FSV04 shared scope must not read split receipts.");
    },
  });
  return Object.freeze({
    controlDb: persistence.drizzle,
    authority: Object.freeze({
      scopeMetadata: persistence,
      provisioningReceipts: unavailableProvisioningReceipts,
      scopeClockTargets: Object.freeze({
        resolve: async (locator: ScopePhysicalLocator) =>
          createLocatedAppUniqueConstraintSetBuildTargetV1(
            persistence.drizzle,
            locator,
          ),
      }),
    }),
  });
}

export function createReadinessPointCommitV1(
  persistence: Persistence,
  authority: ApplicationRevisionReadinessContextV1<unknown>["authority"],
) {
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    persistence.drizzle,
  );
  const unavailableProvisioningReceipts = Object.freeze({
    getScopeAuthorityProvisioningReceipt: async () => {
      throw new Error("FSV04 shared scope must not read split receipts.");
    },
  });
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1(
      Object.freeze({ controlDb: persistence.drizzle, authority }),
      uniqueConstraints,
    );
  return createPointCommitPublisherPortV1({
    scopeMetadata: persistence,
    provisioningReceipts: unavailableProvisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("FSV04 readiness must not resolve a commit target.");
      },
    },
  }, {
    uniqueConstraints,
    uniqueConstraintEligibility,
  });
}

export function authorityPorts(
  persistence: Persistence,
  target: LocatedApplicationRevisionReadinessTargetV1,
) {
  return Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("FSV04 shared scope must not read split receipts.");
      },
    },
    scopeClockTargets: { resolve: async () => target },
  });
}

export async function settleReadinessCandidateValidationV1(
  persistence: Persistence,
  target: LocatedApplicationRevisionReadinessTargetV1,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const port = createAppSchemaCandidateValidationPort(Object.freeze({
    controlDb: persistence.drizzle,
    authority: authorityPorts(persistence, target),
  }));
  await Effect.runPromise(installAppSchemaCandidateValidationEffect(port, {
    deploymentId,
    schemaVersionId,
  }));
  for (let step = 0; step < 64; step += 1) {
    const advanced = await Effect.runPromise(
      advanceAppSchemaCandidateValidationEffect(port, {
        deploymentId,
        schemaVersionId,
      }),
    );
    if (advanced.disposition !== "readyToSettle") continue;
    await Effect.runPromise(settleAppSchemaCandidateValidationEffect(port, {
      deploymentId,
      schemaVersionId,
    }));
    return;
  }
  throw new Error("FSV04 candidate validation did not settle.");
}
