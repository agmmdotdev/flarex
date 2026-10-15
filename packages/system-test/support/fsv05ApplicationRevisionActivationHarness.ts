/** Historical setup for FSV06/PQV/SAP/action fixtures; remove when those consumers migrate to current owners. */
import type { StandardApplicationDefinitionInputV1 } from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import { decodeApplicationRevisionReadinessReceiptV1 } from "flarex-protocol/internal/application-revision-readiness-v1";
import { type LocatedApplicationRevisionActivationTargetV1 } from "@flarex/persistence-postgres/internal/system-test/applicationRevisionActivationV1";
import { settleApplicationRevisionReadinessV1 } from "@flarex/persistence-postgres/internal/system-test/applicationRevisionReadinessV1";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "@flarex/persistence-postgres/internal/system-test/intrinsicCreationTimeIndexBuildV1";
import { locateAppIndexDefinitionByIdEffect } from "@flarex/persistence-postgres/internal/system-test/appIndexDefinitions";
import { reconcilePublishedIndexBuildsV1Effect } from "@flarex/persistence-postgres/internal/system-test/indexBuildReconciliation";
import type { LocatedApplicationRevisionRegistrationTargetV1 } from "@flarex/persistence-postgres/internal/system-test/applicationRevisionRegistrationV1";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/postgres";
import { prepareFsv04RegisteredRevisionFixtureV1 } from "./fsv03PrivateAnalyzerToPostgresHarness";
import { authorityPorts, prepareReadinessUniqueConstraintSetEffectV1, readinessContext, settleReadinessCandidateValidationV1 } from "./fsv04ApplicationRevisionReadinessHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from "./memoryRuntimeArtifactStoreV1";
type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export const FSV05_SUPPORTED_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const);

export class Fsv05ReadyRevisionFixtureV1Error extends Data.TaggedError(
  "Fsv05ReadyRevisionFixtureV1Error",
)<{
  readonly phase:
    | "register"
    | "prepareUniqueConstraintSet"
    | "reconcile"
    | "buildIndex"
    | "settleReadiness";
  readonly message: string;
  readonly cause: unknown;
}> {}

export interface Fsv05ApplicationRevisionActivationLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: Persistence;
  readonly registrationTarget: LocatedApplicationRevisionRegistrationTargetV1;
  readonly makeActivationTarget: () =>
    LocatedApplicationRevisionActivationTargetV1;
}

/** Effect-native setup owned by the private system-test composition root. */
export const prepareFsv05ReadyRevisionFixtureEffectV1 = Effect.fn(
  "SystemTest.prepareReadyRevisionV1",
)(function* (
  lane: Fsv05ApplicationRevisionActivationLaneV1,
  artifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  variant: string | undefined,
  provisionScope: boolean,
  standardDefinitionInput?: StandardApplicationDefinitionInputV1,
) {
  const registered = yield* Effect.tryPromise({
    try: () => prepareFsv04RegisteredRevisionFixtureV1({
      name: lane.name,
      persistence: lane.persistence,
      registrationTarget: lane.registrationTarget,
      runtimeArtifacts: artifacts,
      physicalLocator: FSV05_SUPPORTED_LOCATOR,
      ...(variant === undefined ? {} : { revisionVariant: variant }),
      ...(standardDefinitionInput === undefined
        ? {}
        : { standardDefinitionInput }),
      provisionScope,
    }),
    catch: cause => new Fsv05ReadyRevisionFixtureV1Error({
      phase: "register",
      message: `FSV05 could not prepare revision ${variant ?? "base"}.`,
      cause,
    }),
  });
  yield* prepareReadinessUniqueConstraintSetEffectV1(
    lane.persistence,
    registered.deploymentId,
    registered.scopeId,
    registered.registered.schemaVersionId,
  ).pipe(
    Effect.mapError(cause => new Fsv05ReadyRevisionFixtureV1Error({
      phase: "prepareUniqueConstraintSet",
      message:
        `FSV05 could not prepare the unique set for ${variant ?? "base"}.`,
      cause,
    })),
  );
  const target = lane.makeActivationTarget();
  yield* Effect.tryPromise({
    try: () => settleReadinessCandidateValidationV1(
      lane.persistence,
      target,
      registered.deploymentId,
      registered.registered.schemaVersionId,
    ),
    catch: cause => new Fsv05ReadyRevisionFixtureV1Error({
      phase: "settleReadiness",
      message: `FSV05 candidate validation did not settle for ${variant ?? "base"}.`,
      cause,
    }),
  });
  const context = readinessContext(
    registered.deploymentId,
    lane.persistence,
    target,
    artifacts,
  );
  const reconciliation = yield* reconcilePublishedIndexBuildsV1Effect(
    {
      controlDb: lane.persistence.drizzle,
      authority: authorityPorts(lane.persistence, target),
    },
    {
      deploymentId: registered.deploymentId,
      scopeId: registered.scopeId,
      schemaVersionId: registered.registered.schemaVersionId,
    },
  );
  if (reconciliation.status !== "reconciled") {
    return yield* Effect.fail(new Fsv05ReadyRevisionFixtureV1Error({
      phase: "reconcile",
      message: `FSV05 physical definitions were ${reconciliation.reason}.`,
      cause: reconciliation,
    }));
  }
  for (const indexDefinitionId of reconciliation.definitionIds) {
    const definition = yield* locateAppIndexDefinitionByIdEffect(
      lane.persistence.drizzle,
      reconciliation.scopeId,
      indexDefinitionId,
    );
    if (definition === null) {
      return yield* Effect.fail(new Fsv05ReadyRevisionFixtureV1Error({
        phase: "reconcile",
        message: "FSV05 reconciled index definition disappeared.",
        cause: new Error("FSV05 reconciled index definition disappeared."),
      }));
    }
    for (let step = 0; step < 64; step += 1) {
      const ports = {
        controlDb: lane.persistence.drizzle,
        authority: authorityPorts(lane.persistence, target),
      } as const;
      const input = {
        deploymentId: registered.deploymentId,
        scopeId: registered.scopeId,
        indexDefinitionId,
        pageSize: 4,
      } as const;
      const buildEffect = (() => {
        switch (definition.access.kind) {
          case "developer":
            return buildAppDeveloperOrderedIndexV1Effect(ports, input);
          case "by_creation_time":
            return buildIntrinsicCreationTimeIndexV1Effect(ports, input);
        }
        const unreachable: never = definition.access;
        return unreachable;
      })();
      const result = yield* buildEffect;
      if (result.lifecycle === "enabled") break;
      if (step === 63) {
        return yield* Effect.fail(new Fsv05ReadyRevisionFixtureV1Error({
          phase: "buildIndex",
          message: "FSV05 ordered-index build did not converge.",
          cause: new Error("FSV05 ordered-index build did not converge."),
        }));
      }
    }
  }
  const ready = yield* Effect.scoped(
    settleApplicationRevisionReadinessV1(
      registered.registered.revisionId,
      context,
    ),
  );
  if (ready.status !== "ready") {
    return yield* Effect.fail(new Fsv05ReadyRevisionFixtureV1Error({
      phase: "settleReadiness",
      message: `FSV05 revision remained not ready: ${ready.reason}.`,
      cause: new Error(`FSV05 revision remained not ready: ${ready.reason}.`),
    }));
  }
  const receipt = Result.getOrThrow(
    decodeApplicationRevisionReadinessReceiptV1(
      ready.readinessReceiptBytes,
    ),
  );
  return Object.freeze({
    deploymentId: registered.deploymentId,
    revisionId: registered.registered.revisionId,
    schemaVersionId: registered.registered.schemaVersionId,
    enabledBuildRootSha256Hex: encodeBytesToLowercaseHex(
      receipt.frame.enabledBuildRootSha256,
    ),
    context: Object.freeze({
      deploymentId: registered.deploymentId,
      controlDb: lane.persistence.drizzle,
      pointCommit: context.pointCommit,
      candidateValidation: context.candidateValidation,
      authority: context.authority,
    }),
  });
});

/** Promise compatibility for the copied persistence proof scaffolding. */
export async function prepareFsv05ReadyRevisionFixtureV1(
  lane: Fsv05ApplicationRevisionActivationLaneV1,
  artifacts: ReturnType<typeof makeMemoryRuntimeArtifactStoreV1>,
  variant: string | undefined,
  provisionScope: boolean,
  standardDefinitionInput?: StandardApplicationDefinitionInputV1,
) {
  return Effect.runPromise(prepareFsv05ReadyRevisionFixtureEffectV1(
    lane,
    artifacts,
    variant,
    provisionScope,
    standardDefinitionInput,
  ));
}
