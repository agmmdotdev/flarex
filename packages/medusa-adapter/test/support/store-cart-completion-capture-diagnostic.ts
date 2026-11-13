import { Result } from "effect";
import { vi } from "vitest";
import { capturePrivateIntermediateJsonData, capturePrivateJsonDataOmittingUndefined, inspectCapturedPrivateJsonData,
  commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import * as workflowValues from "../../src/workflow/value";

/** Test failures retain non-enumerable Error causes as well as tagged fields.
 * JSON.stringify(Error) alone drops the relational column diagnostic. */
export function completionFailureDiagnostic(cause: unknown): string {
  const seen = new WeakSet<object>();
  const capture = (value: unknown): unknown => {
    if (typeof value === "bigint") return String(value);
    if (value === null || typeof value !== "object") return typeof value === "function" ? value.name : value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map(capture);
    return Object.fromEntries(Reflect.ownKeys(value).flatMap(key => {
      if (typeof key !== "string" || key === "stack") return [];
      const property = Object.getOwnPropertyDescriptor(value, key);
      return property !== undefined && "value" in property ? [[key, capture(property.value)]] : [];
    }));
  };
  return JSON.stringify(capture(cause));
}

/** Read-only failure diagnostics. Return the original verdict unchanged; the
 * real capture owners measure the semantic value and complete transport. */
export function installCompletionCaptureDiagnostics() {
  const native = workflowValues.captureWorkflowInput;
  return vi.spyOn(workflowValues, "captureWorkflowInput").mockImplementation((input, presence) => {
    const result = native(input, presence);
    if (Result.isSuccess(result) || result.failure.reason === "limitExceeded") {
      const bounds = { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 };
      const source = capturePrivateIntermediateJsonData({ value: input }, bounds, commerceError);
      if (Result.isSuccess(source) && inspectCapturedPrivateJsonData(source.success.value)?.depth === 16) {
        const envelope = { payload: source.success.value, undefinedPaths: source.success.undefinedPaths };
        const transport = capturePrivateJsonDataOmittingUndefined(envelope, { ...bounds, depth: 64 }, commerceError);
        const admitted = capturePrivateJsonDataOmittingUndefined(envelope, { ...bounds, depth: 17 }, commerceError);
        const facts = (value: unknown) => {
          const issued = inspectCapturedPrivateJsonData(value);
          return issued === undefined ? undefined : { depth: issued.depth, nodes: issued.nodes, bytes: issued.bytes };
        };
        console.info("Actual completion capture boundary", { result: result._tag, source: facts(source.success.value),
          transport: Result.isSuccess(transport) ? facts(transport.success.value) : { refusal: transport.failure.reason },
          undefinedPaths: source.success.undefinedPaths.length,
          maximumUndefinedPath: Math.max(0, ...source.success.undefinedPaths.map(path => path.length)),
          transport17: Result.isSuccess(admitted), limits: bounds });
      }
    }
    return result;
  });
}
