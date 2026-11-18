// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  databaseConstraintTarget, databaseErrorMapperTarget, databaseErrorSource,
  verifyNativeDatabaseConstraintExtraction, verifyNativeDatabaseConstraintSource,
} from "./check-medusa-db-error-source.mjs";

const source = readFileSync(databaseErrorSource, "utf8");
const mapper = readFileSync(databaseErrorMapperTarget, "utf8");
const helper = readFileSync(databaseConstraintTarget, "utf8");
describe("native database constraint presentation extraction provenance", () => {
  it("authenticates the original parser, FK template and every mapper branch", () => {
    expect(() => verifyNativeDatabaseConstraintSource(process.cwd())).not.toThrow();
    expect(() => verifyNativeDatabaseConstraintExtraction(source, mapper + "\n// erased\n", helper)).not.toThrow();
  });

  it.each([
    ["native true conversion", 'return "true"', 'return "t"'],
    ["native false conversion", 'return "false"', 'return "f"'],
    ["native unique table spelling", 'info.table.split("_").join(" ")', 'info.table'],
    ["native unique value pairing", "parseValue(info.values[i])", "parseValue(info.values[0])"],
    ["native unique pair separator", '.join(", ")', '.join(",")'],
    ["semantic text tuple ordering", 'values.join(", ")', '[...values].reverse().join(", ")'],
    ["semantic column ordering", "keys: columns", "keys: [...columns].reverse()"],
    ["semantic unique formatter", "return formatUniqueConstraintMessage({", "return formatForeignKeyConstraintMessage({"],
    ["comma splitting", '.split(",")', '.split(", ")'],
    ["value trimming", ".map((value) => value.trim())", ".map((value) => value)"],
    ["malformed detail", "return null", "return undefined"],
    ["undefined relationship", "info?.keys.map", "info.keys.map"],
    ["key/value pairing", "info.values[i]", "info.values[0]"],
    ["native tuple order", "const [keys, values]", "const [values, keys]"],
    ["native tuple boundaries", "tuple.substring(1, tuple.length - 1)", "tuple.substring(0, tuple.length - 1)"],
    ["native tuple regex", "value.match(/\\([^\\(]*\\)/g)", "value.match(/\\([^)]*\\)/g)"],
    ["genuine-detail tuple selection", "selectConstraintTuples(detail)", 'selectConstraintTuples("(" + detail + ")")'],
    ["scalar first tuple", "const [tuple]", "const [, tuple]"],
    ["scalar value tuple framing", 'selectConstraintTuples("(" + value + ")")', 'selectConstraintTuples(value)'],
    ["scalar key identity", "keys: [column]", 'keys: ["provider_id"]'],
    ["scalar shared tuple parsing", "parseConstraintTupleValues(tuple)", "[tuple]"],
    ["scalar absence presentation", "tuple === undefined ? []", 'tuple === undefined ? ["replacement"]'],
  ])("rejects altered %s", (_name, before, after) => {
    expect(helper).toContain(before);
    expect(() => verifyNativeDatabaseConstraintExtraction(source, mapper, helper.replace(before, after))).toThrow();
  });

  it.each([
    ["unique classification", 'code === "23505"', 'code === "23503"'],
    ["unique malformed-detail refusal", "if (!info)", "if (false)"],
    ["unique formatter call", "formatUniqueConstraintMessage(info)", '"changed unique message"'],
    ["not-null classification", 'code === "23502"', 'code === "23503"'],
    ["invalid-field message", "userFriendlyMessage ?? err.message", "err.message"],
    ["FK classification", 'code === "23503"', 'code === "23502"'],
    ["unknown error identity", "throw err", 'throw new Error("replacement")'],
    ["portable formatter call", "formatForeignKeyConstraintMessage(info)", '"changed message"'],
  ])("rejects altered mapper %s", (_name, before, after) => {
    expect(mapper).toContain(before);
    expect(() => verifyNativeDatabaseConstraintExtraction(source, mapper.replace(before, after), helper)).toThrow();
  });

  it("rejects added runtime and modified original source", () => {
    expect(() => verifyNativeDatabaseConstraintExtraction(source, mapper, helper + "\nthrow new Error('extra')\n")).toThrow();
    expect(() => verifyNativeDatabaseConstraintSource(process.cwd(), {
      [databaseErrorSource]: source + "\n",
    })).toThrow();
  });
});
