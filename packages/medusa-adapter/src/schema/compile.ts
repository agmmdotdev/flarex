import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { Effect } from "effect";
import { decodeCompiledDml } from "./compiled";

type DmlModels = Readonly<Parameters<typeof compileDmlSchema>[0]>;

/** Preserve the native compiler's JSON projection, including omitted undefined fields.
 * Selected-table profiles inspect this snapshot before applying the storage grammar. */
export const compileDmlSnapshot: <E>(models: DmlModels, error: (cause: unknown) => E) => Effect.Effect<unknown, E> = Effect.fn("Medusa.compileDmlSnapshot")(
  function* <E>(models: DmlModels, error: (cause: unknown) => E) {
    return yield* Effect.try({
      try: (): unknown => JSON.parse(JSON.stringify(compileDmlSchema([...models]))),
      catch: error,
    });
  },
);

/** Decode the complete compiler result; module admission remains with each owner. */
export const compileDmlMetadata: <E>(models: DmlModels, error: (cause: unknown) => E) =>
  Effect.Effect<Effect.Success<ReturnType<typeof decodeCompiledDml>>, E> = Effect.fn("Medusa.compileDmlMetadata")(
  function* <E>(models: DmlModels, error: (cause: unknown) => E) {
    const snapshot = yield* compileDmlSnapshot(models, error);
    return yield* decodeCompiledDml(snapshot).pipe(Effect.mapError(error));
  },
);
