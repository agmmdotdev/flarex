import { definitionError } from "./model";

/** Only trusted construction can select this bounded native Cart closure.
 * A serialized record with the same label is not the issued profile. */
export const nativeCartCreationProfile = Object.freeze({ profile: "nativeCartCreation" as const });
const selection = Object.freeze({ profile: "nativeCartCreation" as const, maximumNodes: 73 as const });

export function captureNativeCartCreationProfile(value: unknown) {
  if (value !== nativeCartCreationProfile)
    throw definitionError("unsupportedProfile", "Only the issued native Cart construction profile is admitted");
  return selection;
}
