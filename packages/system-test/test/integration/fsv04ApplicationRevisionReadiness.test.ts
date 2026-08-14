import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";

import {
  createLocatedApplicationRevisionReadinessTargetV1,
  settleApplicationRevisionReadinessV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-readiness-v1";
import {
  createPGliteLocatedApplicationRevisionReadinessTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  closeReadinessUniqueConstraintSetV1,
  createReadinessPointCommitV1,
  proveFsv04ApplicationRevisionReadinessV1,
  readinessContext,
} from "../../support/fsv04ApplicationRevisionReadinessHarness";
import {
  prepareFsv04RegisteredRevisionFixtureV1,
} from "../../support/fsv03PrivateAnalyzerToPostgresHarness";
import {
  makeMemoryRuntimeArtifactStoreV1,
} from "../../support/memoryRuntimeArtifactStoreV1";
import {
  createHistoricalApplicationAnalysisPGlitePersistence,
} from "../support/databaseFixturesV1";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "fsv03-private",
  schemaName: "public",
} as const);

describe("FSV04 application revision readiness - PGlite", () => {
  it("settles only complete target-native evidence and remains non-activating", async () => {
    const persistence =
      await createHistoricalApplicationAnalysisPGlitePersistence();
    const proof = await proveFsv04ApplicationRevisionReadinessV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          LOCATOR,
        ),
      makeReadinessTarget: () =>
        createPGliteLocatedApplicationRevisionReadinessTargetV1(
          persistence,
          LOCATOR,
        ),
      makeDecisionUncertainTarget: () => {
        const base = createPGliteLocatedApplicationRevisionReadinessTargetV1(
          persistence,
          LOCATOR,
        );
        let transactionCount = 0;
        let injected = false;
        const target = createLocatedApplicationRevisionReadinessTargetV1(
          persistence.drizzle,
          LOCATOR,
          async work => {
            const result = await base[RUN_LOCATED_READ_COMMITTED_V1](work);
            transactionCount += 1;
            if (transactionCount === 2) {
              injected = true;
              throw new LocatedReadCommittedTransactionFailureV1({
                kind: "decisionUncertain",
                settlementCause: new Error("injected lost commit response"),
              });
            }
            return result;
          },
        );
        return Object.freeze({ target, wasInjected: () => injected });
      },
    });
    expect(proof).toMatchObject({
      lane: "pglite",
      notReadyReasons: [
        "physicalBuildMissing",
        "physicalBuildNotEnabled",
      ],
      rollbackBoundaries: ["afterVerdictInsert", "afterAttemptReady"],
      concurrentDispositions: ["inserted", "replayed"],
      coldReplayDisposition: "replayed",
      decisionUncertainDisposition: "replayed",
      decisionUncertaintyInjected: true,
      coldAuthorityFailures: ["missingGroup", "projectionMismatch"],
      buildStateInvalidation: true,
      receiptCorruptionRejected: true,
      staleInvalidation: true,
      verdictCount: 1,
      activeRevisionCount: 0,
      activeHeadCount: 0,
      attemptLifecycle: "ready",
      postgresVersion: null,
    });
    expect(proof.buildLifecycles.at(-1)).toBe("enabled");
    expect(proof.closedEmptyEnabledBuildRootSha256Hex).toBe(
      "41c34b9e59b4bfb07dd8e1155031468e2a729ea977b4d8bc7cc976f76b3db8ce",
    );
  }, 240_000);

  it("rejects foreign or copied readiness capabilities", async () => {
    const persistence =
      await createHistoricalApplicationAnalysisPGlitePersistence();
    const otherPersistence =
      await createHistoricalApplicationAnalysisPGlitePersistence();
    const artifacts = makeMemoryRuntimeArtifactStoreV1();
    const registered = await prepareFsv04RegisteredRevisionFixtureV1({
      name: "pglite",
      persistence,
      registrationTarget:
        createPGliteLocatedApplicationRevisionRegistrationTargetV1(
          persistence,
          LOCATOR,
        ),
      runtimeArtifacts: artifacts,
    });
    await closeReadinessUniqueConstraintSetV1(
      persistence,
      registered.deploymentId,
      registered.registered.schemaVersionId,
    );
    const context = readinessContext(
      registered.deploymentId,
      persistence,
      createPGliteLocatedApplicationRevisionReadinessTargetV1(
        persistence,
        LOCATOR,
      ),
      artifacts,
    );
    const otherCatalogPointCommit = createReadinessPointCommitV1(
      otherPersistence,
      context.authority,
    );
    const otherAuthorityContext = readinessContext(
      registered.deploymentId,
      persistence,
      createPGliteLocatedApplicationRevisionReadinessTargetV1(
        persistence,
        LOCATOR,
      ),
      artifacts,
    );

    for (const [mixed, expectedTag, expectedReason] of [
      [
        { ...context, pointCommit: otherCatalogPointCommit },
        "PointCommitUniqueConstraintEligibilityUnavailableV1Error",
        "compositionMismatch",
      ],
      [
        { ...otherAuthorityContext, pointCommit: context.pointCommit },
        "PointCommitUniqueConstraintEligibilityUnavailableV1Error",
        "compositionMismatch",
      ],
      [
        {
          ...context,
          candidateValidation: otherAuthorityContext.candidateValidation,
        },
        "AppSchemaCandidateReadinessError",
        "invalidPort",
      ],
      [
        {
          ...context,
          candidateValidation: { ...context.candidateValidation },
        },
        "AppSchemaCandidateReadinessError",
        "invalidPort",
      ],
    ] as const) {
      const exit = await Effect.runPromise(Effect.exit(Effect.scoped(
        settleApplicationRevisionReadinessV1(
          registered.registered.revisionId,
          mixed,
        ),
      )));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) continue;
      const failure = Cause.findErrorOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toMatchObject({
          _tag: expectedTag,
          reason: expectedReason,
        });
      }
    }
  }, 240_000);
});
