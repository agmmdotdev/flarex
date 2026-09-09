import { Effect } from "effect";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import { commerceError } from "./model";

/** Invalid wrapper shape is corruption; accessing the foreign driver wrapper
 * can itself fail and must retain that separate statement-failure identity. */
export const decodeCommerceDriverRows = Effect.fn("CommerceStore.decodeDriverRows")((result: unknown) => Effect.suspend(() => {
  const invalidShape = commerceError("storedCorruption");
  return Effect.try({
    try: () => rowsFromDriverExecuteResult(result, () => { throw invalidShape; }),
    catch: cause => cause === invalidShape ? invalidShape : commerceError("statementFailure", cause),
  });
}));
