import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { beforeAll, describe, expect, expectTypeOf, it, afterAll } from "vitest";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../../../src/database/pglite";
import {
  createPointMutationSessionActivationPersistenceV1,
  createApplicationMutationSessionActivationPersistenceV1,
} from "../../../src/execution/session/activation";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "../../../src/execution/session/constructionContracts";
import type {
  PreparedApplicationMutationSessionActivationV1,
} from "../../../src/execution/session/contracts";
import { selectApplicationMutationAdmission } from "../../../src/application/applicationMutationAdmission";
import { applicationMutationActivationFixture } from "../../application/applicationMutationActivationFixture";
import {
  createApplicationNativeMutationPGliteFixtureWithPersistence,
} from "../../application/applicationNativeMutationTestFixture";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { activatePointMutationSession } from "./support/attemptFixture";
import { pointMutationSessionActivationFixture } from "./support/activationEvidence";
import { setFlarexActivationClock } from "./support/authorityClock";
import { runEffect, runEffectFailure as runFailure } from "../../support/effectTestRuntime";
import {
  sharedLocator,
  type ActivationContext,
  resolutionPorts,
  rowCounts,
} from "./support/activationFixture";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";

describe("O03-B1 point-mutation session activation", () => {
  let activationDriver: ReturnType<typeof newTestPGlite> | undefined;

  let persistence: PGliteFlarexPersistence;

  let uuidCounter = 1;


  beforeAll(async () => {
    const acquiredDriver = newTestPGlite();
    activationDriver = acquiredDriver;
    try {
      persistence = await createPGlitePersistence({ db: acquiredDriver });
      await persistence.migrate();
    } catch (cause) {
      activationDriver = undefined;
      const cleanup = await Promise.allSettled([acquiredDriver.close()]);
      const outcome = cleanup[0];
      if (outcome?.status === "rejected") {
        throw new AggregateError([cause, outcome.reason], "Session activation setup and cleanup failed");
      }
      throw cause;
    }
  });

  afterAll(async () => {
    const acquiredDriver = activationDriver;
    activationDriver = undefined;
    await acquiredDriver?.close();
  });


  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `42000000-0000-4000-8000-${suffix}`;
  }


  it("refuses ordinary Application finite activation before minting durable authority", async () => {
    expectTypeOf<PreparedApplicationMutationSessionActivationV1["executionProfile"]>()
      .toEqualTypeOf<"durableOperations" | undefined>();
    const fixture = await createApplicationNativeMutationPGliteFixtureWithPersistence({
      runtimeHostIdentity: "flarex.test/application-activation-profile",
      compatibilityDate: "2026-08-25",
    }, {
      control: await createMigratedPGlitePersistence(),
      target: await createMigratedPGlitePersistence(),
    });
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(fixture.deploymentId);
    const scopeId = decodeReplacementScopeIdV1(fixture.authority.scopeId);
    const admission = await runEffect(selectApplicationMutationAdmission(fixture.active.selection, "users:create", {
      deploymentId, controlDb: fixture.control.drizzle,
      authority: fixture.authorityPorts, schema: fixture.schema,
    }));
    const prepared = await applicationMutationActivationFixture({
      deploymentId, selection: fixture.active.selection,
      executionAuthority: admission.executionAuthority,
      requestKey: "ordinary-application-profile", grantId: "ordinary-application-profile-grant",
    });
    let allocations = 0;
    const activation = createApplicationMutationSessionActivationPersistenceV1(fixture.sessionAuthority, {
      leaseDurationMilliseconds: 60_000,
      randomUuid: () => { allocations++; return nextUuid(); },
      randomExecutionClaimOwner: () => { allocations++; return nextUuid(); },
    });
    const before = await rowCounts(fixture.target, scopeId);
    // Deliberate runtime profile fault on genuine selection and signed grant:
    // the ordinary input type already excludes this finite entry request.
    const invalidPrepared = { ...prepared };
    Object.defineProperty(invalidPrepared, "executionProfile", { value: "finiteRoot" });
    expect(await runFailure(activation.activateEffect(invalidPrepared))).toMatchObject({
      _tag: "PointMutationSessionActivationV1Error", issue: { reason: "invalidPreparedEvidence" },
    });
    expect(allocations).toBe(0);
    expect(await rowCounts(fixture.target, scopeId)).toEqual(before);

    const created = await runEffect(activation.activateEffect({ ...prepared, executionProfile: "durableOperations" }));
    expect(created.status).toBe("created");
    expect(created.anchor.executionProfile).toBe("durableOperations");
    const stored = await fixture.target.query<{
      execution_authority_generation: string;
      execution_profile: string;
      metadata_watermark: string | null;
      finite_metadata_reservation_bytes: Uint8Array | null;
      finite_metadata_reservation_sha256: Uint8Array | null;
    }>(`select session.execution_authority_generation, journal.execution_profile,
              lease.metadata_watermark::text, lease.finite_metadata_reservation_bytes,
              lease.finite_metadata_reservation_sha256
         from fx_system_tx_session as session
         join fx_system_tx_journal as journal using (scope_uuid, session_id, attempt_fence)
         join fx_system_snapshot_lease as lease using (scope_uuid, session_id, attempt_fence)
        where session.session_id = $1`, [created.anchor.sessionId]);
    expect(stored.rows).toEqual([{
      execution_authority_generation: "application_v1", execution_profile: "durableOperations",
      metadata_watermark: null, finite_metadata_reservation_bytes: null, finite_metadata_reservation_sha256: null,
    }]);
  }, 120_000);


  async function provisionContext(label: string): Promise<ActivationContext> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_activation_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => nextUuid(),
      },
    ).ensure({
      deploymentId,
      projectId: `project_activation_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return {
      deploymentId,
      scopeId,
    };
  }


  function activationPersistence(
    options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ) {
    return createPointMutationSessionActivationPersistenceV1(
      resolutionPorts(persistence, options),
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => nextUuid(),
      },
    );
  }


  it("refuses bare finite activation without allocating a session or legacy children", async () => {
    const context = await provisionContext("finite_root_bare_activation");
    const input = pointMutationSessionActivationFixture(context.deploymentId, context.scopeId,
      { executionProfile: "finiteRoot" });
    const activation = activationPersistence();
    const before = await rowCounts(persistence, context.scopeId);
    // Finite admission needs the genuine prepared Application entry issuer.
    // The primitive ordinary activation port cannot manufacture that lifetime.
    expect(await runFailure(activation.activateEffect(input))).toMatchObject({
      _tag: "PointMutationSessionActivationV1Error",
      issue: { reason: "invalidPreparedEvidence" },
    });
    expect(await rowCounts(persistence, context.scopeId)).toEqual(before);
    const current = await activatePointMutationSession(activation,
      { ...input, executionProfile: "durableOperations" });
    expect(current.status).toBe("created");
    expect(current.anchor.executionProfile).toBe("durableOperations");
  });
});
