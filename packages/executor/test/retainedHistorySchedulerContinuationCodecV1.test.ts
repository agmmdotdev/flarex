import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  replacementScopeIdV1FromUuid,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import {
  RetainedHistorySchedulerContinuationCodecV1Error,
  decodeRetainedHistorySchedulerContinuationV1,
  encodeRetainedHistorySchedulerContinuationV1,
  type RetainedHistorySchedulerContinuationV1,
} from "../src/retainedHistorySchedulerContinuationCodecV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const MAX_BYTES = 65_536;
const SCOPE_ONE = replacementScopeIdV1FromUuid(
  "93000000-0000-0000-0000-000000000001",
);
const SCOPE_TWO = replacementScopeIdV1FromUuid(
  "93000000-0000-0000-0000-000000000002",
);
const SCOPE_THREE = replacementScopeIdV1FromUuid(
  "93000000-0000-0000-0000-000000000003",
);

describe("O11-F1 retained-history scheduler continuation codec", () => {
  it("stays private and round-trips owned directory and maintenance evidence", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "encodeRetainedHistorySchedulerContinuationV1"
      | "decodeRetainedHistorySchedulerContinuationV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();

    const source = continuation();
    const encoded = await runEffect(
      encodeRetainedHistorySchedulerContinuationV1(source),
    );
    const exposedBytes = encoded.canonicalBytes;
    const exposedDigest = encoded.sha256;
    exposedBytes.fill(0);
    exposedDigest.fill(0);

    const decoded = await runEffect(
      decodeRetainedHistorySchedulerContinuationV1(encoded),
    );
    expect(decoded).toEqual(source);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.directory)).toBe(true);
    expect(Object.isFrozen(decoded.activeScope)).toBe(true);
    expect(Object.isFrozen(decoded.activeScope?.maintenance)).toBe(true);
    expect(encoded.canonicalBytes).not.toEqual(exposedBytes);
    expect(encoded.sha256).not.toEqual(exposedDigest);
  });

  it("rejects directory splicing and cross-scope maintenance evidence", async () => {
    for (const invalid of [
      continuation({
        directoryAfter: continuingDirectory(SCOPE_THREE, SCOPE_ONE),
      }),
      continuation({
        directoryAfter: continuingDirectory(SCOPE_THREE, SCOPE_THREE),
      }),
      continuation({
        maintenanceScopeId: SCOPE_THREE,
      }),
      continuation({
        maintenanceDeploymentId: "deployment_other",
      }),
      { ...continuation(), excess: true },
    ]) {
      const failure = await runEffectFailure(
        encodeRetainedHistorySchedulerContinuationV1(invalid),
      );
      expect(failure).toBeInstanceOf(
        RetainedHistorySchedulerContinuationCodecV1Error,
      );
      expect(failure).toMatchObject({
        operation: "encode",
        reason: "invalidInput",
      });
    }
  });

  it("enforces the exact 64 KiB canonical continuation ceiling", async () => {
    const deploymentId = "deployment_one";
    const base = await runEffect(
      encodeRetainedHistorySchedulerContinuationV1(continuation({
        maintenance: null,
      })),
    );
    const exactDeploymentId = "x".repeat(
      MAX_BYTES - base.canonicalBytes.byteLength + deploymentId.length,
    );
    const exact = await runEffect(
      encodeRetainedHistorySchedulerContinuationV1(continuation({
        deploymentId: exactDeploymentId,
        maintenance: null,
      })),
    );
    expect(exact.canonicalBytes).toHaveLength(MAX_BYTES);

    const failure = await runEffectFailure(
      encodeRetainedHistorySchedulerContinuationV1(continuation({
        deploymentId: `${exactDeploymentId}x`,
        maintenance: null,
      })),
    );
    expect(failure).toMatchObject({
      operation: "encode",
      reason: "sizeExceeded",
      observedBytes: MAX_BYTES + 1,
      maximumBytes: MAX_BYTES,
    });
  });

  it("rejects noncanonical and digest-mismatched stored evidence", async () => {
    const encoded = await runEffect(
      encodeRetainedHistorySchedulerContinuationV1(continuation()),
    );
    const parsed = JSON.parse(new TextDecoder().decode(encoded.canonicalBytes));
    const noncanonical = new TextEncoder().encode(JSON.stringify(parsed, null, 2));

    for (const [input, reason] of [
      [{
        codecVersion: 1,
        canonicalBytes: noncanonical,
        sha256: await sha256(noncanonical),
      }, "nonCanonical"],
      [{
        codecVersion: 1,
        canonicalBytes: encoded.canonicalBytes,
        sha256: new Uint8Array(32),
      }, "invalidDigest"],
    ] as const) {
      const failure = await runEffectFailure(
        decodeRetainedHistorySchedulerContinuationV1(input),
      );
      expect(failure).toMatchObject({ operation: "decode", reason });
    }
  });
});

function continuation(options: {
  readonly deploymentId?: string;
  readonly maintenanceDeploymentId?: string;
  readonly maintenanceScopeId?: typeof SCOPE_ONE;
  readonly maintenance?: null;
  readonly directoryAfter?: ReturnType<typeof continuingDirectory>;
} = {}): RetainedHistorySchedulerContinuationV1 {
  const deploymentId = options.deploymentId ?? "deployment_one";
  return Object.freeze({
    version: "flarex.retained-history-scheduler-continuation.v1",
    directory: continuingDirectory(SCOPE_THREE, SCOPE_ONE),
    activeScope: Object.freeze({
      deploymentId,
      scopeId: SCOPE_TWO,
      maintenance: options.maintenance === null ? null : Object.freeze({
        version: "flarex.retained-history-maintenance-continuation.v1",
        deploymentId: options.maintenanceDeploymentId ?? deploymentId,
        scopeId: options.maintenanceScopeId ?? SCOPE_TWO,
        retainedFloor: "3",
        authority: Object.freeze({
          physicalLocator: Object.freeze({
            kind: "shared_database" as const,
            databaseKey: "retained-history-codec-test",
            schemaName: "public",
          }),
          storageGeneration:
            FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
          storageGenerationFence: "1",
          epoch: ScopeEpochSchema.make("epoch-retained-history-codec-test"),
        }),
        phase: Object.freeze({ kind: "commitHistory" as const }),
      }),
      directoryAfter: options.directoryAfter ??
        continuingDirectory(SCOPE_THREE, SCOPE_TWO),
    }),
  });
}

function continuingDirectory(
  highWaterScopeId: typeof SCOPE_ONE,
  lastScopeId: typeof SCOPE_ONE,
) {
  return Object.freeze({
    kind: "continuing" as const,
    continuation: Object.freeze({
      codecVersion: 1 as const,
      highWaterScopeId,
      lastScopeId,
    }),
  });
}

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(input)),
  );
}
