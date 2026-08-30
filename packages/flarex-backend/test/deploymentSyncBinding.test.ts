import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  captureDeploymentQuerySyncBinding,
  consumeDeploymentQuerySyncFreshInitialization,
  makeDeploymentQuerySyncFreshInitializationCapabilityForTest,
  releaseDeploymentQuerySyncFreshInitialization,
  reserveDeploymentQuerySyncFreshInitialization,
  type DeploymentQuerySyncBinding,
  type DeploymentQuerySyncFreshInitializationReservation,
  type DeploymentQuerySyncFreshReservationAttempt,
} from "../src/deploymentSync/Binding";
import {
  FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
} from "../src/deploymentSync/QuerySyncModel";

const scopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000001",
);
const otherScopeUuid = ScopeUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000002",
);
const epochUuid = ScopeEpochUuidV1Schema.make(
  "00000000-0000-4000-8000-000000000003",
);
const objectName = `deployment-sync:${scopeUuid}`;

describe("deployment query-sync binding", () => {
  it("captures exact route and trusted active-head evidence", () => {
    const observation = activeHeadObservation();
    const binding = expectSuccess(captureDeploymentQuerySyncBinding({
      objectId: objectIdWithName(objectName),
      observation,
    }));

    expect(binding).toEqual({
      objectName,
      scopeUuid,
      namespaceId: scopeUuid,
      syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
      epochUuid,
      sourceEpoch: epochUuid,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9n,
      observedAtCommitSeq: 7n,
      observedThroughSequence: 7n,
      bootstrapCursor: {
        namespaceId: scopeUuid,
        syncModelId: FLAREX_APPLICATION_QUERY_SYNC_MODEL_ID_V1,
        sourceEpoch: epochUuid,
        appliedThroughSequence: 7n,
      },
      activationSequence: 3n,
      activeHeadSha256Hex: "11".repeat(32),
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.bootstrapCursor)).toBe(true);
  });

  it("rejects an unnamed Durable Object placement", () => {
    const failure = expectFailure(captureDeploymentQuerySyncBinding({
      objectId: objectIdWithName(undefined),
      observation: activeHeadObservation(),
    }));

    expect(failure).toMatchObject({
      _tag: "DeploymentQuerySyncBindingError",
      reason: "objectNameMissing",
      expected: "deployment-sync:<canonical-lowercase-scope-uuid>",
      observed: null,
      cause: null,
    });
  });

  it.each([
    "deployment-sync:",
    `deployment-sync:${scopeUuid}:extra`,
    `deployment-sync:${scopeUuid.slice(0, -1)}`,
    "deployment-sync:00000000-0000-4000-8000-ABCDEFABCDEF",
    `other-object:${scopeUuid}`,
  ])("rejects malformed or non-canonical object name %s", (malformedName) => {
    const failure = expectFailure(captureDeploymentQuerySyncBinding({
      objectId: objectIdWithName(malformedName),
      observation: activeHeadObservation(),
    }));

    expect(failure).toMatchObject({
      _tag: "DeploymentQuerySyncBindingError",
      reason: "objectNameInvalid",
      expected: "deployment-sync:<canonical-lowercase-scope-uuid>",
      observed: malformedName,
    });
  });

  it("rejects a route scope that differs from trusted observation", () => {
    const failure = expectFailure(captureDeploymentQuerySyncBinding({
      objectId: objectIdWithName(`deployment-sync:${otherScopeUuid}`),
      observation: activeHeadObservation(),
    }));

    expect(failure).toMatchObject({
      _tag: "DeploymentQuerySyncBindingError",
      reason: "routeScopeMismatch",
      expected: scopeUuid,
      observed: otherScopeUuid,
      cause: null,
    });
  });
});

describe("deployment query-sync fresh initialization capability", () => {
  it("distinguishes absence and forged handles without consuming authority", () => {
    const binding = captureBinding(scopeUuid);
    const absent = reserveDeploymentQuerySyncFreshInitialization(
      undefined,
      binding,
    );
    const forged = Object.freeze({});
    const forgedAttempt = reserveDeploymentQuerySyncFreshInitialization(
      // @ts-expect-error Exercises the runtime trust boundary with a forgery.
      forged,
      binding,
    );

    expect(absent).toEqual({ _tag: "absent" });
    expect(forgedAttempt).toEqual({ _tag: "invalid" });
    expect(Object.isFrozen(absent)).toBe(true);
    expect(Object.isFrozen(forgedAttempt)).toBe(true);
  });

  it("fails a crossed binding closed and preserves the original authority", () => {
    const binding = captureBinding(scopeUuid);
    const crossedBinding = captureBinding(otherScopeUuid);
    const capability =
      makeDeploymentQuerySyncFreshInitializationCapabilityForTest(binding);

    expect(reserveDeploymentQuerySyncFreshInitialization(
      capability,
      crossedBinding,
    )).toEqual({ _tag: "invalid" });

    const reservation = expectReserved(
      reserveDeploymentQuerySyncFreshInitialization(capability, binding),
    );
    releaseDeploymentQuerySyncFreshInitialization(reservation);
  });

  it("freezes handles, rejects concurrent reservation, and releases on rollback", () => {
    const binding = captureBinding(scopeUuid);
    const capability =
      makeDeploymentQuerySyncFreshInitializationCapabilityForTest(binding);
    const firstReservation = expectReserved(
      reserveDeploymentQuerySyncFreshInitialization(capability, binding),
    );

    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.isFrozen(firstReservation)).toBe(true);
    expect(Reflect.set(capability, "forged", true)).toBe(false);
    expect(reserveDeploymentQuerySyncFreshInitialization(
      capability,
      binding,
    )).toEqual({ _tag: "invalid" });

    releaseDeploymentQuerySyncFreshInitialization(firstReservation);
    expect(() => consumeDeploymentQuerySyncFreshInitialization(
      firstReservation,
    )).toThrow("Invalid deployment query-sync fresh reservation.");

    const secondReservation = expectReserved(
      reserveDeploymentQuerySyncFreshInitialization(capability, binding),
    );
    consumeDeploymentQuerySyncFreshInitialization(secondReservation);
    expect(reserveDeploymentQuerySyncFreshInitialization(
      capability,
      binding,
    )).toEqual({ _tag: "consumed" });
  });

  it("rejects forged, released, and consumed reservation reuse", () => {
    const binding = captureBinding(scopeUuid);
    const capability =
      makeDeploymentQuerySyncFreshInitializationCapabilityForTest(binding);
    const released = expectReserved(
      reserveDeploymentQuerySyncFreshInitialization(capability, binding),
    );
    releaseDeploymentQuerySyncFreshInitialization(released);

    expect(() => releaseDeploymentQuerySyncFreshInitialization(
      released,
    )).toThrow("Invalid deployment query-sync fresh reservation.");

    const consumed = expectReserved(
      reserveDeploymentQuerySyncFreshInitialization(capability, binding),
    );
    consumeDeploymentQuerySyncFreshInitialization(consumed);
    expect(() => consumeDeploymentQuerySyncFreshInitialization(
      consumed,
    )).toThrow("Invalid deployment query-sync fresh reservation.");

    const forged = Object.freeze({});
    expect(() => consumeDeploymentQuerySyncFreshInitialization(
      // @ts-expect-error Exercises the runtime trust boundary with a forgery.
      forged,
    )).toThrow("Invalid deployment query-sync fresh reservation.");
  });
});

function captureBinding(bindingScopeUuid: typeof scopeUuid):
  DeploymentQuerySyncBinding {
  return expectSuccess(captureDeploymentQuerySyncBinding({
    objectId: objectIdWithName(`deployment-sync:${bindingScopeUuid}`),
    observation: activeHeadObservation(bindingScopeUuid),
  }));
}

function activeHeadObservation(
  observationScopeUuid: typeof scopeUuid = scopeUuid,
) {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: observationScopeUuid,
    epochUuid,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(9n),
    observedAtCommitSeq: CommitSeqSchema.make(7n),
    activationSequence: ApplicationActivationSequenceV1Schema.make(3n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "11".repeat(32),
    ),
  });
}

function objectIdWithName(
  name: string | undefined,
): Pick<DurableObjectId, "name"> {
  return name === undefined
    ? Object.freeze({})
    : Object.freeze({ name });
}

function expectReserved(
  attempt: DeploymentQuerySyncFreshReservationAttempt,
): DeploymentQuerySyncFreshInitializationReservation {
  if (attempt._tag !== "reserved") {
    throw new Error(`Expected a reservation, received ${attempt._tag}.`);
  }
  expect(Object.isFrozen(attempt)).toBe(true);
  return attempt.reservation;
}

function expectSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: (failure) => {
      throw failure;
    },
    onSuccess: success => success,
  });
}

function expectFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected Result failure.");
    },
  });
}
