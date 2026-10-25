import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeLinkOperationSourcePairs, verifyNativeLinkOperationSelection } from "./check-medusa-link-operation-source.mjs";

test("native Link operation seams require their exact pinned source pairs", () => {
  verifyNativeLinkOperationSelection(nativeLinkOperationSourcePairs);
  for (const pair of nativeLinkOperationSourcePairs) {
    const other = nativeLinkOperationSourcePairs.filter(row => row !== pair);
    for (const changed of [undefined, { ...pair, classification: "unchanged" },
      { ...pair, source: pair.source + ".other" }, { ...pair, target: pair.target + ".other" }]) {
      assert.throws(() => verifyNativeLinkOperationSelection(changed === undefined ? other : [...other, changed]),
        /Changed native Link operation source selection/);
    }
    assert.throws(() => verifyNativeLinkOperationSelection([...nativeLinkOperationSourcePairs, pair]),
      /Changed native Link operation source selection/);
  }
});
