import { Data, Result, Schema } from "effect";

// ASCII decimal text also fits the existing single native string component budget.
export const MAX_EXACT_DECIMAL_TEXT_LENGTH = 2040;
export const MAX_EXACT_DECIMAL_DIGITS = 1024;
const MIN_POWER = -16383;
const MAX_MAGNITUDE = 131071;
// A true input-end assertion; JavaScript's $ also permits a final line terminator.
const syntax = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d{1,6}))?(?![\s\S])/;
const DecimalText = Schema.String.check(Schema.isMaxLength(MAX_EXACT_DECIMAL_TEXT_LENGTH), Schema.isPattern(syntax));
const decodeText = Schema.decodeUnknownResult(DecimalText);
const decodeBytes = Schema.decodeUnknownResult(Schema.Uint8Array.check(Schema.isMaxLength(MAX_EXACT_DECIMAL_DIGITS + 6)));

export class ExactDecimalError extends Data.TaggedError("ExactDecimalError")<{
  readonly reason: "invalidInput" | "limitExceeded";
}> {}

/** Exact finite decimal normalization. No coefficient passes through binary64. */
export function decodeExactDecimal(input: unknown) {
  return Result.gen(function* () {
    const text = yield* decodeText(input).pipe(Result.mapError(() => new ExactDecimalError({ reason: "invalidInput" })));
    const match = syntax.exec(text);
    if (match === null) throw new Error("Decoded decimal lost its lexical contract");
    const fraction = match[3] ?? match[4] ?? "";
    const exponent = Number(match[5] ?? "0");
    let power = exponent - fraction.length;
    if (exponent < MIN_POWER || exponent > MAX_MAGNITUDE || power < MIN_POWER) {
      return yield* Result.fail(new ExactDecimalError({ reason: "limitExceeded" }));
    }
    let digits = ((match[2] ?? "") + fraction).replace(/^0+/, "");
    if (digits.length === 0) return Object.freeze({ sign: 0 as const, digits: "0", power: 0, magnitude: 0, canonical: "0" });
    const trimmed = digits.replace(/0+$/, "");
    power += digits.length - trimmed.length;
    digits = trimmed;
    const magnitude = power + digits.length - 1;
    if (digits.length > MAX_EXACT_DECIMAL_DIGITS || magnitude > MAX_MAGNITUDE) {
      return yield* Result.fail(new ExactDecimalError({ reason: "limitExceeded" }));
    }
    const sign = match[1] === "-" ? -1 as const : 1 as const;
    return Object.freeze({ sign, digits, power, magnitude, canonical: `${sign < 0 ? "-" : ""}${digits}e${power}` });
  });
}

/** Sign, biased scientific exponent, significand and terminator. Complementing
 * the complete negative magnitude reverses order, including prefix cases.
 * Returned bytes are owned by the caller; decimal text remains the row value. */
export function encodeExactDecimalOrderBytes(input: unknown) {
  return decodeExactDecimal(input).pipe(Result.map(value => {
    if (value.sign === 0) return Uint8Array.of(0x20);
    const bytes = new Uint8Array(value.digits.length + 6);
    bytes[0] = value.sign < 0 ? 0x10 : 0x30;
    new DataView(bytes.buffer).setUint32(1, value.magnitude - MIN_POWER, false);
    for (let index = 0; index < value.digits.length; index++) bytes[index + 5] = value.digits.charCodeAt(index) - 47;
    if (value.sign < 0) for (let index = 1; index < bytes.length; index++) bytes[index] = 255 - bytes[index]!;
    return bytes;
  }));
}

/** Decode only canonical projected bytes. Returning canonical decimal text keeps
 * the physical key codec reversible without retaining the original spelling. */
export function decodeExactDecimalOrderBytes(input: unknown) {
  return Result.gen(function* () {
    const bytes = yield* decodeBytes(input).pipe(Result.mapError(() => new ExactDecimalError({ reason: "invalidInput" })));
    if (bytes.length === 1 && bytes[0] === 0x20) return "0";
    const sign = bytes[0];
    if (bytes.length < 7 || (sign !== 0x10 && sign !== 0x30)) {
      return yield* Result.fail(new ExactDecimalError({ reason: "invalidInput" }));
    }
    const magnitudeBytes = bytes.slice(1);
    if (sign === 0x10) for (let i = 0; i < magnitudeBytes.length; i++) magnitudeBytes[i] = 255 - magnitudeBytes[i]!;
    const magnitude = new DataView(magnitudeBytes.buffer).getUint32(0, false) + MIN_POWER;
    let digits = "";
    for (let i = 4; i < magnitudeBytes.length - 1; i++) {
      const digit = magnitudeBytes[i]!;
      if (digit < 1 || digit > 10) return yield* Result.fail(new ExactDecimalError({ reason: "invalidInput" }));
      digits += String(digit - 1);
    }
    if (magnitudeBytes.at(-1) !== 0 || digits.startsWith("0") || digits.endsWith("0")) {
      return yield* Result.fail(new ExactDecimalError({ reason: "invalidInput" }));
    }
    const decoded = yield* decodeExactDecimal(`${sign === 0x10 ? "-" : ""}${digits}e${magnitude - digits.length + 1}`);
    return decoded.canonical;
  });
}
