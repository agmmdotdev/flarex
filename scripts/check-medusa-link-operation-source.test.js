import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeLinkOperationSourcePairs, nativeLinkPreimageAuthoredTargets, verifyNativeLinkOperationSelection } from "./check-medusa-link-operation-source.mjs";

const preimages = nativeLinkPreimageAuthoredTargets.map(target => ({ target, classification: "authored" }));

test("native Link operation seams require their exact pinned source pairs", () => {
  verifyNativeLinkOperationSelection([...nativeLinkOperationSourcePairs, ...preimages]);
  for (const pair of nativeLinkOperationSourcePairs) {
    const other = nativeLinkOperationSourcePairs.filter(row => row !== pair);
    for (const changed of [undefined, { ...pair, classification: "unchanged" },
      { ...pair, source: pair.source + ".other" }, { ...pair, target: pair.target + ".other" }]) {
      assert.throws(() => verifyNativeLinkOperationSelection([...preimages, ...(changed === undefined ? other : [...other, changed])]),
        /Changed native Link operation source selection/);
    }
    assert.throws(() => verifyNativeLinkOperationSelection([...preimages, ...nativeLinkOperationSourcePairs, pair]),
      /Changed native Link operation source selection/);
  }
});

test("native Link preimages require the complete authored persistence and protocol owner", () => {
  const selected = [...nativeLinkOperationSourcePairs, ...preimages];
  for (const entry of preimages) {
    for (const changed of [undefined, { ...entry, source: "unrelated.ts" }, { ...entry, classification: "linkFork" }, entry]) {
      const entries = changed === entry ? [...selected, entry] : selected.filter(row => row !== entry).concat(changed === undefined ? [] : [changed]);
      assert.throws(() => verifyNativeLinkOperationSelection(entries), /Changed native Link preimage source selection/);
    }
  }
});
