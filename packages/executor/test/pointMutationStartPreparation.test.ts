import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  ExecutorPointMutationScopeAuthorityV1Error,
  ExecutorPointMutationTargetMetadataV1Error,
  InvalidExecutorPreparedPointMutationStartV1Error,
  createExecutorPointMutationStartPreparationV1,
  inspectExecutorPreparedPointMutationStartV1,
} from "../src/pointMutationStartPreparation";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2c_preparation",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);
const FUNCTION_PATH = TransactionFunctionPathV1Schema.make("orders:create");
const REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "request_a2c_preparation",
);
const OTHER_DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2c_mutated",
);
const OTHER_FUNCTION_PATH = TransactionFunctionPathV1Schema.make(
  "orders:mutated",
);
const OTHER_REQUEST_KEY = TransactionRequestKeyV1Schema.make(
  "request_a2c_mutated",
);
const EPOCH = TransactionAuthorizationRevocationEpochSchema.make(7n);

describe("executor point-mutation preparation", () => {
  it("performs independent reads and returns only process-local capabilities", async () => {
    let metadataReads = 0;
    let authorityReads = 0;
    const preparation = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => {
        metadataReads += 1;
        return targetMetadata();
      },
      loadCurrentScopeAuthority: async () => {
        authorityReads += 1;
        return currentAuthority();
      },
    });

    const first = await preparation.prepare(candidate());
    const second = await preparation.prepare(candidate());
    const firstInspection = inspectExecutorPreparedPointMutationStartV1(
      first,
    );
    const secondInspection = inspectExecutorPreparedPointMutationStartV1(
      second,
    );

    expect(first).not.toBe(second);
    expect(metadataReads).toBe(2);
    expect(authorityReads).toBe(2);
    expect(firstInspection.logicalPins).toEqual(
      secondInspection.logicalPins,
    );
    expect(JSON.stringify(first)).toBe("{}");
    for (const forged of [
      JSON.parse(JSON.stringify(first)),
      { ...first },
      Object.create(first),
      firstInspection,
      null,
    ]) {
      expect(() => inspectExecutorPreparedPointMutationStartV1(forged))
        .toThrow(InvalidExecutorPreparedPointMutationStartV1Error);
    }
  });

  it("snapshots every candidate field before awaiting trusted metadata", async () => {
    let releaseMetadata: (() => void) | undefined;
    const metadataGate = new Promise<void>((resolve) => {
      releaseMetadata = resolve;
    });
    const selectedTargets: Array<readonly [string, string]> = [];
    const preparation = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async (deploymentId, functionPath) => {
        selectedTargets.push([deploymentId, functionPath]);
        await metadataGate;
        return targetMetadata();
      },
      loadCurrentScopeAuthority: async () => currentAuthority(),
    });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const args = { orderId: "order_original", bytes };
    const candidateInput = {
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      args,
      requestKey: REQUEST_KEY,
    };
    const pending = preparation.prepare(candidateInput);

    candidateInput.deploymentId = OTHER_DEPLOYMENT_ID;
    candidateInput.functionPath = OTHER_FUNCTION_PATH;
    candidateInput.requestKey = OTHER_REQUEST_KEY;
    args.orderId = "order_mutated";
    new Uint8Array(bytes).fill(9);
    releaseMetadata?.();
    const prepared = await pending;
    const stablePreparation = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => targetMetadata(),
      loadCurrentScopeAuthority: async () => currentAuthority(),
    });
    const stable = await stablePreparation.prepare(candidate({
      orderId: "order_original",
      bytes: new Uint8Array([1, 2, 3]).buffer,
    }));

    expect(selectedTargets).toEqual([[DEPLOYMENT_ID, FUNCTION_PATH]]);
    expect(inspectExecutorPreparedPointMutationStartV1(prepared).logicalPins)
      .toEqual(inspectExecutorPreparedPointMutationStartV1(stable).logicalPins);
  });

  it("fails closed for absent/corrupt metadata and mismatched scope authority", async () => {
    const missing = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => null,
      loadCurrentScopeAuthority: async () => currentAuthority(),
    });
    await expect(missing.prepare(candidate())).rejects.toBeInstanceOf(
      ExecutorPointMutationTargetMetadataV1Error,
    );

    const corrupt = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => ({ format: "wrong" }),
      loadCurrentScopeAuthority: async () => currentAuthority(),
    });
    await expect(corrupt.prepare(candidate())).rejects.toMatchObject({
      issue: "corrupt",
    });

    const wrongScope = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => targetMetadata(),
      loadCurrentScopeAuthority: async () => ({
        ...currentAuthority(),
        scopeId: "scope_118f22e2-58cc-7b2a-91d8-f3f3401a0874",
      }),
    });
    await expect(wrongScope.prepare(candidate())).rejects.toBeInstanceOf(
      ExecutorPointMutationScopeAuthorityV1Error,
    );
  });

  it("inherits the exact 16 MiB implicit argument-array boundary", async () => {
    const preparation = createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => targetMetadata(),
      loadCurrentScopeAuthority: async () => currentAuthority(),
    });
    const exact = "x".repeat(
      MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 - 14,
    );
    await expect(preparation.prepare(candidate({ orderId: exact }))).resolves
      .toSatisfy((value) => {
        expect(() => inspectExecutorPreparedPointMutationStartV1(value))
          .not.toThrow();
        return true;
      });
    await expect(preparation.prepare(candidate({ orderId: `${exact}x` })))
      .rejects.toMatchObject({
        issue: {
          reason: "argumentsTooLarge",
          observed:
            MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 + 1,
        },
      });
  });
});

function candidate(
  args: unknown = {
    orderId: "order_a2c",
    bytes: new Uint8Array([1, 2, 3]).buffer,
  },
) {
  return {
    deploymentId: DEPLOYMENT_ID,
    functionPath: FUNCTION_PATH,
    args,
    requestKey: REQUEST_KEY,
  };
}

function currentAuthority() {
  return {
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    authorizationRevocationEpoch: EPOCH,
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
          bytes: {
            fieldType: { type: "bytes" },
            optional: true,
          },
        },
      },
      returnsValidator: { type: "string" },
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
import { MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 } from "flarex-protocol/point-mutation-start";
