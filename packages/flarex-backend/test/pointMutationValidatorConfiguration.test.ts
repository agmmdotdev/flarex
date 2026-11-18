import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";
import { decodeValidatorJsonWireV1, type ObjectValidatorJsonV1, type ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { TransactionArtifactIdV1Schema, TransactionExecutionModuleV1Schema, TransactionFunctionPathV1Schema, TransactionSourcePackageSha256HexV1Schema } from "flarex-protocol/transaction-session";
import { pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1 } from "../src/artifactRuntime/PointMutationInternalCallExactRuntimeWorkerSource";
import { pointMutationInternalQueryExactRuntimeWorkerConfigurationSourceV1 } from "../src/artifactRuntime/PointMutationInternalQueryExactRuntimeWorkerSource";

describe("point mutation validator configuration source", () => {
  it.each([1n, -0])("preserves scalar %s, own prototype names and current record variants in both sources", value => {
    const argsValidator: ObjectValidatorJsonV1 = { type: "object", value: Object.fromEntries([
      ["__proto__", { fieldType: { type: "literal", value }, optional: false }],
      ["timestamp", { fieldType: { type: "commitTs" }, optional: false }],
      ["callbacks", { fieldType: { type: "record", keys: { type: "string" }, values: { type: "function", fnType: "mutation", returns: { type: "commitTs" } } }, optional: false }],
    ]) };
    const returnsValidator: ValidatorJsonV1 = { type: "literal", value };
    const root = { path: TransactionFunctionPathV1Schema.make("orders:complete"), executionModule: TransactionExecutionModuleV1Schema.make("_flarex/execution.js"),
      kind: "mutation" as const, visibility: "public" as const, argsValidator, returnsValidator };
    const entry = { functionOrdinal: 1n, functionPath: "orders:internal", artifactExecutionModule: "orders.js", exportName: "internal",
      handlerKind: "query" as const, argsValidator, returnsValidator };
    const options = { moduleTime: 100, runtimeTargetSha256Hex: "a".repeat(64), rootFunctionOrdinal: 0n, function: root,
      artifact: { runtime: "dynamic-worker" as const, artifactId: TransactionArtifactIdV1Schema.make(`artifact_${"a".repeat(32)}`),
        sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make("a".repeat(64)), executionModule: root.executionModule } };
    for (const source of [
      pointMutationInternalCallExactRuntimeWorkerConfigurationSourceV1({ ...options, internalFunctionCatalog: [entry] }),
      pointMutationInternalQueryExactRuntimeWorkerConfigurationSourceV1({ ...options, internalQueryCatalog: [entry] }),
    ]) {
      // Evaluate the emitted object expression, preserving JavaScript's actual property semantics.
      const configuration: unknown = new Function(source.replace("export const exactRuntimeConfigurationV1 =", "return"))();
      if (!isNonArrayRecord(configuration) || !isNonArrayRecord(configuration.function)) throw new Error("Expected generated function configuration");
      const fn = configuration.function;
      const decoded = decodeValidatorJsonWireV1(fn.argsValidator);
      if (decoded.type !== "object") throw new Error("Expected generated object validator");
      expect(Object.hasOwn(decoded.value, "__proto__")).toBe(true);
      expect(decoded).toEqual(argsValidator);
      const field = decoded.value.__proto__;
      if (field?.fieldType.type !== "literal") throw new Error("Expected literal field");
      expect(Object.is(field.fieldType.value, value)).toBe(true);
      const returned = decodeValidatorJsonWireV1(fn.returnsValidator);
      if (returned.type !== "literal") throw new Error("Expected literal return");
      expect(Object.is(returned.value, value)).toBe(true);
      const catalog = configuration.internalFunctionCatalog ?? configuration.internalQueryCatalog;
      if (!Array.isArray(catalog) || !isNonArrayRecord(catalog[0])) throw new Error("Expected generated internal catalog");
      expect(decodeValidatorJsonWireV1(catalog[0].argsValidator)).toEqual(argsValidator);
    }
  });
});
