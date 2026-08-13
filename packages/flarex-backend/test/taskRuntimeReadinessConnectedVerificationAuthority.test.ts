import type {
  ApplicationTaskRuntimeReadinessReservationPort,
  ApplicationTaskRuntimeReadinessSnapshot,
} from
  "@flarex/persistence-postgres/internal/application-task-runtime-publication";
import type {
  TaskDefinitionSha256V1,
  TaskRuntimeObjectReferenceV1,
} from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { asNonArrayRecord } from "@flarex/utils/records";
import { Brand, Effect, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  makeTaskRuntimeReadinessColdVerificationAuthority,
} from "../src/taskRuntimeReadiness/Authority.js";
import {
  makeTaskRuntimeReadinessConnectedVerificationAuthority,
} from "../src/taskRuntimeReadiness/ConnectedAuthority.js";
import type { TaskRuntimeObjectStore } from
  "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";
import { makeTaskRuntimeReadinessFixture } from
  "./taskRuntimeReadinessFixture.js";

describe("TaskRuntimeReadinessConnectedVerificationAuthority", () => {
  it("closes reservation before cold reads and issues owned connected proof", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture();
    const baseSnapshot = snapshotFromFixture(fixture.preparationInput);
    const snapshotReads = {
      canonicalBytes: 0,
      receiptSha256: 0,
      parentEvidence: 0,
    };
    const snapshot: ApplicationTaskRuntimeReadinessSnapshot = Object.freeze({
      ...baseSnapshot,
      readReceiptCanonicalBytes: () => {
        snapshotReads.canonicalBytes += 1;
        return baseSnapshot.readReceiptCanonicalBytes();
      },
      readReceiptSha256: () => {
        snapshotReads.receiptSha256 += 1;
        return baseSnapshot.readReceiptSha256();
      },
      readParentEvidence: () => {
        snapshotReads.parentEvidence += 1;
        return baseSnapshot.readParentEvidence();
      },
    });
    let reservationActive = false;
    const reservation = Object.freeze({
      reserve: () => Effect.sync(() => {
        reservationActive = true;
        return snapshot;
      }).pipe(Effect.ensuring(Effect.sync(() => {
        reservationActive = false;
      }))),
    }) satisfies Pick<ApplicationTaskRuntimeReadinessReservationPort, "reserve">;
    const objects = new Map(fixture.objects.map(object => [
      object.readReference().objectKey,
      Object.freeze({
        reference: object.readReference(),
        bytes: object.readCanonicalBytes(),
      }),
    ]));
    const calls: string[] = [];
    const store = Object.freeze({
      read(reference: unknown) {
        expect(reservationActive).toBe(false);
        const captured = asNonArrayRecord(reference);
        const objectKey = captured?.objectKey;
        if (typeof objectKey !== "string") {
          return Effect.die("invalid connected-verification fixture reference");
        }
        calls.push(objectKey);
        const stored = objects.get(objectKey);
        return stored === undefined
          ? Effect.die("missing connected-verification fixture object")
          : Effect.succeed(Object.freeze({
              reference: stored.reference,
              bytes: copyBytes(stored.bytes),
            }));
      },
    }) satisfies Pick<TaskRuntimeObjectStore, "read">;
    const cold = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority(
        store,
        fixture.sha256,
        policyFor(fixture.objects),
      ),
    );
    const connected = Result.getOrThrow(
      makeTaskRuntimeReadinessConnectedVerificationAuthority(
        reservation,
        cold,
        fixture.preparationInput.expected.materializationPolicy,
      ),
    );

    const result = await Effect.runPromise(connected.verify({
      authority: authorityFromSnapshot(snapshot),
      revisionId: snapshot.revisionId,
    }));
    expect(result.status).toBe("verified");
    if (result.status !== "verified") throw new Error("Expected verification.");
    expect(calls).toEqual(fixture.objects.map(
      object => object.readReference().objectKey,
    ));
    expect(snapshotReads).toEqual({
      canonicalBytes: 1,
      receiptSha256: 1,
      parentEvidence: 1,
    });
    const captured = Result.getOrThrow(connected.capture(result.proof));
    expect(captured.revisionId).toBe(snapshot.revisionId);
    expect(captured.readReceiptSha256()).toEqual(
      fixture.preparationInput.receiptSha256,
    );
    expect(captured.readBasis()).toMatchObject({
      kind: "populated",
      applicationRevisionId: snapshot.revisionId,
    });
    const firstReceiptSha256 = captured.readReceiptSha256();
    firstReceiptSha256.fill(0);
    expect(captured.readReceiptSha256()).not.toEqual(firstReceiptSha256);
    const firstCanonicalBytes = captured.readCanonicalBytes();
    firstCanonicalBytes.fill(0);
    expect(captured.readCanonicalBytes()).not.toEqual(firstCanonicalBytes);
    expect(Result.isFailure(connected.capture({
      kind: "task_runtime_readiness_connected_verification",
    }))).toBe(true);
  });

  it("returns not-ready without invoking cold verification", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture(true);
    let coldCalls = 0;
    const cold = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority({
        read: () => {
          coldCalls += 1;
          return Effect.die("missing snapshot must not read objects");
        },
      }, fixture.sha256, {
        maximumObjectCount: 1,
        maximumObjectBytes: 1,
        maximumRetainedObjectBytes: 1,
      }),
    );
    const connected = Result.getOrThrow(
      makeTaskRuntimeReadinessConnectedVerificationAuthority({
        reserve: () => Effect.succeed(null),
      }, cold, fixture.preparationInput.expected.materializationPolicy),
    );

    const result = await Effect.runPromise(connected.verify({
      authority: authorityFromSnapshot(
        snapshotFromFixture(fixture.preparationInput),
      ),
      revisionId: "revision-missing",
    }));
    expect(result).toEqual({
      status: "not_ready",
      revisionId: "revision-missing",
      reason: "readiness_snapshot_missing",
    });
    expect(coldCalls).toBe(0);
  });

  it("rejects malformed runtime policy and malformed ports at construction", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture(true);
    const cold = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority({
        read: () => Effect.die("unused"),
      }, fixture.sha256, {
        maximumObjectCount: 1,
        maximumObjectBytes: 1,
        maximumRetainedObjectBytes: 1,
      }),
    );
    const malformedPolicy = makeTaskRuntimeReadinessConnectedVerificationAuthority(
      { reserve: () => Effect.succeed(null) },
      cold,
      { kind: "not-a-runtime-policy" },
    );
    expect(Result.isFailure(malformedPolicy)).toBe(true);
    if (Result.isFailure(malformedPolicy)) {
      expect(malformedPolicy.failure.reason)
        .toBe("invalidMaterializationPolicy");
    }
    const revocable = Proxy.revocable<Pick<
      ApplicationTaskRuntimeReadinessReservationPort,
      "reserve"
    >>({ reserve: () => Effect.succeed(null) }, {});
    revocable.revoke();
    const malformedPort = makeTaskRuntimeReadinessConnectedVerificationAuthority(
      revocable.proxy,
      cold,
      fixture.preparationInput.expected.materializationPolicy,
    );
    expect(Result.isFailure(malformedPort)).toBe(true);
    if (Result.isFailure(malformedPort)) {
      expect(malformedPort.failure.reason).toBe("invalidPort");
    }
  });
});

function snapshotFromFixture(
  input: Awaited<ReturnType<typeof makeTaskRuntimeReadinessFixture>>[
    "preparationInput"
  ],
): ApplicationTaskRuntimeReadinessSnapshot {
  const expected = input.expected;
  const scopeId = Brand.nominal<ApplicationTaskRuntimeReadinessSnapshot[
    "scopeId"
  ]>()(expected.scopeId);
  return Object.freeze({
    scopeId,
    revisionId: expected.applicationRevisionId,
    candidateId: expected.candidateId,
    receiptObjectCount: 0,
    readReceiptCanonicalBytes: () => copyBytes(input.receiptCanonicalBytes),
    readReceiptSha256: () => copyDigest(input.receiptSha256),
    readParentEvidence: () => Object.freeze({
      scopeId: expected.scopeId,
      candidateId: expected.candidateId,
      analysisId: expected.analysisId,
      applicationRevisionId: expected.applicationRevisionId,
      applicationPublicationSha256:
        copyDigest(expected.applicationPublicationSha256),
      sourceArtifactRootSha256:
        copyDigest(expected.sourceArtifactRootSha256),
      applicationTaskCatalogBindingSha256:
        copyDigest(expected.applicationTaskCatalogBindingSha256),
      taskCatalog: expected.taskCatalog,
    }),
  });
}

const brandDigest = Brand.nominal<TaskDefinitionSha256V1>();

function copyDigest(value: TaskDefinitionSha256V1): TaskDefinitionSha256V1 {
  return brandDigest(copyBytes(value));
}

function authorityFromSnapshot(
  snapshot: ApplicationTaskRuntimeReadinessSnapshot,
): Parameters<ApplicationTaskRuntimeReadinessReservationPort["reserve"]>[0][
  "authority"
] {
  return Object.freeze({
    scopeId: snapshot.scopeId,
    storageGeneration:
      FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    epoch: ScopeEpochSchema.make(
      "epoch_00000000-0000-4000-8000-000000000001",
    ),
  });
}

function policyFor(
  objects: ReadonlyArray<{
    readonly readReference: () => TaskRuntimeObjectReferenceV1;
  }>,
) {
  const lengths = objects.map(object => Number(object.readReference().byteLength));
  return Object.freeze({
    maximumObjectCount: Math.max(1, objects.length),
    maximumObjectBytes: Math.max(1, ...lengths),
    maximumRetainedObjectBytes: Math.max(
      1,
      lengths.reduce((total, value) => total + value, 0),
    ),
  });
}
