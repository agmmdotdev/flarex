import { Data, Result, Schema } from "effect";
import { decodeExactDecimal } from "flarex-protocol/internal/exact-decimal";

export class RelationalRealValueError extends Data.TaggedError("RelationalRealValueError")<{
  readonly reason: "invalidInput" | "outOfRange";
}> {}

const decodeFinite = Schema.decodeUnknownResult(Schema.Finite);
const infinityBits = 0x7f800000;
type Decimal = Readonly<{ numerator: bigint; denominator: bigint }>;
type Binary32Parts = Readonly<{ significand: bigint; power: number }>;
const realDecimal = (text: string) => decodeExactDecimal(text).pipe(
  Result.mapError(() => new RelationalRealValueError({ reason: "invalidInput" })));

function positiveDecimal(text: string): Result.Result<Decimal, RelationalRealValueError> {
  return realDecimal(text).pipe(Result.map(value => ({ numerator: BigInt(value.digits) * (value.power > 0 ? 10n ** BigInt(value.power) : 1n),
      denominator: value.power < 0 ? 10n ** BigInt(-value.power) : 1n })));
}

/** Infinity's predecessor has a finite rounding boundary at max + half an ULP.
 * Represent its virtual successor as 2^128 solely to calculate that boundary. */
function binary32Parts(bits: number): Binary32Parts {
  if (bits === infinityBits) return { significand: 1n, power: 128 };
  const exponent = bits >>> 23;
  return { significand: BigInt((bits & 0x7fffff) + (exponent === 0 ? 0 : 0x800000)),
    power: exponent === 0 ? -149 : exponent - 150 };
}

function compareMidpoint(decimal: Decimal, lowerBits: number): -1 | 0 | 1 {
  const lower = binary32Parts(lowerBits), upper = binary32Parts(lowerBits + 1);
  const power = Math.min(lower.power, upper.power);
  const significand = (lower.significand << BigInt(lower.power - power))
    + (upper.significand << BigInt(upper.power - power));
  const midpointPower = power - 1;
  const left = midpointPower < 0 ? decimal.numerator << BigInt(-midpointPower) : decimal.numerator;
  const right = (midpointPower > 0 ? significand << BigInt(midpointPower) : significand) * decimal.denominator;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Binary64 gives a neighboring candidate; exact decimal midpoint comparisons
 * resolve direct decimal->binary32 rounding without binary64 double rounding. */
function roundPositiveDecimal(text: string, view: DataView): Result.Result<number, RelationalRealValueError> {
  return positiveDecimal(text).pipe(Result.map(decimal => {
    view.setFloat32(0, Number(text), false);
    const candidate = view.getUint32(0, false);
    const odd = (candidate & 1) !== 0;
    if (candidate > 0) {
      const comparison = compareMidpoint(decimal, candidate - 1);
      if (comparison < 0 || comparison === 0 && odd) return candidate - 1;
    }
    if (candidate < infinityBits) {
      const comparison = compareMidpoint(decimal, candidate);
      if (comparison > 0 || comparison === 0 && odd) return candidate + 1;
    }
    return candidate;
  }));
}

/** Portable native REAL storage uses exact decimal->binary32 nearest-even and
 * PostgreSQL's strict-shortest decimal, returned through the JSON number wire.
 * String(-0) is "0", matching the former SQL conversion's submitted spelling.
 * The native repository separately retains submitted values for immediate DTOs. */
export function normalizeRelationalRealValue(input: unknown): Result.Result<number, RelationalRealValueError> {
  return Result.gen(function* () {
    const value = yield* decodeFinite(input).pipe(Result.mapError(() => new RelationalRealValueError({ reason: "invalidInput" })));
    if (value === 0) return 0;
    const sign = value < 0 ? -1 : 1, view = new DataView(new ArrayBuffer(4));
    const bits = yield* roundPositiveDecimal(String(Math.abs(value)), view);
    if (bits === 0 || bits >= infinityBits) return yield* Result.fail(new RelationalRealValueError({ reason: "outOfRange" }));
    view.setUint32(0, bits, false);
    const exact = view.getFloat32(0, false);
    const magnitude = (yield* realDecimal(String(exact))).magnitude;
    const binary = binary32Parts(bits);
    const binaryNumerator = binary.power >= 0 ? binary.significand << BigInt(binary.power) : binary.significand;
    const binaryDenominator = binary.power < 0 ? 1n << BigInt(-binary.power) : 1n;
    // Every finite binary32 has a roundtrip decimal with at most nine digits.
    // A power-of-two value has an asymmetric interval: the nearest decimal at
    // a given precision can be outside while an adjacent decimal is inside.
    // PostgreSQL src/common/ryu_common.h sets STRICTLY_SHORTEST=0: output
    // excludes exact midpoints even when a round-to-even reader accepts them.
    // Select the shortest open-interval lattice, then nearest/even within it.
    for (let digits = 1; digits <= 9; digits++) {
      const quantumPower = magnitude - digits + 1;
      const nearest = yield* realDecimal(exact.toPrecision(digits));
      const center = BigInt(nearest.digits) * 10n ** BigInt(nearest.power - quantumPower);
      const quantumNumerator = quantumPower > 0 ? 10n ** BigInt(quantumPower) : 1n;
      const quantumDenominator = quantumPower < 0 ? 10n ** BigInt(-quantumPower) : 1n;
      let selected: Readonly<{ coefficient: bigint; distance: bigint; text: string }> | undefined;
      for (const coefficient of [center, center - 1n, center + 1n]) {
        if (coefficient <= 0n) continue;
        const text = `${coefficient}e${quantumPower}`;
        const decimal = { numerator: coefficient * quantumNumerator, denominator: quantumDenominator };
        if (compareMidpoint(decimal, bits - 1) <= 0 || compareMidpoint(decimal, bits) >= 0) continue;
        const signedDistance = coefficient * quantumNumerator * binaryDenominator - binaryNumerator * quantumDenominator;
        const distance = signedDistance < 0n ? -signedDistance : signedDistance;
        if (selected === undefined || distance < selected.distance
          || distance === selected.distance && (coefficient & 1n) === 0n && (selected.coefficient & 1n) !== 0n)
          selected = { coefficient, distance, text };
      }
      if (selected !== undefined) return sign * Number(selected.text);
    }
    throw new Error("A finite binary32 value lost its nine-digit roundtrip");
  });
}
