import { Effect } from "effect";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  InvalidIssuerPreparedPointMutationStartV1Error,
  InvalidServerPreparedTransactionRequestKeyV1Error,
  PointMutationTargetMetadataV1Error,
  createServerPreparedTransactionRequestKeyV1,
  inspectIssuerPreparedPointMutationStartV1,
  inspectServerPreparedTransactionRequestKeyV1,
  makeIssuerPointMutationGrantPreparationV1,
} from "../src/pointMutationGrantPreparation";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2c_issuer",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);
const FUNCTION_PATH = TransactionFunctionPathV1Schema.make("orders:create");
const REQUEST_KEY = TransactionRequestKeyV1Schema.make("request_a2c_issuer");
const OTHER_DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2c_issuer_mutated",
);
const OTHER_FUNCTION_PATH = TransactionFunctionPathV1Schema.make(
  "orders:mutated",
);
const OTHER_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "request_a2c_issuer_mutated",
);

describe("issuer point-mutation grant preparation", () => {
  it("uses independent trusted reads and exposes no structural authority", async () => {
    let metadataReads = 0;
    let authorityReads = 0;
    const preparation = makeIssuerPointMutationGrantPreparationV1({
      loadActiveTargetMetadata: () => {
        metadataReads += 1;
        return Effect.succeed(targetMetadata());
      },
      loadCurrentScopeAuthority: () => {
        authorityReads += 1;
        return Effect.succeed(currentAuthority());
      },
    });
    const requestKey = createServerPreparedTransactionRequestKeyV1(
      REQUEST_KEY,
    );

    const first = await runTestEffect(preparation.prepare({
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args: { orderId: "order_a2c" },
      requestKey,
    }));
    const second = await runTestEffect(preparation.prepare({
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args: { orderId: "order_a2c" },
      requestKey,
    }));

    expect(first).not.toBe(second);
    expect(metadataReads).toBe(2);
    expect(authorityReads).toBe(2);
    expect(JSON.stringify(first)).toBe("{}");
    expect(inspectIssuerPreparedPointMutationStartV1(first).logicalPins)
      .toEqual(inspectIssuerPreparedPointMutationStartV1(second).logicalPins);
    for (const forged of [
      JSON.parse(JSON.stringify(first)),
      { ...first },
      Object.create(first),
    ]) {
      expect(() => inspectIssuerPreparedPointMutationStartV1(forged))
        .toThrow(InvalidIssuerPreparedPointMutationStartV1Error);
    }
  });

  it("snapshots every candidate field before yielding to trusted metadata", async () => {
    let releaseMetadata: (() => void) | undefined;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    let notifyMetadataStarted: (() => void) | undefined;
    const metadataStarted = new Promise<void>((resolve) => {
      notifyMetadataStarted = resolve;
    });
    const selectedTargets: Array<readonly [string, string]> = [];
    const preparation = makeIssuerPointMutationGrantPreparationV1({
      loadActiveTargetMetadata: (deploymentId, functionPath) =>
        Effect.promise(async () => {
          selectedTargets.push([deploymentId, functionPath]);
          notifyMetadataStarted?.();
          await metadataGate;
          return targetMetadata();
        }),
      loadCurrentScopeAuthority: () => Effect.succeed(currentAuthority()),
    });
    const initialRequestKey = createServerPreparedTransactionRequestKeyV1(
      REQUEST_KEY,
    );
    const mutatedRequestKey = createServerPreparedTransactionRequestKeyV1(
      OTHER_REQUEST_KEY,
    );
    const args = { orderId: "order_original" };
    const candidate = {
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args,
      requestKey: initialRequestKey,
    };
    const pending = runTestEffect(preparation.prepare(candidate));

    await metadataStarted;
    candidate.deploymentId = OTHER_DEPLOYMENT_ID;
    candidate.functionPath = OTHER_FUNCTION_PATH;
    candidate.requestKey = mutatedRequestKey;
    args.orderId = "order_mutated";
    releaseMetadata?.();
    const prepared = await pending;
    const stablePreparation = makeIssuerPointMutationGrantPreparationV1({
      loadActiveTargetMetadata: () => Effect.succeed(targetMetadata()),
      loadCurrentScopeAuthority: () => Effect.succeed(currentAuthority()),
    });
    const stable = await runTestEffect(stablePreparation.prepare({
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args: { orderId: "order_original" },
      requestKey: createServerPreparedTransactionRequestKeyV1(REQUEST_KEY),
    }));

    expect(selectedTargets).toEqual([[DEPLOYMENT_ID, FUNCTION_PATH]]);
    expect(inspectIssuerPreparedPointMutationStartV1(prepared).logicalPins)
      .toEqual(inspectIssuerPreparedPointMutationStartV1(stable).logicalPins);
  });

  it("requires a server-prepared request-key capability", () => {
    const requestKey = createServerPreparedTransactionRequestKeyV1(
      REQUEST_KEY,
    );
    expect(inspectServerPreparedTransactionRequestKeyV1(requestKey)).toBe(
      REQUEST_KEY,
    );
    for (const forged of [
      REQUEST_KEY,
      JSON.parse(JSON.stringify(requestKey)),
      { ...requestKey },
      Object.create(requestKey),
    ]) {
      expect(() => inspectServerPreparedTransactionRequestKeyV1(forged))
        .toThrow(InvalidServerPreparedTransactionRequestKeyV1Error);
    }
  });

  it("fails closed before issuance when active metadata is absent or corrupt", async () => {
    const requestKey = createServerPreparedTransactionRequestKeyV1(
      REQUEST_KEY,
    );
    const input = {
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args: { orderId: "order_a2c" },
      requestKey,
    };
    const missing = makeIssuerPointMutationGrantPreparationV1({
      loadActiveTargetMetadata: () => Effect.succeed(null),
      loadCurrentScopeAuthority: () => Effect.succeed(currentAuthority()),
    });
    await expect(runTestEffect(missing.prepare(input))).rejects
      .toBeInstanceOf(PointMutationTargetMetadataV1Error);

    const corrupt = makeIssuerPointMutationGrantPreparationV1({
      loadActiveTargetMetadata: () => Effect.succeed({ format: "wrong" }),
      loadCurrentScopeAuthority: () => Effect.succeed(currentAuthority()),
    });
    await expect(runTestEffect(corrupt.prepare(input))).rejects
      .toMatchObject({ issue: "corrupt" });
  });
});

function runTestEffect<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(effect);
}

function currentAuthority() {
  return {
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(7n),
  };
}

function targetMetadata() {
  return {
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    packageId: "package_a2c",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    schemaVersionId: "schema_a2c",
    functions: [{
      path: FUNCTION_PATH,
      executionModule: "flarex/orders.ts",
      kind: "mutation",
      visibility: "public",
      argsValidator: {
        type: "object",
        value: {
          orderId: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
      returnsValidator: null,
    }],
    schemaManifest: {
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [],
      },
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: [],
      },
    },
  };
}
