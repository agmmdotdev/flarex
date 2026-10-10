import { setTimeout as delay } from "node:timers/promises";
import {
  decodeReplacementScopeIdV1,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
} from "flarex-protocol/storage-authority";
import { TransactionPackageIdV1Schema } from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import {
  PointMutationSessionActivationV1Error,
} from "../../../src/execution/session/errors";
import type {
  PointMutationSessionActivationResultV1,
} from "../../../src/execution/session/contracts";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
  withTemporaryPostgresPersistence,
} from "../../support/postgresHelpers";
import { runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import { activatePointMutationSession } from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import { setFlarexActivationClock } from "./support/authorityClock";
import {
  provisionContext,
  createActivationPersistence,
  rowCounts,
  sharedLocator,
  uuidFactory,
} from "./support/postgresFixture";
import { deferred } from "./support/postgresLocks";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O03-B session authority", () => {
  const withPostgresPersistence = useFileScopedPostgresPersistence();


  it("activates exact shops when a deployment has two scopes", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "shared_deployment_exact_scope",
        sharedLocator("shared-deployment-exact-scope"),
        ids,
      );
      const peerScopeId = decodeReplacementScopeIdV1(`scope_${ids()}`);
      await persistence.insertScopeMetadata({
        deploymentId: context.deploymentId,
        scopeId: peerScopeId,
        physicalLocator: context.physicalLocator,
      });
      await persistence.drizzle.transaction(async tx => {
      await tx.insert(fxSystemScopeClocks).values({ scopeId: peerScopeId });
      await tx.insert(fxSystemScopeExecutionAuthorities).values({
        scopeId: peerScopeId, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        epoch: ScopeEpochSchema.make(`epoch_${ids()}`),
      });
    });
      await setFlarexActivationClock(persistence, peerScopeId);
      await expect(persistence.getScopeMetadataByDeploymentId(context.deploymentId))
        .rejects.toMatchObject({ name: "ScopeDeploymentAmbiguousError" });

      const activation = createActivationPersistence(persistence, ids);
      for (const scopeId of [context.scopeId, peerScopeId]) {
        const result = await activatePointMutationSession(
          activation,
          pointMutationSessionActivationFixture(context.deploymentId, scopeId),
        );
        expect(result.status).toBe("created");
        expect(result.anchor.scopeId).toBe(scopeId);
      }
    });
  });


  it("serializes exact same-request activation into one created and one busy anchor", async () => {
    await withPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "same_request",
        sharedLocator("same-request"),
        ids,
      );
      const activation = createActivationPersistence(
        persistence,
        ids,
      );
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );

      const results = await Promise.all([
        activatePointMutationSession(activation, input),
        activatePointMutationSession(activation, input),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "busy",
        "created",
      ]);
      expect(results[0]?.anchor).toEqual(results[1]?.anchor);
      const created = results.find((result) => result.status === "created");
      if (created?.status !== "created") {
        throw new Error("Expected one created activation result.");
      }
      const claim = await persistence.query<{
        claim_owner: string;
        claim_fence: string;
      }>(`
        select claim_owner::text, claim_fence::text
        from fx_system_tx_execution_claim
        where session_id = $1
      `, [created.anchor.sessionId]);
      expect(claim.rows).toEqual([{
        claim_owner: created.executionClaim.claimOwner,
        claim_fence: "1",
      }]);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
    });
  }, 120_000);


  it("gives changed-evidence competition one winner under the scope lock", async () => {
    await withPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "changed_competition",
        sharedLocator("changed-competition"),
        ids,
      );
      const activation = createActivationPersistence(persistence, ids);
      const first = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );
      const second = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
        {
          evidence: {
            packageId: TransactionPackageIdV1Schema.make(
              "package_activation_competitor",
            ),
          },
        },
      );

      const settled = await Promise.allSettled([
        activatePointMutationSession(activation, first),
        activatePointMutationSession(activation, second),
      ]);
      const fulfilled = settled.find(
        (result) => result.status === "fulfilled",
      );
      const rejected = settled.find(
        (result) => result.status === "rejected",
      );

      expect(settled.filter((result) => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(settled.filter((result) => result.status === "rejected"))
        .toHaveLength(1);
      expect(fulfilled?.status === "fulfilled" && fulfilled.value.status)
        .toBe("created");
      expect(rejected?.status === "rejected" ? rejected.reason : undefined)
        .toMatchObject({
        issue: { reason: "requestKeyConflict" },
      } satisfies Partial<PointMutationSessionActivationV1Error>);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
    });
  });


  it("allows an independent scope to activate while another scope transaction is paused", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const contextA = await provisionContext(
        persistence,
        "independent_a",
        sharedLocator("independent-a"),
        ids,
      );
      const contextB = await provisionContext(
        persistence,
        "independent_b",
        sharedLocator("independent-b"),
        ids,
      );
      const entered = deferred<void>();
      const release = deferred<void>();
      const activationA = createActivationPersistence(persistence, ids, {
        afterWrite: async (step) => {
          if (step !== "sessionInserted") return;
          entered.resolve();
          await release.promise;
        },
      });
      const activationB = createActivationPersistence(persistence, ids);
      const pendingA = activatePointMutationSession(
        activationA,
        pointMutationSessionActivationFixture(
          contextA.deploymentId,
          contextA.scopeId,
        ),
      );
      await entered.promise;

      let resultB: PointMutationSessionActivationResultV1 | undefined;
      try {
        resultB = await Promise.race([
          activatePointMutationSession(
            activationB,
            pointMutationSessionActivationFixture(
              contextB.deploymentId,
              contextB.scopeId,
            ),
          ),
          delay(5_000).then(() => {
            throw new Error("Independent-scope activation timed out.");
          }),
        ]);
      } finally {
        release.resolve();
      }
      const resultA = await pendingA;
      if (resultB === undefined) {
        throw new Error("Independent-scope activation returned no result.");
      }

      expect(resultA.status).toBe("created");
      expect(resultB.status).toBe("created");
      await expect(rowCounts(persistence, contextA.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
      await expect(rowCounts(persistence, contextB.scopeId)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        executionClaims: 1,
      });
    });
  });


  it("rolls back all four authoritative facets after every mutating statement", async () => {
    await withPostgresPersistence(async (persistence) => {
      const ids = uuidFactory();
      const context = await provisionContext(
        persistence,
        "rollback",
        sharedLocator("rollback"),
        ids,
      );
      const input = pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      );

      for (const failureStep of [
        "sessionInserted",
        "leaseInserted",
        "journalRootInserted",
        "executionClaimInserted",
      ] as const) {
        const activation = createActivationPersistence(persistence, ids, {
          afterWrite: (step) => {
            if (step === failureStep) throw new Error(`fail:${step}`);
          },
        });

        const failure = await runFailure(activation.activateEffect(input));
        expect(failure).toMatchObject({
          _tag: "PointMutationSessionActivationPersistenceV1Error",
          operation: "activationTransaction",
          cause: expect.objectContaining({ message: `fail:${failureStep}` }),
        });
        await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
          sessions: 0,
          leases: 0,
          journals: 0,
          executionClaims: 0,
        });
      }
    });
  });
});
