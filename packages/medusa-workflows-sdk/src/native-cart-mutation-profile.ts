import { definitionError } from "./model";

/** Selected native update/add/item-update/delete closure, including every
 * conditional child and its trusted one-node atomic wrapper. */
export const nativeCartMutationProfile = Object.freeze({ profile: "nativeCartMutation" as const });
const selection = Object.freeze({ profile: "nativeCartMutation" as const, maximumNodes: 243 as const });

export function captureNativeCartMutationProfile(value: unknown) {
  if (value !== nativeCartMutationProfile)
    throw definitionError("unsupportedProfile", "Only the issued native Cart mutation construction profile is admitted");
  return selection;
}
