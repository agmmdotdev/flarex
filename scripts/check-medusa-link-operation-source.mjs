// @ts-check
const native = "third_party/medusa/upstream/";

/** Approved native Link receipt/fencing seams; new protocol owners are authored. */
export const nativeLinkOperationSourcePairs = Object.freeze([
  ["packages/medusa-link-modules/src/services/link.ts", "packages/modules/link-modules/src/services/link.ts"],
  ["packages/medusa-utils/src/modules-sdk/decorators/emit-events.ts", "packages/core/utils/src/modules-sdk/decorators/emit-events.ts"],
  ["packages/medusa-utils/src/modules-sdk/event-builder-factory.ts", "packages/core/utils/src/modules-sdk/event-builder-factory.ts"],
  ["packages/medusa-types/src/link-modules/service.ts", "packages/core/types/src/link-modules/service.ts"],
  ["packages/medusa-types/src/modules-sdk/index.ts", "packages/core/types/src/modules-sdk/index.ts"],
].map(([target, source]) => Object.freeze({ target, source: native + source, classification: "linkFork" })));

/** @param {readonly {target: string,source?: string,classification: string}[]} files */
export function verifyNativeLinkOperationSelection(files) {
  for (const pair of nativeLinkOperationSourcePairs) {
    if (files.filter(file => file.target === pair.target && file.source === pair.source && file.classification === pair.classification).length !== 1)
      throw new Error("Changed native Link operation source selection");
  }
  for (const file of files) {
    if (nativeLinkOperationSourcePairs.some(pair => pair.target === file.target || pair.source === file.source) &&
      !nativeLinkOperationSourcePairs.some(pair => pair.target === file.target && pair.source === file.source && pair.classification === file.classification))
      throw new Error("Changed native Link operation source selection");
  }
}
