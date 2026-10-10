import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import { decodeCatalogEdgeDefinitionId, decodeCatalogTableId } from "flarex-protocol/catalog";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  advanceAppUniqueConstraintSetBackfillV1Effect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import {
  validateApplicationReadinessForActivationInTransaction,
  validateStoredApplicationReadinessForActivationInTransaction,
} from "../../../src/application/readiness/acceptance";
import {
  ApplicationActiveHeadStateError,
} from "../../../src/application/activeHead/errors";
import {
  createApplicationRelationServingInspector,
  inspectApplicationRelationServingDefinitionInTransactionEffect,
} from "../../../src/application/relations/applicationRelationServing";
import {
  claimApplicationActiveSelection,
} from "../../../src/application/activation/selectionIdentity";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  prepareApplicationBindingSelection,
} from "../../../src/application/activation/repositoryIdentity";
import {
  validateApplicationActiveSelectionInTransaction,
} from "../../../src/application/activation/bindingAcceptance";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../../../src/execution/readCommittedTransactionFailure";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "../../../src/database/locatedTransactionIdentity";
import type { AppRowTransaction } from "../../../src/storage/documents/appRows";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
} from "../../../src/storage/indexes/indexBuildReconciliation";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import {
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../../../src/installation/physicalDefinitionLifecycle";
import {
  fxSystemApplicationActiveHeads,
  fxSystemApplicationActivations,
} from "../../../src/application/applicationActivationSchema";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
} from "../../../src/scope/scopeClock";
import {
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
} from "../../../src/database/schema";
import { RUNTIME_HOST_IDENTITY, COMPATIBILITY_DATE, LOCATOR } from "../support/readinessArtifacts";
import { readinessFixture } from "../support/readinessFixture";
import {
  prepareReadinessAuthorities,
  enablePhysicalBuilds,
  closeEmptyUniqueConstraintSet,
  settleCandidateValidation,
  applicationSchemaVersionId,
} from "../support/readinessPreparation";
import { createAdditionalApplicationRevision } from "../support/readinessPublication";
import { scalarCount } from "../support/readinessEvidence";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application activation/active", { timeout: 30_000 }, () => {
  it("keeps readiness and active selection on the chosen scope after a peer shop joins the deployment", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    await fixture.control.insertScopeMetadata({
      deploymentId: fixture.input.deploymentId,
      scopeId: ScopeIdSchema.make("scope_application_readiness_peer"),
      physicalLocator: LOCATOR,
    });

    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({ status: "ready", disposition: "replayed", scopeId: fixture.input.scopeId });
    expect(await runEffect(fixture.repository.readReady(fixture.input)))
      .toMatchObject({ status: "ready", scopeId: fixture.input.scopeId });
    expect(await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }))).toMatchObject({ disposition: "replayed", scopeId: fixture.input.scopeId });
    expect(await runEffect(activation.readActive()))
      .toMatchObject({ expectedActiveHead: first.expectedActiveHead, basis: { authority: { scopeId: fixture.input.scopeId } } });
  })

  it("keeps an active Application with an enabled unique definition readable after a peer shop joins", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({ status: "not_ready", reason: "candidateValidationMissing" });
    const schemaVersionId = await applicationSchemaVersionId(fixture.control);
    const prepared = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(
      fixture.control.drizzle,
      {
        deploymentId: fixture.input.deploymentId,
        schemaVersionId,
        tableId: decodeCatalogTableId(1),
        descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_name_unique"),
        physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["name"],
          sparse: false,
          localePolicy: { kind: "none" },
          keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }),
      },
    ));
    await fixture.control.drizzle.transaction(tx => runEffect(
      ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
    ));
    await closeEmptyUniqueConstraintSet(fixture, schemaVersionId);
    await settleCandidateValidation(fixture, schemaVersionId);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const uniquePorts = { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts };
    const uniqueInput = { deploymentId: fixture.input.deploymentId, scopeId: fixture.input.scopeId, schemaVersionId };
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, uniqueInput));
    let enabled = false;
    for (let step = 0; step < 8; step += 1) {
      const progress = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts, { ...uniqueInput, pageSize: 16 }));
      if (progress.lifecycle === "enabled") { enabled = true; break; }
    }
    expect(enabled).toBe(true);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    await fixture.control.insertScopeMetadata({
      deploymentId: fixture.input.deploymentId,
      scopeId: ScopeIdSchema.make("scope_application_unique_peer"),
      physicalLocator: LOCATOR,
    });

    expect(await runEffect(activation.readActive()))
      .toMatchObject({ expectedActiveHead: first.expectedActiveHead, basis: { authority: { scopeId: fixture.input.scopeId } } });
  })

  it("closes readiness and active selection while a required definition drains", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({ status: "ready", disposition: "inserted" });
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
    const requirements = await runEffect(
      loadPublishedPhysicalRequirementSnapshotV1(
        fixture.control.drizzle,
        Object.freeze({
          deploymentId: fixture.input.deploymentId,
          schemaVersionId,
        }),
      ),
    );
    const definition = requirements?.definitions[0];
    if (definition === undefined) {
      throw new Error("Expected one required physical definition.");
    }
    const subject = await runEffect(
      preparePhysicalDefinitionLifecycleSubjectEffect(
        fixture.physicalDefinitionLifecycle,
        Object.freeze({
          definitionKind: "index",
          deploymentId: fixture.input.deploymentId,
          scopeId: fixture.input.scopeId,
          indexDefinitionId: definition.indexDefinitionId,
        }),
      ),
    );
    const draining = await runEffect(beginPhysicalDefinitionDrainingEffect(
      subject,
      Object.freeze({ expectedTransitionFence: 0n }),
    ));
    expect(draining.lifecycle).toMatchObject({
      lifecycle: "draining",
      transitionFence: 1n,
    });
    const buildPorts = { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts };
    const buildInput = { deploymentId: fixture.input.deploymentId, scopeId: fixture.input.scopeId, indexDefinitionId: definition.indexDefinitionId, pageSize: 1 };
    await expect(runEffect(buildIntrinsicCreationTimeIndexV1Effect(buildPorts, buildInput)))
      .rejects.toMatchObject({ reason: "unsupportedLifecycle" });
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({
        status: "not_ready",
        reason: "physicalDefinitionNotActive",
        detail: `index:${definition.indexDefinitionId}:draining`,
      });
    expect(await runEffect(fixture.repository.readReady(fixture.input)))
      .toMatchObject({
        status: "not_ready",
        reason: "physicalDefinitionNotActive",
      });
    await expect(runEffect(activation.readActive())).rejects.toMatchObject({
      operation: "read",
      reason: "notReady",
    });

    await runEffect(cancelPhysicalDefinitionDrainingEffect(
      subject,
      Object.freeze({ expectedTransitionFence: 1n }),
    ));
    await expect(runEffect(buildIntrinsicCreationTimeIndexV1Effect(buildPorts, buildInput)))
      .resolves.toMatchObject({ status: "replayed", lifecycle: "enabled" });
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({ status: "ready", disposition: "replayed" });
    await expect(runEffect(activation.readActive())).resolves.toMatchObject({
      basis: { revisionId: fixture.input.revisionId },
    });
  })

  it("rejects unregistered binding readers without invoking executable activation", async () => {
    const readActive = vi.fn(() => Effect.die("Executable fallback must be removed"));
    await expect(runEffect(prepareApplicationBindingSelection({ readActive })))
      .rejects.toMatchObject({ reason: "invalidComposition" });
    expect(readActive).not.toHaveBeenCalled();
  })

  it("fails closed when durable readiness disappears before an active read", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const ready = await runEffect(fixture.repository.settle(fixture.input));
    expect(ready).toMatchObject({ status: "ready" });
    await fixture.target.drizzle.delete(
      fxSystemApplicationReadinessFunctionsV1,
    ).where(eq(
      fxSystemApplicationReadinessFunctionsV1.scopeId,
      fixture.authority.scopeId,
    ));
    await fixture.target.drizzle.delete(fxSystemApplicationReadinessV1).where(
      eq(fxSystemApplicationReadinessV1.scopeId, fixture.authority.scopeId),
    );

    const result = await runEffect(Effect.result(
      fixture.repository.readReady(fixture.input),
    ));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        operation: "readReady",
        reason: "storedState",
      });
    }
  })

  it("revalidates the stored application graph inside the activation transaction", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const settled = await runEffect(fixture.repository.settle(fixture.input));
    expect(settled).toMatchObject({ status: "ready" });
    const issued = await runEffect(fixture.repository.readReady(fixture.input));
    expect(issued).toMatchObject({ status: "ready" });
    const activationBypass = await fixture.target.drizzle.transaction(tx =>
      runEffect(Effect.result(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateApplicationReadinessForActivationInTransaction(
          fixture.repository,
          issued,
          tx,
          clock,
        );
      })))
    );
    expect(Result.isFailure(activationBypass)).toBe(true);
    if (Result.isFailure(activationBypass)) {
      expect(activationBypass.failure).toMatchObject({
        reason: "invalidComposition",
      });
    }
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({
      entryBytes: new Uint8Array([1]),
    }).where(eq(
      fxSystemApplicationFunctionsV1.scopeId,
      fixture.authority.scopeId,
    ));

    const result = await fixture.target.drizzle.transaction(tx => runEffect(
      Effect.result(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateStoredApplicationReadinessForActivationInTransaction(
          fixture.repository,
          issued,
          tx,
          clock,
        );
      })),
    ));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedState" });
    }
  })

  it("activates by explicit CAS, exactly replays, and issues one authentic selection", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });

    const staleInitial = await runEffect(Effect.result(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: Object.freeze({
        activationSequence: 1n,
        headSha256: "0".repeat(64),
      }),
    })));
    expect(Result.isFailure(staleInitial)).toBe(true);
    if (Result.isFailure(staleInitial)) {
      expect(staleInitial.failure).toMatchObject({ reason: "expectedHead" });
    }

    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const replay = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    expect(first).toMatchObject({
      status: "activated",
      disposition: "inserted",
      activationSequence: 1n,
      previousActivationSequence: null,
    });
    expect(replay).toMatchObject({
      ...first,
      disposition: "replayed",
    });
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);

    const active = await runEffect(activation.readActive());
    expect(active.expectedActiveHead).toEqual(first.expectedActiveHead);
    expect(active.basis).toMatchObject({
      revisionId: fixture.input.revisionId,
      candidateId: expect.any(String),
      analysisId: expect.any(String),
      schemaVersionId: expect.stringMatching(/^application_/),
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      activationSequence: 1n,
    });
    expect(Result.isSuccess(claimApplicationActiveSelection(
      active.selection,
    ))).toBe(true);
    expect(Result.isFailure(claimApplicationActiveSelection(
      Object.freeze({ ...active.selection }),
    ))).toBe(true);

    const validated = await fixture.target.drizzle.transaction(tx => runEffect(
      Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateApplicationActiveSelectionInTransaction(
          active.selection,
          tx,
          clock,
        );
      }),
    ));
    expect(validated.revisionId).toBe(fixture.input.revisionId);
    const receiptIdentity = eq(fxSystemApplicationActivations.scopeId, fixture.authority.scopeId);
    const originalReceipt = (await fixture.target.drizzle.select().from(fxSystemApplicationActivations).where(receiptIdentity))[0];
    if (!originalReceipt) throw new Error("Missing committed activation receipt");
    await fixture.target.drizzle.update(fxSystemApplicationActivations).set({ activationBytes: new TextEncoder().encode("{}") }).where(receiptIdentity);
    try {
      const corruptReplay = await runEffect(Effect.result(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null })));
      expect(Result.isFailure(corruptReplay)).toBe(true);
      if (Result.isFailure(corruptReplay)) expect(corruptReplay.failure).toMatchObject({ reason: "storedState" });
    } finally { await fixture.target.drizzle.update(fxSystemApplicationActivations).set(originalReceipt).where(receiptIdentity); }
  })

  it("classifies retained active readiness as non-serving and rejects a corrupt active head", async () => {
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
    const inspector = createApplicationRelationServingInspector();
    const edgeDefinitionId = decodeCatalogEdgeDefinitionId(1);
    const inspection = await fixture.target.drizzle.transaction(async (tx) => {
      const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(
        tx,
        active.basis.authority.scopeId,
      ));
      return runEffect(
        inspectApplicationRelationServingDefinitionInTransactionEffect(
          inspector,
          tx,
          {
            authority: active.basis.authority,
            clock,
            edgeDefinitionId,
          },
        ),
      );
    });
    expect(inspection).toEqual({
      status: "not_serving",
      reason: "active_readiness_v1",
      edgeDefinitionId,
      activeRevisionId: fixture.input.revisionId,
    });

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    const corrupt = await fixture.target.drizzle.transaction(async (tx) => {
      const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(
        tx,
        active.basis.authority.scopeId,
      ));
      return runEffectFailure(
        inspectApplicationRelationServingDefinitionInTransactionEffect(
          inspector,
          tx,
          {
            authority: active.basis.authority,
            clock,
            edgeDefinitionId,
          },
        ),
      );
    });
    expect(corrupt).toBeInstanceOf(ApplicationActiveHeadStateError);
    expect(corrupt).toMatchObject({ reason: "storedState" });
  })

  it("rolls back history and head together after a late injected failure", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
      faultAfter: point => {
        if (point === "headWritten") throw new Error("injected late failure");
      },
    });

    const result = await runEffect(Effect.result(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    })));

    expect(Result.isFailure(result)).toBe(true);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(0);
  })

  it("surfaces a committed uncertain activation and cold-replays its exact history", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const resolved = await fixture.authorityPorts.scopeClockTargets.resolve();
    const runner = Reflect.get(
      resolved,
      RUN_LOCATED_READ_COMMITTED_V1,
    );
    if (typeof runner !== "function") {
      throw new Error("Expected the located read-committed runner.");
    }
    const runReadCommitted = runner as RunLocatedReadCommittedTransactionV1;
    let uncertain = true;
    const uncertainTarget = Object.freeze({
      ...resolved,
      [RUN_LOCATED_READ_COMMITTED_V1]: async <Value>(
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> => {
        const result = await runReadCommitted(work);
        if (uncertain && typeof result === "object" && result !== null &&
          Reflect.get(result, "status") === "activated") {
          uncertain = false;
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost Application activation response"),
          }));
        }
        return result;
      },
    });
    const originalResolve = fixture.authorityPorts.scopeClockTargets.resolve;
    fixture.authorityPorts.scopeClockTargets.resolve = async () =>
      uncertainTarget;
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });

    const first = await runEffect(Effect.result(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    })));
    expect(Result.isFailure(first)).toBe(true);
    if (Result.isFailure(first)) {
      expect(first.failure).toMatchObject({ reason: "decisionUncertain" });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);

    const replay = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    expect(replay).toMatchObject({
      disposition: "replayed",
      activationSequence: 1n,
    });
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);
  })

  it("fails closed when the active-head canonical evidence is corrupted", async () => {
    const fixture = await readinessFixture();
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
    await fixture.target.query(
      `update fx_system_application_active_head
          set head_bytes = $1
        where scope_id = $2`,
      [new Uint8Array([1]), fixture.authority.scopeId],
    );

    const result = await runEffect(Effect.result(activation.readActive()));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedState" });
    }
  })

  it("moves the head with the prior CAS token and invalidates the issued selection", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const firstSelection = await runEffect(activation.readActive());
    const nextRevisionId = await createAdditionalApplicationRevision(fixture);
    const nextReadiness = await runEffect(fixture.repository.settle({
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      revisionId: nextRevisionId,
    }));
    expect(nextReadiness).toMatchObject({ status: "ready" });

    const stale = await runEffect(Effect.result(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: Object.freeze({
        activationSequence: first.expectedActiveHead.activationSequence,
        headSha256: "0".repeat(64),
      }),
    })));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({ reason: "expectedHead" });
    }
    const second = await runEffect(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: first.expectedActiveHead,
    }));
    expect(second).toMatchObject({
      activationSequence: 2n,
      previousActivationSequence: 1n,
    });
    const staleSelection = await fixture.target.drizzle.transaction(tx =>
      runEffect(Effect.result(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateApplicationActiveSelectionInTransaction(
          firstSelection.selection,
          tx,
          clock,
        );
      })))
    );
    expect(Result.isFailure(staleSelection)).toBe(true);
    if (Result.isFailure(staleSelection)) {
      expect(staleSelection.failure).toMatchObject({ reason: "concurrentHead" });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(2);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);
  })
});
