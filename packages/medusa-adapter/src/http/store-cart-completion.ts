import type { Effect } from "effect";
import { MedusaError } from "@medusajs/utils/common/errors";
import { runProductRequestPromise } from "./product-request";

/** This selected workflow has no pause or remote provider. Awaiting its atomic
 * host drains the owner before a native finished result can be presented.
 * The existing Promise boundary admits only one native refusal with rollback
 * markers; mixed Causes, defects, interruption and uncertain settlement throw. */
export async function runCompletedCartRequestPromise<A extends { readonly result: unknown }, E>(work: Effect.Effect<A, E>) {
  try {
    const outcome = await runProductRequestPromise(work);
    return { ...outcome, errors: [], transaction: { hasFinished: () => true } };
  } catch (error) {
    if (!(error instanceof MedusaError)) throw error;
    return { result: undefined, errors: [{ error }], transaction: { hasFinished: () => true } };
  }
}
