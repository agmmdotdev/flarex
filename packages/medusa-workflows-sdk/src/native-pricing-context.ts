import { z } from "@medusajs/deps/zod";
import { definitionError } from "./model";

// Exact native Cart pricingContextResult declaration. The schema and its bound
// parser stay private; callers receive only this immutable issued profile.
const schema = z.record(z.string(), z.any()).optional();
const parse = schema.parse;
export const nativePricingContextResult = Object.freeze({ profile: "nativePricingContextResult" as const });
export type NativePricingContext = Readonly<Record<string, unknown>> | undefined;

export function captureNativePricingContextProfile(value: unknown) {
  if (value !== nativePricingContextResult)
    throw definitionError("unsupportedProfile", "Only the issued native pricing-context validator is admitted");
  return nativePricingContextResult.profile;
}

/** The runtime invokes this genuine native parser through its existing owning
 * callback edge, after input capture and before ordinary output capture. */
export function parseNativePricingContext(value: unknown): NativePricingContext {
  return parse(value);
}
