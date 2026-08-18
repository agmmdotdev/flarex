import {
  decodeApplicationTaskRunCreationAuthorityV1,
  decodeApplicationTaskRuntimeTargetV1,
  type ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { ApplicationActivationError } from
  "@flarex/persistence-postgres/internal/application-activation";
import type {
  ApplicationActiveSelection,
  ApplicationActiveSelectionBasis,
} from
  "@flarex/persistence-postgres/internal/application-activation";
import { createApplicationNativeMutationPGliteFixture } from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  correlateApplicationTaskQuerySelection,
  makeApplicationTaskQueryAuthority,
  type ApplicationTaskQuerySelectionBasis,
} from "../src/ApplicationTaskQueryAuthority";

const STALE_BASIS_FIELDS = [
  "scopeId",
  "activationSequence",
  "headSha256",
  "readinessSha256",
  "revisionId",
  "candidateId",
  "analysisId",
  "sourceArtifactRootSha256",
  "publicationSha256",
  "taskCatalogSha256",
  "taskCatalogBindingSha256",
  "runtimeHostIdentity",
  "compatibilityDate",
] as const;

const RUNTIME_TARGET_DRIFT_FIELDS = [
  "applicationTaskDefinitionBindingSha256",
  "taskId",
  "canonicalTaskManifestSha256",
  "handlerLogicalModulePath",
  "handlerSourceModulePath",
  "handlerExportName",
] as const;

describe("Application Task query authority", () => {
  it("correlates the exact active Application selection with the launch subject", () => {
    const fixture = authorityFixture();

    expect(Result.isSuccess(correlateApplicationTaskQuerySelection(
      fixture.subject,
      fixture.basis,
    ))).toBe(true);
  });

  it.each(STALE_BASIS_FIELDS)("rejects stale %s evidence", field => {
    const fixture = authorityFixture();
    const basis = driftSelectionBasis(fixture.basis, field);

    const result = correlateApplicationTaskQuerySelection(
      fixture.subject,
      basis,
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.reason).toBe("staleLaunch");
  });

  it.each(RUNTIME_TARGET_DRIFT_FIELDS)(
    "rejects runtime-target %s drift inside the creation authority",
    field => {
      const fixture = authorityFixture();
      const driftedTarget = driftRuntimeTarget(
        fixture.subject.runtimeTarget,
        field,
      );

      const result = correlateApplicationTaskQuerySelection({
        ...fixture.subject,
        runtimeTarget: driftedTarget,
      }, fixture.basis);

      expect(Result.isFailure(result)).toBe(true);
    },
  );

  it("rejects a blank function path before reading activation authority", async () => {
    const fixture = authorityFixture();
    let activationCalls = 0;
    let queryCalls = 0;
    const authority = makeApplicationTaskQueryAuthority({
      activation: {
        readActive: () => {
          activationCalls += 1;
          return Effect.fail(activationUnavailable("must not read activation"));
        },
      },
      query: {
        runQuery: () => Effect.sync(() => {
          queryCalls += 1;
          return null;
        }),
      },
    });
    const session = Result.getOrThrow(authority.bindLaunch(fixture.subject));

    const failure = await Effect.runPromise(session.runQuery(
      "   ",
      normalizeFlarexValueV1({}).value,
    ).pipe(Effect.flip));

    expect(failure.reason).toBe("invalidInput");
    expect(activationCalls).toBe(0);
    expect(queryCalls).toBe(0);
  });

  it("preserves the activation receiver and maps read failure before query", async () => {
    const fixture = authorityFixture();
    let queryCalls = 0;
    const activation = {
      readActive() {
        expect(this).toBe(activation);
        return Effect.fail(activationUnavailable("activation offline"));
      },
    };
    const authority = makeApplicationTaskQueryAuthority({
      activation,
      query: {
        runQuery: () => Effect.sync(() => {
          queryCalls += 1;
          return null;
        }),
      },
    });
    const session = Result.getOrThrow(authority.bindLaunch(fixture.subject));

    const failure = await Effect.runPromise(session.runQuery(
      "orders:status",
      normalizeFlarexValueV1({ orderId: "order-1" }).value,
    ).pipe(Effect.flip));

    expect(failure.reason).toBe("activationUnavailable");
    expect(failure.cause).toBeInstanceOf(ApplicationActivationError);
    expect(failure.cause).toMatchObject({ cause: "activation offline" });
    expect(queryCalls).toBe(0);
  });

  it("binds one launch to the genuine active selection and rejects later head movement", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.application-task-runtime",
      compatibilityDate: "2026-06-14",
      includeTask: true,
    });
    const launch = launchEvidenceForBasis(fixture.active.basis);
    const selections: unknown[] = [];
    let queryMode: "success" | "failure" | "invalid" = "success";
    const activation = {
      readActive() {
        expect(this).toBe(activation);
        return fixture.activation.readActive();
      },
    };
    const query = {
      runQuery(
        selection: ApplicationActiveSelection,
        functionPath: string,
        argumentsValue: unknown,
      ) {
        expect(this).toBe(query);
        expect(functionPath).toBe("users:get");
        expect(argumentsValue).toEqual({ id: "document-1" });
        selections.push(selection);
        return queryMode === "failure"
          ? Effect.fail("query offline")
          : Effect.succeed(queryMode === "invalid" ? Symbol("invalid") : {
            name: "Ada",
          });
      },
    };
    const authority = makeApplicationTaskQueryAuthority({ activation, query });
    const session = Result.getOrThrow(authority.bindLaunch(launch));

    launch.creationAuthority.activeHeadSha256[0] ^= 0xff;
    launch.runtimeTarget.taskCatalogSha256[0] ^= 0xff;
    const result = await Effect.runPromise(session.runQuery(
      "users:get",
      normalizeFlarexValueV1({ id: "document-1" }).value,
    ));
    expect(result).toEqual({ name: "Ada" });
    expect(selections).toEqual([fixture.active.selection]);

    queryMode = "failure";
    const queryFailure = await Effect.runPromise(session.runQuery(
      "users:get",
      normalizeFlarexValueV1({ id: "document-1" }).value,
    ).pipe(Effect.flip));
    expect(queryFailure).toMatchObject({
      reason: "queryFailed",
      cause: "query offline",
    });

    queryMode = "invalid";
    const invalidResult = await Effect.runPromise(session.runQuery(
      "users:get",
      normalizeFlarexValueV1({ id: "document-1" }).value,
    ).pipe(Effect.flip));
    expect(invalidResult.reason).toBe("invalidResult");

    await fixture.moveHead();
    queryMode = "success";
    const stale = await Effect.runPromise(session.runQuery(
      "users:get",
      normalizeFlarexValueV1({ id: "document-1" }).value,
    ).pipe(Effect.flip));
    expect(stale.reason).toBe("staleLaunch");
    expect(selections).toHaveLength(3);
  });
});

function authorityFixture() {
  const target = Result.getOrThrow(decodeApplicationTaskRuntimeTargetV1({
    version: 1,
    scopeId: "scope-query",
    revisionId: "revision-query",
    candidateId: "candidate-query",
    analysisId: "analysis-query",
    sourceArtifactRootSha256: "11".repeat(32),
    publicationSha256: "22".repeat(32),
    applicationTaskCatalogBindingSha256: digest(0x31),
    applicationTaskDefinitionBindingSha256: digest(0x32),
    taskCatalogSha256: digest(0x33),
    taskId: "orders.process",
    canonicalTaskManifestSha256: digest(0x34),
    handler: {
      logicalModulePath: "tasks/orders",
      sourceModulePath: "tasks/orders.js",
      exportName: "run",
    },
    runtimeHostIdentity: "flarex.application-task-runtime",
    compatibilityDate: "2026-06-14",
  }));
  const creationAuthority = Result.getOrThrow(
    decodeApplicationTaskRunCreationAuthorityV1({
      version: 1,
      scopeId: target.scopeId,
      activationSequence: 7n,
      activeHeadSha256: digest(0x41),
      readinessSha256: digest(0x42),
      runtimeTarget: target,
      applicationTaskRuntimeTargetSha256: digest(0x43),
    }),
  );
  return Object.freeze({
    subject: Object.freeze({ creationAuthority, runtimeTarget: target }),
    basis: Object.freeze({
      authority: Object.freeze({ scopeId: ScopeIdSchema.make(target.scopeId) }),
      activationSequence: creationAuthority.activationSequence,
      headSha256: new Uint8Array(creationAuthority.activeHeadSha256),
      readinessSha256: new Uint8Array(creationAuthority.readinessSha256),
      revisionId: target.revisionId,
      candidateId: target.candidateId,
      analysisId: target.analysisId,
      sourceArtifactRootSha256: digest(0x11),
      publicationSha256: digest(0x22),
      taskCatalogSha256: new Uint8Array(target.taskCatalogSha256),
      taskCatalogBindingSha256:
        new Uint8Array(target.applicationTaskCatalogBindingSha256),
      runtimeHostIdentity: target.runtimeHostIdentity,
      compatibilityDate: target.compatibilityDate,
    }),
  });
}

function digest(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function launchEvidenceForBasis(basis: ApplicationActiveSelectionBasis) {
  const runtimeTarget = Result.getOrThrow(decodeApplicationTaskRuntimeTargetV1({
    version: 1,
    scopeId: basis.authority.scopeId,
    revisionId: basis.revisionId,
    candidateId: basis.candidateId,
    analysisId: basis.analysisId,
    sourceArtifactRootSha256:
      encodeBytesToLowercaseHex(basis.sourceArtifactRootSha256),
    publicationSha256: encodeBytesToLowercaseHex(basis.publicationSha256),
    applicationTaskCatalogBindingSha256:
      new Uint8Array(basis.taskCatalogBindingSha256),
    applicationTaskDefinitionBindingSha256: digest(0x91),
    taskCatalogSha256: new Uint8Array(basis.taskCatalogSha256),
    taskId: "tasks.users.task",
    canonicalTaskManifestSha256: digest(0x92),
    handler: {
      logicalModulePath: "users",
      sourceModulePath: "functions/users.js",
      exportName: "task",
    },
    runtimeHostIdentity: basis.runtimeHostIdentity,
    compatibilityDate: basis.compatibilityDate,
  }));
  const creationAuthority = Result.getOrThrow(
    decodeApplicationTaskRunCreationAuthorityV1({
      version: 1,
      scopeId: basis.authority.scopeId,
      activationSequence: basis.activationSequence,
      activeHeadSha256: new Uint8Array(basis.headSha256),
      readinessSha256: new Uint8Array(basis.readinessSha256),
      runtimeTarget,
      applicationTaskRuntimeTargetSha256: digest(0x93),
    }),
  );
  return Object.freeze({ creationAuthority, runtimeTarget });
}

function driftSelectionBasis(
  basis: ApplicationTaskQuerySelectionBasis,
  field: typeof STALE_BASIS_FIELDS[number],
): ApplicationTaskQuerySelectionBasis {
  switch (field) {
    case "scopeId":
      return {
        ...basis,
        authority: { scopeId: ScopeIdSchema.make("scope-other") },
      };
    case "activationSequence":
      return { ...basis, activationSequence: basis.activationSequence + 1n };
    case "headSha256":
      return { ...basis, headSha256: digest(0x71) };
    case "readinessSha256":
      return { ...basis, readinessSha256: digest(0x72) };
    case "revisionId":
      return { ...basis, revisionId: "revision-other" };
    case "candidateId":
      return { ...basis, candidateId: "candidate-other" };
    case "analysisId":
      return { ...basis, analysisId: "analysis-other" };
    case "sourceArtifactRootSha256":
      return { ...basis, sourceArtifactRootSha256: digest(0x73) };
    case "publicationSha256":
      return { ...basis, publicationSha256: digest(0x74) };
    case "taskCatalogSha256":
      return { ...basis, taskCatalogSha256: digest(0x75) };
    case "taskCatalogBindingSha256":
      return { ...basis, taskCatalogBindingSha256: digest(0x76) };
    case "runtimeHostIdentity":
      return { ...basis, runtimeHostIdentity: "runtime-host-other" };
    case "compatibilityDate":
      return { ...basis, compatibilityDate: "2026-06-15" };
  }
}

function driftRuntimeTarget(
  target: ApplicationTaskRuntimeTargetV1,
  field: typeof RUNTIME_TARGET_DRIFT_FIELDS[number],
): ApplicationTaskRuntimeTargetV1 {
  const drifted = field === "applicationTaskDefinitionBindingSha256"
    ? { ...target, applicationTaskDefinitionBindingSha256: digest(0x81) }
    : field === "taskId"
    ? { ...target, taskId: "orders.other" }
    : field === "canonicalTaskManifestSha256"
    ? { ...target, canonicalTaskManifestSha256: digest(0x82) }
    : {
      ...target,
      handler: {
        ...target.handler,
        ...(field === "handlerLogicalModulePath"
          ? { logicalModulePath: "tasks/other" }
          : field === "handlerSourceModulePath"
          ? { sourceModulePath: "tasks/other.js" }
          : { exportName: "other" }),
      },
    };
  return Result.getOrThrow(decodeApplicationTaskRuntimeTargetV1(drifted));
}

function activationUnavailable(cause: unknown): ApplicationActivationError {
  return new ApplicationActivationError({
    operation: "read",
    reason: "resourceFailure",
    retryable: true,
    cause,
  });
}
