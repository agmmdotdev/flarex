import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { commerceError, commerceLimits, capturePrivateCanonicalValue, capturePrivateJsonDataOmittingUndefined, useCapturedPrivateJsonData, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

/** Configuration uses the atomic owner's policy JSON contract (64 KiB and
 * depth 64), rather than the native business-value envelope. Keep the complete
 * canonical preimage so existing workflow replay identities remain unchanged. */
export const captureWorkflowPolicy = (input: unknown) => capturePrivateJsonDataOmittingUndefined(input,
  // Native optional metadata still omits own undefined members. Bound descriptor
  // work by the configuration byte ceiling, independently of business values.
  { bytes: commerceLimits.rowBytes, nodes: commerceLimits.rowBytes, depth: 64 }, commerceError).pipe(
    Result.flatMap(snapshot => useCapturedPrivateJsonData(snapshot.value, commerceLimits.rowBytes,
      commerceError, { canonicalNumbers: true, wellFormedUnicode: true })),
    Result.map(snapshot => snapshot.value),
  );

/** Capture trusted registration data without dispatching property getters.
 * Nested capabilities are captured by their owners, never cloned as JSON. */
export function captureWorkflowRecord<T extends object>(input: T) {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const reflected = yield* Result.try({
      try: () => ({ prototype: Object.getPrototypeOf(input), properties: Object.getOwnPropertyDescriptors(input) }),
      catch: cause => commerceError("unsupportedProfile", cause),
    });
    if (reflected.prototype !== Object.prototype && reflected.prototype !== null) return yield* Result.fail(commerceError("unsupportedProfile"));
    const keys = Reflect.ownKeys(reflected.properties);
    if (keys.length > commerceLimits.commandDefinitions) return yield* Result.fail(commerceError("limitExceeded"));
    const entries: [string, unknown][] = [];
    for (const key of keys) {
      if (typeof key !== "string") return yield* Result.fail(commerceError("unsupportedProfile"));
      const property = reflected.properties[key];
      if (property === undefined || !("value" in property) || !property.enumerable) return yield* Result.fail(commerceError("unsupportedProfile"));
      entries.push([key, property.value]);
    }
    // SAFETY: every own enumerable data property is copied exactly once. This
    // preserves T, but does not authenticate any nested capability or callback.
    return Object.freeze(Object.fromEntries(entries)) as Readonly<T>;
  });
}

export const isWorkflowResourceName = (name: unknown): name is string => typeof name === "string" && /^[a-z][a-zA-Z0-9_-]{0,63}$/.test(name)
  && !["initialize", "__proto__", "constructor", "prototype", "then", "toJSON"].includes(name);

export function captureWorkflowArray<Value>(input: readonly Value[]) {
  return Result.gen(function* () {
    if (!Array.isArray(input)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const reflected = yield* Result.try({ try: () => ({ prototype: Object.getPrototypeOf(input), properties: Object.getOwnPropertyDescriptors(input), length: Object.getOwnPropertyDescriptor(input, "length") }),
      catch: cause => commerceError("unsupportedProfile", cause) });
    const length: unknown = reflected.length?.value;
    if (reflected.prototype !== Array.prototype || typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > commerceLimits.commandDefinitions) return yield* Result.fail(commerceError("unsupportedProfile"));
    if (Reflect.ownKeys(reflected.properties).length !== length + 1) return yield* Result.fail(commerceError("unsupportedProfile"));
    const values: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const property = reflected.properties[String(index)];
      if (property === undefined || !("value" in property) || !property.enumerable) return yield* Result.fail(commerceError("unsupportedProfile"));
      values.push(property.value);
    }
    // SAFETY: dense own data members retain their original typed values.
    return Object.freeze(values) as readonly Value[];
  });
}

/** An explicit encoding of the complete resource proof. Both its captured
 * canonical frame and the final workflow policy retain the 64 KiB ceiling. */
export const captureWorkflowResourceDigest = Effect.fn("Workflow.captureResourceDigest")(function* (input: unknown) {
  const resources = yield* Effect.fromResult(captureWorkflowPolicy(input));
  const captured = yield* capturePrivateCanonicalValue({ format: "flarex.medusa-workflow-resources", version: 1, resources },
    commerceLimits.rowBytes, { invalidInput: () => commerceError("limitExceeded"), hashFailure: cause => commerceError("resourceFailure", cause) });
  return captured.sha256Hex;
});

/** Own every complete frame before hashing can suspend. Each category retains
 * the resource owner's existing registration count and policy capture bounds. */
function captureWorkflowResourceFrames(input: unknown) {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const record = yield* captureWorkflowRecord(input);
    if (Object.keys(record).some(key => key !== "resources" && key !== "composedResources") || !Array.isArray(record.resources) ||
      record.composedResources !== undefined && !Array.isArray(record.composedResources)) return yield* Result.fail(commerceError("unsupportedProfile"));
    const resources = yield* captureWorkflowArray(record.resources), composed = record.composedResources === undefined
      ? undefined : yield* captureWorkflowArray(record.composedResources);
    const capture = (kind: "participant" | "composedResource", frames: readonly unknown[]) => Result.gen(function* () {
      const owned: JsonObject[] = [];
      for (const frame of frames) {
        if (frame === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
        const captured = yield* captureWorkflowPolicy({ format: "flarex.medusa-workflow-resource-frame", version: 1, kind, frame });
        if (!isJsonObject(captured)) return yield* Result.fail(commerceError("invalidAuthority"));
        owned.push(captured);
      }
      return Object.freeze(owned);
    });
    return Object.freeze({ resources: yield* capture("participant", resources),
      ...(composed === undefined ? {} : { composedResources: yield* capture("composedResource", composed) }) });
  });
}

/** Opt-in complete resource framing. Only owned snapshots cross an await;
 * ordered domain-separated references and the final policy remain bounded. */
export const captureWorkflowFramedResourceDigest = Effect.fn("Workflow.captureFramedResourceDigest")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureWorkflowResourceFrames(input));
  const hash = Effect.fn("Workflow.captureResourceFrame")(function* (frames: readonly JsonObject[]) {
    const references: Json[] = [];
    for (const frame of frames) {
      const result = yield* capturePrivateCanonicalValue(frame, commerceLimits.rowBytes,
        { invalidInput: () => commerceError("limitExceeded"), hashFailure: cause => commerceError("resourceFailure", cause) });
      references.push({ format: "flarex.medusa-workflow-resource-frame-reference", version: 1, sha256: result.sha256Hex });
    }
    return references;
  });
  const resources = yield* hash(captured.resources), composedResources = captured.composedResources === undefined
    ? undefined : yield* hash(captured.composedResources);
  const envelope = yield* Effect.fromResult(captureWorkflowPolicy({ format: "flarex.medusa-workflow-framed-resources", version: 1,
    resources, ...(composedResources === undefined ? {} : { composedResources }) }));
  if (!isJsonObject(envelope)) return yield* Effect.fail(commerceError("invalidAuthority"));
  const digest = yield* capturePrivateCanonicalValue(envelope, commerceLimits.rowBytes,
    { invalidInput: () => commerceError("limitExceeded"), hashFailure: cause => commerceError("resourceFailure", cause) });
  return digest.sha256Hex;
});
