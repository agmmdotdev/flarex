import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { projectScopeIdUuidV1, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { beforeAll, describe, expect, it } from "vitest";
import { selectApplicationMutationAdmission } from "../../../src/application/applicationMutationAdmission";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import { createPGliteLocatedPointMutationSessionActivationTargetV1 } from "../../../src/database/pglite";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../../../src/execution/transactionSessionActivation";
import { createStoredOccExecutionEvidenceLoaderV1 } from "../../../src/execution/storedOccExecution";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import { runEffect } from "../../support/effectTestRuntime";
import { fxSystemApplicationFunctionsV1 } from "../../../src/database/schema";
import { LOCATOR } from "../support/readinessArtifacts";
import { readinessFixture } from "../support/readinessFixture";
import { prepareReadinessAuthorities } from "../support/readinessPreparation";
import { scalarCount, uuidSequence } from "../support/readinessEvidence";
import { applicationMutationActivationInput } from "./support/mutationActivation";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application admission/mutation", { timeout: 30_000 }, () => {
  it("admits and replays exact Application mutation authority and rejects stale or foreign authority", async () => {
    const fixture = await readinessFixture({ functionKind: "mutation" });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const input = await applicationMutationActivationInput(fixture, active);
    const freshGrantReplay = await applicationMutationActivationInput(
      fixture,
      active,
      {
        requestKey: "request:application:mutation",
        grantId: "grant_application_mutation_fresh_retry",
      },
    );
    const staleNewRequest = await applicationMutationActivationInput(
      fixture,
      active,
      {
        requestKey: "request:application:mutation:stale-new-admission",
        grantId: "grant_application_mutation_stale_new",
      },
    );
    const sessionActivation = createApplicationMutationSessionActivationPersistenceV1(
      {
        scopeMetadata: fixture.control,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async locator =>
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              fixture.target,
              locator,
            ),
        },
      },
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: uuidSequence(80, 81, 82, 83, 84, 85),
      },
    );

    const created = await runEffect(sessionActivation.activateEffect(input));
    const replayed = await runEffect(
      sessionActivation.activateEffect(freshGrantReplay),
    );
    expect(created.status).toBe("created");
    expect(replayed).toMatchObject({ status: "busy", anchor: created.anchor });
    const stored = await fixture.target.query<{
      generation: string;
      package_id: string | null;
      authority_format: string;
    }>(
      `select execution_authority_generation as generation,
              package_id,
              application_execution_authority_json->>'format' as authority_format
         from fx_system_tx_session
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    expect(stored.rows).toEqual([{
      generation: "application_v1",
      package_id: null,
      authority_format: "flarex.application-mutation-execution-authority",
    }]);
    if (created.status !== "created") throw new Error("Expected creation.");
    const graphQueries: string[] = [];
    const executionAuthority = {
      kind: "claimedAttempt" as const,
      deploymentId: created.anchor.deploymentId,
      scopeId: created.anchor.scopeId,
      scopeUuid: projectScopeIdUuidV1(created.anchor.scopeId).scopeUuid,
      sessionId: created.anchor.sessionId,
      attemptFence: created.anchor.attemptFence,
      storageGeneration: created.anchor.storageGeneration,
      storageGenerationFence: created.anchor.storageGenerationFence,
      snapshotToken: created.anchor.snapshotToken,
      schemaVersionId: active.basis.schemaVersionId,
      executionClaim: Object.freeze({
        claimOwner: created.executionClaim.claimOwner,
        claimFence: created.executionClaim.claimFence,
      }),
    };
    const graphLoader = createStoredOccExecutionEvidenceLoaderV1({
      scopeMetadata: fixture.control,
      applicationControlDb: fixture.control.drizzle,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeSessionTargets: {
        resolve: async locator =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            fixture.target,
            locator,
          ),
      },
    }, { observeQuery: query => graphQueries.push(query.name) });
    const immutableGraph = await runEffect(
      graphLoader.loadEffect(executionAuthority),
    );
    if (immutableGraph.kind !== "loaded") {
      throw new Error(`Expected immutable graph: ${JSON.stringify(immutableGraph)}`);
    }
    expect(immutableGraph.evidence.application).toMatchObject({
      activationSequence: active.basis.activationSequence,
    });
    expect(graphQueries.indexOf("applicationGraphSizes")).toBeLessThan(
      graphQueries.indexOf("applicationGraphPayload"),
    );
    expect(graphQueries.indexOf("applicationSchemaAuthoritySizes")).toBeLessThan(
      graphQueries.indexOf("applicationSchemaAuthorityPayload"),
    );

    const foreignGrant = await runEffect(Effect.result(
      sessionActivation.activateEffect(Object.freeze({
        ...input,
        evidence: Object.freeze({
          ...input.evidence,
          requestKey: TransactionRequestKeyV1Schema.make(
            "request:application:foreign-grant",
          ),
          verifiedGrant: Object.freeze({ grant: "legacy" }),
        }),
      }) as unknown as typeof input),
    ));
    expect(Result.isFailure(foreignGrant)).toBe(true);

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    await expect(runEffect(graphLoader.loadEffect(executionAuthority))).resolves
      .toMatchObject({ kind: "loaded" });
    const missingControlGraph = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1({
        scopeMetadata: fixture.control,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async locator =>
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              fixture.target,
              locator,
            ),
        },
      }).loadEffect(executionAuthority),
    );
    expect(missingControlGraph).toMatchObject({
      kind: "corrupt",
      reason: "schemaArtifactMissingOrDuplicate",
    });
    await fixture.target.query(
      `update fx_system_tx_session
          set application_execution_authority_json = jsonb_set(
            application_execution_authority_json,
            '{version}',
            '1e100'::jsonb
          )
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    await expect(runEffect(graphLoader.loadEffect(executionAuthority))).resolves
      .toMatchObject({ kind: "corrupt" });
    await fixture.target.query(
      `update fx_system_tx_session
          set application_execution_authority_json = jsonb_set(
            application_execution_authority_json,
            '{version}',
            '1'::jsonb
          )
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    await fixture.target.query(
      `update fx_system_tx_session
          set validated_args_canonical_bytes =
            convert_to(repeat('x', 67108865), 'UTF8')
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    const overflowQueries: string[] = [];
    const overflowGraph = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1({
        scopeMetadata: fixture.control,
        applicationControlDb: fixture.control.drizzle,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async locator =>
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              fixture.target,
              locator,
            ),
        },
      }, { observeQuery: query => overflowQueries.push(query.name) })
        .loadEffect(executionAuthority),
    );
    expect(overflowGraph).toMatchObject({
      kind: "corrupt",
      reason: "evidenceLimitExceeded",
    });
    expect(overflowQueries).not.toContain("authorityPayload");
    expect(overflowQueries).not.toContain("applicationGraphPayload");
    expect(overflowQueries).not.toContain("applicationSchemaAuthorityPayload");
    await fixture.target.query(
      `update fx_system_tx_session
          set validated_args_canonical_bytes = $2
        where session_id = $1`,
      [created.anchor.sessionId, input.evidence.validatedArgsCanonicalBytes],
    );
    const afterHeadMovement = await runEffect(
      sessionActivation.activateEffect(input),
    );
    expect(afterHeadMovement).toMatchObject({
      status: "busy",
      anchor: created.anchor,
    });
    const staleAdmission = await runEffect(Effect.result(
      sessionActivation.activateEffect(staleNewRequest),
    ));
    expect(Result.isFailure(staleAdmission)).toBe(true);
    if (Result.isFailure(staleAdmission)) {
      expect(staleAdmission.failure).toMatchObject({
        operation: "validateSelection",
        reason: "storedState",
      });
    }
    const conflictingReplay = await runEffect(Effect.result(
      sessionActivation.activateEffect(Object.freeze({
        ...input,
        evidence: Object.freeze({
          ...input.evidence,
          validatedArgsJson: Object.freeze({ body: "conflicting" }),
        }),
      })),
    ));
    expect(Result.isFailure(conflictingReplay)).toBe(true);
    if (Result.isFailure(conflictingReplay)) {
      expect(conflictingReplay.failure).toMatchObject({
        issue: { reason: "invalidPreparedEvidence" },
      });
    }
    expect(await scalarCount(fixture.target, "fx_system_tx_session")).toBe(1);
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({
      entryBytes: new Uint8Array([1]),
    }).where(eq(
      fxSystemApplicationFunctionsV1.functionPath,
      input.evidence.functionPath,
    ));
    await expect(runEffect(graphLoader.loadEffect(executionAuthority))).resolves
      .toMatchObject({ kind: "corrupt", reason: "applicationGraphInvalid" });
  })

  it("selects an exact public Application mutation and rejects a stale admitted head", async () => {
    const fixture = await readinessFixture({ functionKind: "mutation" });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const context = Object.freeze({
      deploymentId: fixture.input.deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    });

    await fixture.control.insertScopeMetadata({
      deploymentId: fixture.input.deploymentId,
      scopeId: ScopeIdSchema.make("scope_application_mutation_admission_peer"),
      physicalLocator: LOCATOR,
    });
    await expect(fixture.control.getScopeMetadataByDeploymentId(fixture.input.deploymentId))
      .rejects.toMatchObject({ name: "ScopeDeploymentAmbiguousError" });

    const admitted = await runEffect(selectApplicationMutationAdmission(
      active.selection,
      "users:get",
      context,
    ));
    expect(admitted.basis.revisionId).toBe(fixture.input.revisionId);
    expect(admitted.executionAuthority.authority).toMatchObject({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      activationSequence: active.basis.activationSequence.toString(),
      activeHeadSha256: encodeBytesToLowercaseHex(active.basis.headSha256),
      schemaVersionId: active.basis.schemaVersionId,
      runtimeTarget: {
        revisionId: fixture.input.revisionId,
        function: {
          path: "users:get",
          kind: "mutation",
          visibility: "public",
        },
      },
    });

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    const stale = await runEffect(Effect.result(
      selectApplicationMutationAdmission(
        active.selection,
        "users:get",
        context,
      ),
    ));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({
        operation: "validateSelection",
        reason: "storedState",
      });
    }
  })
});
