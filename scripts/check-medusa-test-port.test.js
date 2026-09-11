// @ts-check
import { describe, expect, it } from "vitest";
import { verifyTestPort } from "./check-medusa-test-port.mjs";

const source = `import { runner } from "./runner";
describe("suite", () => {
  beforeEach(async () => { await runner.create({ title: "fixture" }); });
  it("case", async () => { const rows = await runner.list(); expect(rows[0].id).toEqual("id"); });
});`;

describe("maintained Medusa test ports", () => {
  it("permits only erased types and explicit Vitest globals around the same program", () => {
    const target = 'import { beforeEach, describe, expect, it } from "vitest";\n' + source
      .replace("const rows =", "const rows: { id: string }[] =").replace("rows[0].id", "rows[0]!.id");
    expect(() => verifyTestPort(source, target)).not.toThrow();
  });
  it.each([
    ["assertion", source.replace('toEqual("id")', 'toEqual("other")')],
    ["fixture", source.replace('title: "fixture"', 'title: "different"')],
    ["title", source.replace('it("case"', 'it("renamed"')],
    ["skip", source.replace('it("case"', 'it.skip("case"')],
    ["await", source.replace("await runner.create", "runner.create")],
    ["runtime import", source.replace('"./runner"', '"./fake-runner"')],
    ["missing assertion", source.replace('expect(rows[0].id).toEqual("id");', '')],
    ["extra case", source + 'it("extra", () => expect(true).toBe(true));'],
  ])("rejects a changed %s", (_label, target) => {
    expect(() => verifyTestPort(source, target)).toThrow("changed executable");
  });
  it("preserves the original unused fixture result without hiding evaluation", () => {
    const before = "async function setup() { const result = await create(); }";
    expect(() => verifyTestPort(before, before.replace("await create();", "await create(); void result;"))).not.toThrow();
    expect(() => verifyTestPort(before, before.replace("const result", "void result; const result"))).toThrow();
    expect(() => verifyTestPort(before, before.replace("await create();", "await create(); void destroy();"))).toThrow();
  });
  it.each([
    ["prefix sign", "expect(-1).toBe(-1);", "expect(+1).toBe(-1);"],
    ["prefix operator", "expect(!result).toBe(true);", "expect(~result).toBe(true);"],
    ["postfix increment", "for (let i = 0; i < 2; i++) create(i);", "for (let i = 0; i < 2; i--) create(i);"],
    ["template raw text", "expect(String.raw`\\n`).toBe(value);", "expect(String.raw`\n`).toBe(value);"],
    ["template span raw text", "expect(String.raw`x${value}\\n`).toBe(value);", "expect(String.raw`x${value}\n`).toBe(value);"],
  ])("rejects changed executable %s", (_label, before, after) => {
    expect(() => verifyTestPort(before, after)).toThrow("changed executable");
  });
  it("requires the exact explicitly selected Currency timeout", () => {
    expect(() => verifyTestPort("jest.setTimeout(100000);", "", { currencyTimeout: true })).not.toThrow();
    expect(() => verifyTestPort("jest.setTimeout(100000);", "")).toThrow();
    expect(() => verifyTestPort("jest.setTimeout(200000);", "", { currencyTimeout: true })).toThrow();
  });
  it("allows only the exact Currency static import relocations", () => {
    const before = 'import value from "../index"; expect(value).toBeDefined();';
    const after = before.replace('"../index"', '"@medusajs/currency/index"');
    expect(() => verifyTestPort(before, after, { currencyStaticImports: true })).not.toThrow();
    expect(() => verifyTestPort(before, after)).toThrow();
  });
  it("requires the exact explicitly selected Sales Channel timeout", () => {
    expect(() => verifyTestPort("jest.setTimeout(30000);", "", { salesChannelTimeout: true })).not.toThrow();
    expect(() => verifyTestPort("jest.setTimeout(30000);", "")).toThrow();
    expect(() => verifyTestPort("jest.setTimeout(100000);", "", { salesChannelTimeout: true })).toThrow();
  });
  it("refuses renamed Vitest bindings and syntax errors", () => {
    expect(() => verifyTestPort(source, 'import { expect as check } from "vitest";' + source)).toThrow("Unadmitted Vitest");
    expect(() => verifyTestPort(source, "const = ;")).toThrow("Invalid test-port syntax");
  });
});
