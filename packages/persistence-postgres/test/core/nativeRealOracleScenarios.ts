import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { normalizeRelationalRealValue } from "../../src/values/relationalReal";
import type { CorePersistenceFixture } from "./fixture";

const decodeOracle = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ ordinal: Schema.String,
  setting: Schema.String, valid: Schema.Boolean, converted: Schema.NullOr(Schema.String), bits: Schema.NullOr(Schema.String) })));
type Oracle = ReturnType<typeof decodeOracle>;

function binary32Samples(): readonly Readonly<{ bits: number; midpoint: boolean }>[] {
  const samples = new Map<number, boolean>();
  for (let exponent = 0; exponent < 255; exponent++) for (const mantissa of [0, 1, 0x7ffffe, 0x7fffff])
    samples.set(exponent * 0x800000 + mantissa, exponent % 17 === 0);
  let state = 0x129e4c7b;
  for (let index = 0; index < 512; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    samples.set((state & 0x7fffffff) % 0x7f800000, true);
  }
  return Object.freeze([...samples].map(([bits, midpoint]) => Object.freeze({ bits, midpoint })));
}

/** Original decimals plus independently selected binary32 intervals and their
 * binary64 midpoint neighbors. Production conversion never selects the corpus. */
export function nativeRealOracleInputs(): readonly number[] {
  const inputs = new Map<string, number>();
  const add = (value: number) => { if (Number.isFinite(value)) inputs.set(String(value), value); };
  for (const value of [0, -0, 16777217, 1.0000000596046448, 1e-45, 1e-46, 3.5e38,
    Number.MIN_VALUE, Number.MAX_VALUE, 3.4028235e38, 3.4028235677973366e38,
    1.17549435e-38, 1.1754942106924411e-38, 0.1, 1, 2, 100]) { add(value); add(-value); }
  const float32 = new DataView(new ArrayBuffer(4)), float64 = new DataView(new ArrayBuffer(8));
  const valueAt = (bits: number) => { float32.setUint32(0, bits, false); return float32.getFloat32(0, false); };
  const adjacent = (value: number, direction: -1 | 1) => {
    float64.setFloat64(0, value, false);
    float64.setBigUint64(0, float64.getBigUint64(0, false) + BigInt(direction), false);
    return float64.getFloat64(0, false);
  };
  for (const { bits, midpoint } of binary32Samples()) {
    const value = valueAt(bits);
    add(value); add(-value);
    if (!midpoint || bits >= 0x7f7fffff) continue;
    const middle = (value + valueAt(bits + 1)) / 2;
    for (const point of [adjacent(middle, -1), middle, adjacent(middle, 1)]) { add(point); add(-point); }
  }
  return Object.freeze([...inputs.values()]);
}

async function oracle(fixture: CorePersistenceFixture, inputs: readonly number[]): Promise<Oracle> {
  const statement = `with casted as (select cells.ordinal, current_setting('extra_float_digits') as setting,
    pg_input_is_valid(value, 'real') as valid,
    case when pg_input_is_valid(value, 'real') then value::real else null end as converted
    from jsonb_array_elements_text($1::jsonb) with ordinality as cells(value, ordinal))
    select casted.ordinal::text as ordinal, setting, valid, converted::text as converted,
      encode(float4send(converted), 'hex') as bits from casted order by casted.ordinal`;
  const payload = JSON.stringify(inputs.map(value => String(value)));
  const raw: unknown = fixture.runtimePool === undefined ? await fixture.query(statement, [payload])
    : (await fixture.runtimePool.query(statement, [payload])).rows;
  const rows = decodeOracle(raw);
  expect(rows).toHaveLength(inputs.length);
  for (const [index, row] of rows.entries()) { expect(row.ordinal).toBe(String(index + 1)); expect(row.setting).toBe("1"); }
  return rows;
}

function binary32Bits(value: number): string {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}

// Q12 deliberately chooses portable nearest-even input conversion. The old
// PG18.3/MSVC strtof differs on this exact signed pair; this source comparison
// characterizes that approved platform difference and rejects every unknown one.
const approvedNativeInputDifferences = Object.freeze([
  { submitted: -91001.53515625, native: -91001.54, nativeBits: "c7b1bcc5", portable: -91001.53, portableBits: "c7b1bcc4" },
  { submitted: 91001.53515625, native: 91001.54, nativeBits: "47b1bcc5", portable: 91001.53, portableBits: "47b1bcc4" },
]);

export function registerNativeRealOracleScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>,
  options: Readonly<{ inputComparison?: "characterize" }> = {}) {
  describe(`portable native REAL source comparison on ${label}`, () => {
    it("matches strict-shortest formatting from independent exact binary32 values", async () => {
      const fixture = await createFixture();
      try {
        const view = new DataView(new ArrayBuffer(4));
        const samples = binary32Samples().flatMap(({ bits }) => {
          view.setUint32(0, bits, false);
          const value = view.getFloat32(0, false);
          return value === 0 ? [{ value: 0, bits: "00000000" }] : [
            { value, bits: bits.toString(16).padStart(8, "0") },
            { value: -value, bits: (bits + 0x80000000).toString(16).padStart(8, "0") },
          ];
        });
        const rows = await oracle(fixture, samples.map(sample => sample.value));
        const mismatches: string[] = [];
        for (const [index, sample] of samples.entries()) {
          const row = rows[index];
          if (row === undefined || !row.valid || row.converted === null) throw new Error("REAL formatting oracle lost an exact binary32");
          if (row.bits !== sample.bits) mismatches.push(`exact binary32 ${sample.bits} parsed as ${String(row.bits)}`);
          const actual = Result.getOrThrow(normalizeRelationalRealValue(sample.value));
          if (!Object.is(actual, Number(row.converted))) mismatches.push(`bits ${sample.bits}: native ${row.converted}, portable ${String(actual)}`);
          if (!Object.is(Result.getOrThrow(normalizeRelationalRealValue(actual)), actual)) mismatches.push(`canonical changed ${String(actual)}`);
        }
        expect(samples.length).toBeGreaterThan(2500);
        expect(mismatches.length, JSON.stringify({ total: mismatches.length, first: mismatches.slice(0, 20) })).toBe(0);
      } finally { await fixture.close(); }
    }, 60_000);

    it(options.inputComparison === "characterize"
      ? "characterizes the complete direct-decimal corpus and only the approved native platform difference"
      : "matches portable direct-decimal rounding across the complete corpus", async () => {
      const fixture = await createFixture();
      try {
        const inputs = nativeRealOracleInputs(), rows = await oracle(fixture, inputs);
        expect(inputs.length).toBeGreaterThan(5000);
        const mismatches: string[] = [], observedDifferences: typeof approvedNativeInputDifferences[number][] = [];
        for (const [index, input] of inputs.entries()) {
          const row = rows[index];
          if (row === undefined) throw new Error("REAL oracle lost an ordinal");
          const normalized = normalizeRelationalRealValue(input);
          if (!row.valid) {
            Result.match(normalized, { onFailure: () => undefined, onSuccess: actual => {
              mismatches.push(`native refused ${String(input)}, portable accepted ${String(actual)}`);
            } });
            continue;
          }
          if (row.converted === null || row.bits === null) throw new Error("Native REAL oracle lost a valid value");
          const expected = Number(row.converted);
          Result.match(normalized, {
            onFailure: failure => { mismatches.push(`native accepted ${String(input)} -> ${row.converted}, portable refused ${failure.reason}`); },
            onSuccess: actual => {
              const portableBits = binary32Bits(actual);
              if (!Object.is(actual, expected) || portableBits !== row.bits) {
                const approved = options.inputComparison === "characterize" ? approvedNativeInputDifferences.find(difference =>
                  difference.submitted === input && difference.native === expected && difference.nativeBits === row.bits
                    && difference.portable === actual && difference.portableBits === portableBits) : undefined;
                if (approved === undefined) mismatches.push(`submitted ${String(input)} -> native ${row.converted}/${row.bits}, portable ${String(actual)}/${portableBits}`);
                else observedDifferences.push(approved);
              }
              const stable = Result.match(normalizeRelationalRealValue(actual), {
                onFailure: () => false, onSuccess: canonical => Object.is(canonical, actual),
              });
              if (!stable) mismatches.push(`portable canonical readback changed ${String(actual)}`);
            },
          });
        }
        expect(mismatches.length, JSON.stringify({ total: mismatches.length, first: mismatches.slice(0, 20) })).toBe(0);
        expect(observedDifferences.toSorted((left, right) => left.submitted - right.submitted))
          .toEqual(observedDifferences.length === 0 ? [] : approvedNativeInputDifferences);
      } finally { await fixture.close(); }
    }, 60_000);
  });
}
