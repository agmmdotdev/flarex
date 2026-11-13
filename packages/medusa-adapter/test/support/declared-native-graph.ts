import { Effect, Result, Schema } from "effect";
import { withNativeGraphMetadata } from "../../src/local-graph/native-metadata";
import type { GraphReadContext, PreparedLocalGraph } from "../../src/local-graph/model";
import { decodeNativeQueryGraphResult, NativeQueryGraphResultSchema } from "../../src/local-graph/native-bridge";
import { commerceDecoder } from "../../src/value/decoder";

const decodeRemotePage = commerceDecoder(Schema.Struct({ rows: Schema.Array(Schema.Unknown),
  metadata: NativeQueryGraphResultSchema.fields.metadata }), "storedCorruption");

/** Test declarations must provide their native services and relationship
 * metadata explicitly. This helper infers no query, alias or join behavior. */
export function declaredNativeGraph(...input: Parameters<typeof withNativeGraphMetadata>) {
  return Result.getOrThrow(withNativeGraphMetadata(...input));
}

/** Decode only the native result envelope; rows retain their native dynamic
 * intermediate values and presentation. */
export function nativeGraphFixture(graph: PreparedLocalGraph) {
  return { ...graph, bind: (context: GraphReadContext) => {
    const bound = graph.bind(context);
    return { ...bound, nativeGraph: (input: unknown, options?: unknown) => bound.nativeGraph(input, options)
      .pipe(Effect.flatMap(value => Effect.fromResult(decodeNativeQueryGraphResult(value)))),
      remotePage: (input: unknown, options?: unknown) => bound.remoteQuery(input, options)
        .pipe(Effect.flatMap(value => Effect.fromResult(decodeRemotePage(value)))) };
  } };
}
