import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queryKeySource, queryKeyTarget, verifyQueryKeySelection, verifyQueryKeySource } from "./check-medusa-query-key-source.mjs";

const source = readFileSync(queryKeySource, "utf8");
const target = readFileSync(queryKeyTarget, "utf8");
test("retains both complete pinned Query key validation programs", () => {
  verifyQueryKeySource(source, target);
});
test("rejects partial missing-key checks, error drift and constructor changes", () => {
  for (const changed of [
    target.replace("notFound.size > 0", "resData.length === 0"),
    target.replace("notFound.delete(data[pkField])", "notFound.clear()"),
    target.replace("primaryKeyArg?.value == undefined", "!primaryKeyArg?.value"),
    target.replace("not found in filters", "absent"),
    target.replace('from "@medusajs/utils/common/errors"', 'from "./errors"'),
    target + "\nexport const bypass = true\n",
  ]) assert.throws(() => verifyQueryKeySource(source, changed));
});
test("requires exactly one pinned extraction identity", () => {
  const selected = { source: queryKeySource, target: queryKeyTarget, classification: "selectedExportFacade" };
  verifyQueryKeySelection([selected]);
  for (const files of [[], [selected, selected], [{ ...selected, classification: "authored" }], [{ ...selected, source: "unselected.ts" }]])
    assert.throws(() => verifyQueryKeySelection(files));
});
