import { Effect, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { createQuery, RemoteQuery, type RemoteFetchServiceResult, type RemoteQueryFetchRequest } from "@medusajs/modules-sdk/remote-query";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "../module/promise-owner";
import { commerceDecoder } from "../value/decoder";
import { captureWorkflowInput } from "../workflow/value";
import type { GraphReadContext } from "./model";

export type NativeQueryMetadata = Omit<ConstructorParameters<typeof RemoteQuery>[0], "remoteFetchData">;
export type NativeQueryRead = (request: RemoteQueryFetchRequest, owner: CommercePromiseOwner) => Effect.Effect<RemoteFetchServiceResult, CommerceTransactionError>;
export interface NativeQueryBridgeOptions extends NativeQueryMetadata {
  readonly read: NativeQueryRead;
  readonly recordFailure?: GraphReadContext["recordFailure"];
}
export interface NativeQueryBridge {
  readonly query: (input: unknown, options?: unknown) => Effect.Effect<unknown, CommerceTransactionError>;
  readonly graph: (input: unknown, options?: unknown) => Effect.Effect<unknown, CommerceTransactionError>;
}

const NativePageNumber = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
/** Query.graph owns dynamic intermediate rows, including undefined native
 * selections. Profiles decode the actual DTOs they consume independently. */
export const NativeQueryGraphResultSchema = Schema.Struct({ data: Schema.Array(Schema.Unknown),
  metadata: Schema.optionalKey(Schema.Union([Schema.Undefined, Schema.Struct({ count: NativePageNumber,
    skip: Schema.optionalKey(Schema.Union([NativePageNumber, Schema.Undefined])),
    take: Schema.optionalKey(Schema.Union([NativePageNumber, Schema.Null, Schema.Undefined])) })])) });
export const decodeNativeQueryGraphResult = commerceDecoder(NativeQueryGraphResultSchema, "storedCorruption");
export type NativeQueryGraphResult = Result.Result.Success<ReturnType<typeof decodeNativeQueryGraphResult>>;

const forbiddenSegments = new Set(["__proto__", "constructor", "prototype"]);
const unsafePath = (path: string) => path.split(".").some(segment => forbiddenSegments.has(segment));
const transportSegments = new Set(["fields", "__fields", "__args", "isServiceAccess"]);
const unsafeSelection = (path: string) => unsafePath(path) || path.split(".").some(segment => transportSegments.has(segment));

/** Bound foreign descriptors before inspecting security-sensitive names.
 * This admits values, never interprets selections or expands a query. */
export function admitNativeQueryPaths(input: unknown) {
  return Result.gen(function* () {
    const captured = yield* captureWorkflowInput(input, "preserveOwnUndefined");
    const pending: unknown[] = [captured];
    while (pending.length > 0) {
      const value = pending.pop();
      if (Array.isArray(value)) { pending.push(...value); continue; }
      if (!isNonArrayRecord(value)) continue;
      for (const [key, member] of Object.entries(value)) {
        if (unsafePath(key) || key === "fields" && Array.isArray(member) &&
          member.some(field => typeof field === "string" && unsafeSelection(field)))
          return yield* Result.fail(commerceError("unsupportedProfile"));
        pending.push(member);
      }
    }
    return captured;
  });
}

/** Medusa owns query normalization, fetching and presentation. This boundary
 * owns only bounded values and the executable native Promise lifetime. */
export function makeNativeQueryBridge(configuration: NativeQueryBridgeOptions): NativeQueryBridge {
  const execute = (method: "query" | "graph", input: unknown, options?: unknown) => Effect.gen(function* () {
    const owner = yield* makeCommercePromiseOwner(configuration.recordFailure);
    return yield* owner.withClose(Effect.gen(function* () {
      const capturedInput = yield* Effect.fromResult(admitNativeQueryPaths(input));
      const capturedOptions = options === undefined ? undefined : yield* Effect.fromResult(admitNativeQueryPaths(options));
      const native = createQuery({ remoteQuery: new RemoteQuery({
        servicesConfig: configuration.servicesConfig,
        entitiesMap: configuration.entitiesMap,
        entityRelations: configuration.entityRelations,
        remoteFetchData: request => owner.run(Effect.suspend(() => configuration.read(request, owner))),
      }) });
      const callback = method === "query" ? native : native.graph;
      // Native normalization owns descriptor mutation (including key filters).
      // Give it mutable detached values after the one bounded capture.
      const result = yield* owner.invoke<unknown>(async () => Reflect.apply(callback, undefined,
        [structuredClone(capturedInput), structuredClone(capturedOptions)]));
      // The guarded native joiner hides internal alias paths as nonenumerable
      // data properties. Detach its trusted public result before the bounded
      // intermediate capture, retaining native undefined array positions.
      return yield* Effect.fromResult(captureWorkflowInput(structuredClone(result), "preserveOwnUndefined"));
    }));
  });
  return Object.freeze({
    query: Effect.fn("NativeQueryBridge.query")((input: unknown, options?: unknown) => execute("query", input, options)),
    graph: Effect.fn("NativeQueryBridge.graph")((input: unknown, options?: unknown) => execute("graph", input, options)),
  });
}
