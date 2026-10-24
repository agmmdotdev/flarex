// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  requiredValidationCapsule, requiredValidationTarget,
  verifyNativeRequiredValidationExtraction, verifyNativeRequiredValidationSource,
} from "./check-medusa-required-validation-source.mjs";

const root = process.cwd();
/** @param {string} file */
const read = file => readFileSync(file, "utf8");
const original = read(requiredValidationCapsule + "errors.js");
const target = read(requiredValidationTarget);
describe("native required-property presentation provenance", () => {
  it("authenticates the exact native first line, source capsule, lock and MIT notice", () => {
    expect(() => verifyNativeRequiredValidationSource(root)).not.toThrow();
    expect(() => verifyNativeRequiredValidationExtraction(original, target + "\n// erased\n")).not.toThrow();
  });
  it.each([
    ["model identity", "${entityName}", "${propertyName}"],
    ["property identity", "${propertyName}", "${entityName}"],
    ["value interpolation", "${value}", "undefined"],
    ["native punctuation", "is required, '", "is required: '"],
  ])("refuses altered portable %s", (_name, before, after) => {
    expect(target).toContain(before);
    expect(() => verifyNativeRequiredValidationExtraction(original, target.replace(before, after))).toThrow();
  });
  it.each([
    ["model metadata owner", "const entityName = entity.__meta.className;", "const entityName = entity.constructor.name;"],
    ["required field", "${property.name}", "${property.other}"],
    ["pending field value", "${entity[property.name]}", "${entity[property.other]}"],
    ["entity receipt", ")}`, entity);", ")}`);"],
  ])("refuses altered native %s", (_name, before, after) => {
    expect(original).toContain(before);
    expect(() => verifyNativeRequiredValidationExtraction(original.replace(before, after), target)).toThrow();
  });
  it("refuses additional portable runtime", () => {
    expect(() => verifyNativeRequiredValidationExtraction(original, target + "\nthrow new Error('extra')\n")).toThrow();
  });
  it.each(["package.json", "LICENSE", "errors.js", "errors.d.ts", "EntityValidator.js", "SOURCE.json"])("refuses modified frozen %s", file => {
    const key = requiredValidationCapsule + file;
    expect(() => verifyNativeRequiredValidationSource(root, { [key]: read(key) + "\n" })).toThrow();
  });
  it.each([
    ["ValidationError instance name", "errors.js", "this.name = this.constructor.name;", "this.name = 'Other';"],
    ["pending entity access", "errors.js", "return this.entity;", "return undefined;"],
    ["nullish required guard", "EntityValidator.js", "entity[prop.name] == null", "entity[prop.name] === null"],
    ["default precedence", "EntityValidator.js", "!prop.defaultRaw", "true"],
  ])("retains source context for %s", (_name, file, before, after) => {
    const key = requiredValidationCapsule + file;
    expect(read(key)).toContain(before);
    expect(() => verifyNativeRequiredValidationSource(root, { [key]: read(key).replace(before, after) })).toThrow();
  });
  it("requires the exact pinned lock and retained package MIT notice", () => {
    for (const key of ["third_party/medusa/upstream/pnpm-lock.yaml", "packages/medusa-utils/LICENSE.mikro-orm"]) {
      expect(() => verifyNativeRequiredValidationSource(root, { [key]: read(key) + "\n" })).toThrow();
    }
  });
});
