import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { describe, expect, it } from "vitest";

import {
  MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
  POINT_MUTATION_REQUEST_FORMAT_V1,
  PointMutationTargetSelectionV1Error,
  canonicalizePointMutationRequestV1,
  decodeActivePointMutationTargetMetadataV1,
  preparePointMutationStartEvidenceV1,
} from "../src/point-mutation-start";
import { TransactionGrantDeploymentIdV1Schema } from "../src/transaction-grant";
import {
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "../src/transaction-session";
import { ValidatorValueErrorV1 } from "../src/validator-engine";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_a2c",
);
const FUNCTION_PATH = TransactionFunctionPathV1Schema.make("orders:create");
const REQUEST_KEY = TransactionRequestKeyV1Schema.make("request_a2c");
const EPOCH = TransactionAuthorizationRevocationEpochSchema.make(7n);
const VALID_ID = "1:018f22e2-58cc-7b2a-91d8-f3f3401a0874";

describe("point-mutation preparation evidence", () => {
  it("freezes the exact request envelope and digest", async () => {
    const request = await canonicalizePointMutationRequestV1({
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
        new Uint8Array(32).fill(0xbb),
      ),
      requestKey: REQUEST_KEY,
    });

    expect(request.envelope).toEqual({
      format: POINT_MUTATION_REQUEST_FORMAT_V1,
      version: 1,
      deploymentId: DEPLOYMENT_ID,
      functionPath: FUNCTION_PATH,
      functionKind: "mutation",
      validatedArgsSha256: "b".repeat(64),
      requestKey: REQUEST_KEY,
    });
    expect(request.canonicalText).toBe(
      '{"format":"flarex-value","value":{' +
      '"deploymentId":"deployment_a2c",' +
      '"format":"flarex.point-mutation-request",' +
      '"functionKind":"mutation",' +
      '"functionPath":"orders:create",' +
      '"requestKey":"request_a2c",' +
      `"validatedArgsSha256":"${"b".repeat(64)}",` +
      '"version":1},"valueCodecVersion":1}',
    );
    expect(encodeBytesToLowercaseHex(request.sha256)).toBe(
      "7e9616f28039d505bd84bbe307684a4a263c70d668080d4db485221f08da1685",
    );
  });

  it("derives complete pins from checked metadata and canonical arguments", async () => {
    const mutableBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const first = await preparePointMutationStartEvidenceV1(
      targetMetadata(),
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: { userId: VALID_ID, payload: mutableBytes, omitted: undefined },
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    );
    const second = await preparePointMutationStartEvidenceV1(
      targetMetadata(),
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: { omitted: undefined, payload: new Uint8Array([1, 2, 3, 4]).buffer, userId: VALID_ID },
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    );

    new Uint8Array(mutableBytes).fill(9);
    expect(first.logicalPins).toMatchObject({
      deploymentId: DEPLOYMENT_ID,
      scopeId: "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
      packageId: "package_a2c",
      artifactRuntime: "dynamic-worker",
      artifactId: `artifact_${"a".repeat(32)}`,
      sourcePackageHash: "a".repeat(64),
      executionModule: "flarex/orders.ts",
      functionPath: FUNCTION_PATH,
      functionKind: "mutation",
      schemaVersionId: "schema_a2c",
      validatedArgsValueCodecVersion: 1,
      requestKey: REQUEST_KEY,
      authorizationRevocationEpoch: EPOCH,
    });
    expect(first.logicalPins.validatedArgsSha256).toBe(
      second.logicalPins.validatedArgsSha256,
    );
    expect(first.logicalPins.requestSha256).toBe(
      second.logicalPins.requestSha256,
    );
    expect(first.validatedArguments.canonicalBytes).toEqual(
      second.validatedArguments.canonicalBytes,
    );
    const exposed = first.validatedArguments.canonicalBytes;
    exposed.fill(0);
    expect(first.validatedArguments.canonicalBytes).toEqual(
      second.validatedArguments.canonicalBytes,
    );
    expect(first.returnsValidator).toEqual({ type: "string" });
  });

  it("fails closed for missing, duplicate, wrong-kind, and internal functions", async () => {
    const cases = [
      {
        reason: "functionMissing",
        metadata: targetMetadata({ functions: [] }),
      },
      {
        reason: "duplicateFunctionPath",
        metadata: targetMetadata({
          functions: [targetFunction(), targetFunction()],
        }),
      },
      {
        reason: "wrongFunctionKind",
        metadata: targetMetadata({
          functions: [targetFunction({ kind: "query" })],
        }),
      },
      {
        reason: "functionNotPublic",
        metadata: targetMetadata({
          functions: [targetFunction({ visibility: "internal" })],
        }),
      },
    ] as const;

    for (const testCase of cases) {
      await expect(preparePointMutationStartEvidenceV1(
        testCase.metadata,
        {
          deploymentId: DEPLOYMENT_ID,
          functionPath: FUNCTION_PATH,
          args: { userId: VALID_ID },
          requestKey: REQUEST_KEY,
        },
        EPOCH,
      )).rejects.toMatchObject({ issue: { reason: testCase.reason } });
    }
  });

  it("distinguishes invalid arguments from missing ID-table authority", async () => {
    await expect(preparePointMutationStartEvidenceV1(
      targetMetadata(),
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: { userId: "2:018f22e2-58cc-7b2a-91d8-f3f3401a0874" },
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    )).rejects.toMatchObject({
      _tag: "ValidatorValueErrorV1",
      issue: { reason: "idMismatch", path: "$args.userId" },
    });

    const metadataWithoutUsers = targetMetadata({
      schemaManifest: appManifest([]),
    });
    await expect(preparePointMutationStartEvidenceV1(
      metadataWithoutUsers,
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: { userId: VALID_ID },
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    )).rejects.toMatchObject({
      _tag: "ValidatorValueErrorV1",
      issue: { reason: "idAuthorityUnavailable", tableName: "users" },
    });
  });

  it("rejects scalar v.any arguments and corrupt artifact metadata", async () => {
    await expect(preparePointMutationStartEvidenceV1(
      targetMetadata({
        functions: [targetFunction({ argsValidator: { type: "any" } })],
      }),
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: "scalar",
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    )).rejects.toBeInstanceOf(PointMutationTargetSelectionV1Error);

    expect(() => targetMetadata({
      artifactId: `artifact_${"f".repeat(32)}`,
    })).toThrow();
    expect(ValidatorValueErrorV1).toBeDefined();
  });

  it("charges the implicit Convex argument array at the exact 16 MiB limit", async () => {
    const exactPayload = "x".repeat(
      MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 - 8,
    );
    const metadata = targetMetadata({
      functions: [targetFunction({
        argsValidator: {
          type: "object",
          value: {
            x: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
      })],
    });

    await expect(preparePointMutationStartEvidenceV1(
      metadata,
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: { x: exactPayload },
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    )).resolves.toBeDefined();

    await expect(preparePointMutationStartEvidenceV1(
      metadata,
      {
        deploymentId: DEPLOYMENT_ID,
        functionPath: FUNCTION_PATH,
        args: { x: `${exactPayload}x` },
        requestKey: REQUEST_KEY,
      },
      EPOCH,
    )).rejects.toMatchObject({
      _tag: "PointMutationTargetSelectionV1Error",
      issue: {
        reason: "argumentsTooLarge",
        observed:
          MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 + 1,
        maximum: MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
      },
    });
  });
});

function targetMetadata(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return decodeActivePointMutationTargetMetadataV1({
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId: DEPLOYMENT_ID,
    scopeId: "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
    packageId: "package_a2c",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    schemaVersionId: "schema_a2c",
    functions: [targetFunction()],
    schemaManifest: appManifest([appTable(1, "users")]),
    ...overrides,
  });
}

function targetFunction(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    path: FUNCTION_PATH,
    executionModule: "flarex/orders.ts",
    kind: "mutation",
    visibility: "public",
    argsValidator: {
      type: "object",
      value: {
        userId: {
          fieldType: { type: "id", tableName: "users" },
          optional: false,
        },
        payload: {
          fieldType: { type: "bytes" },
          optional: true,
        },
      },
    },
    returnsValidator: { type: "string" },
    ...overrides,
  };
}

function appManifest(tables: ReadonlyArray<Readonly<Record<string, unknown>>>) {
  return {
    kind: "appSchema",
    manifestVersion: 1,
    tableDefinitions: {
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables,
    },
    indexBindings: {
      kind: "indexBindings",
      sectionVersion: 1,
      indexes: [],
    },
  };
}

function appTable(tableId: number, logicalName: string) {
  return {
    tableId,
    namespace: "app",
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: { type: "object", value: {} },
    },
  };
}
