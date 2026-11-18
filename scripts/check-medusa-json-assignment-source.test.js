// @ts-check
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jsonAssignmentCapsule, jsonAssignmentTarget, verifyNativeJsonAssignment, verifyNativeJsonAssignmentExtraction } from "./check-medusa-json-assignment-source.mjs";

const root = process.cwd();
/** @param {string} file */
const read = file => readFileSync(path.join(root, file), "utf8");
const target = read(jsonAssignmentTarget), original = read(jsonAssignmentCapsule + "Utils.js");
describe("pinned native DAL JSON assignment extraction", () => {
  it("authenticates literal methods, complete runtime envelope, frozen provenance and notices", () => {
    expect(() => verifyNativeJsonAssignment(root)).not.toThrow();
    expect(() => verifyNativeJsonAssignmentExtraction(original, target + "\n// erased comment\n")).not.toThrow();
  });
  it.each([
    ["recursive unsafe-key refusal", 'Object.prototype.hasOwnProperty.call(value, "__proto__")', "false"],
    ["prior domain refusal", "!supportsNativeJsonObjectAssignment(current)", "false"],
    ["patch domain refusal", "!supportsNativeJsonObjectAssignment(patch)", "false"],
    ["ordinary representation", "parseStringifyIfNecessary(input)", "input"],
    ["original constructor decision", "typeof value.constructor === 'function'", "true"],
    ["both plain objects", "Utils.isPlainObject(before) && Utils.isPlainObject(value)", "Utils.isPlainObject(value)"],
    ["whole current preimage", "Utils.merge({}, before, value)", "Utils.merge({}, value)"],
    ["nested native merge", "Utils._merge(target[key], [value], ignoreUndefined)", "Object.assign(target[key], value)"],
    ["array replacement", "!Array.isArray(o)", "true"],
    ["JSON copy binding", "return parseStringifyIfNecessary(entity);", "return entity;"],
  ])("rejects altered %s", (_name, before, after) => {
    expect(target).toContain(before);
    expect(() => verifyNativeJsonAssignmentExtraction(original, target.replace(before, after))).toThrow("Changed pinned native JSON assignment extraction");
  });
  it("rejects extra runtime or altered native instance/copy anchors", () => {
    expect(() => verifyNativeJsonAssignmentExtraction(original, target + "\nthrow new Error('extra');\n")).toThrow();
    for (const anchor of ["|| value instanceof enums_1.PlainObject;", "Object.hasOwn(value.constructor.prototype, 'isPrototypeOf')", "return (0, clone_1.clone)(entity, respectCustomCloneMethod);"]) {
      expect(original).toContain(anchor);
      expect(() => verifyNativeJsonAssignmentExtraction(original.replace(anchor, ""), target)).toThrow();
    }
  });
  it.each(["package.json", "LICENSE", "EntityAssigner.js", "Utils.js", "clone.js", "enums.js", "SOURCE.json"])("refuses altered frozen %s", file => {
    const filename = jsonAssignmentCapsule + file;
    const replacement = file === "SOURCE.json" ? read(filename).replace('"version": "6.4.16"', '"version": "6.4.17"') : read(filename) + "\n";
    expect(() => verifyNativeJsonAssignment(root, { [filename]: replacement })).toThrow();
  });
  it("requires retained package MIT notice and complete runtime helper", () => {
    for (const file of ["packages/medusa-utils/LICENSE.mikro-orm", jsonAssignmentTarget]) {
      expect(() => verifyNativeJsonAssignment(root, { [file]: read(file) + "\nthrow new Error('tampered');\n" })).toThrow();
    }
  });
});
