import { BigNumber as ArithmeticNumber } from "bignumber.js"
import { BigNumber } from "./big-number"

// Use the library's own representation validator on an isolated constructor.
// Do not change global arithmetic configuration while capturing native data.
const CheckedNumber = ArithmeticNumber.clone()
CheckedNumber.DEBUG = true
const maximumCoefficients = 4096
// Each native coefficient carries at most 14 decimal digits. Allow room for
// sign, radix and the native exponent spelling, before parsing retained raw.
const maximumRawCharacters = maximumCoefficients * 14 + 32

function ownData(input: object, names: readonly string[]): Record<string, unknown> {
  const keys = Reflect.ownKeys(input)
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key))) {
    throw new TypeError("Unsupported native numeric properties")
  }
  const output: Record<string, unknown> = {}
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name)
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Native numbers require own data properties")
    }
    Object.defineProperty(output, name, { value: descriptor.value, enumerable: true })
  }
  return output
}

function arithmeticSnapshot(input: object): InstanceType<typeof ArithmeticNumber> {
  if (Object.getPrototypeOf(input) !== ArithmeticNumber.prototype) throw new TypeError("Unsupported arithmetic number prototype")
  const data = ownData(input, ["c", "e", "s"])
  if (typeof data.e !== "number" || !Number.isInteger(data.e) || data.s !== 1 && data.s !== -1) {
    throw new TypeError("Expected finite native arithmetic exponent and sign")
  }
  const coefficients = data.c
  if (!Array.isArray(coefficients) || Object.getPrototypeOf(coefficients) !== Array.prototype) {
    throw new TypeError("Expected finite native arithmetic number")
  }
  const length = Object.getOwnPropertyDescriptor(coefficients, "length")?.value
  if (typeof length !== "number" || length < 1 || length > maximumCoefficients || Reflect.ownKeys(coefficients).length !== length + 1) {
    throw new TypeError("Native numeric coefficient bounds exceeded")
  }
  const digits: number[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(coefficients, String(index))
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "number") {
      throw new TypeError("Native numeric coefficients require own numeric data")
    }
    digits.push(descriptor.value)
  }
  const value = new CheckedNumber(0)
  Object.defineProperties(value, {
    c: { value: digits, writable: true, configurable: true, enumerable: true },
    e: { value: data.e, writable: true, configurable: true, enumerable: true },
    s: { value: data.s, writable: true, configurable: true, enumerable: true },
  })
  if (!CheckedNumber.isBigNumber(value) || !value.isFinite()) throw new TypeError("Expected finite native arithmetic number")
  return value
}

/** The two native numeric representations have different JSON semantics:
 * MathBN keeps an exact decimal string; Medusa quantities present a number.
 * Snapshot inert state before using trusted constructors/methods. Foreign
 * prototypes, subclasses, getters and serializer overrides are never invoked.
 * This representation conveys no authority and does not admit arbitrary JSON.
 */
export function snapshotNativeNumber(input: object): { json: string | number; exact: string } | undefined {
  const prototype = Object.getPrototypeOf(input)
  if (prototype === ArithmeticNumber.prototype) {
    const value = arithmeticSnapshot(input), exact = CheckedNumber.prototype.valueOf.call(value)
    return { json: exact, exact }
  }
  if (prototype !== BigNumber.prototype) return undefined
  const data = ownData(input, ["numeric_", "raw_", "bignumber_"])
  if (typeof data.numeric_ !== "number" || !Number.isFinite(data.numeric_)) throw new TypeError("Expected finite native quantity")
  const raw = data.raw_
  if (raw === null || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype) {
    throw new TypeError("Expected native raw quantity")
  }
  const pair = ownData(raw, ["value", "precision"])
  if (typeof pair.value !== "string" || pair.value.length > maximumRawCharacters || typeof pair.precision !== "number" || !Number.isInteger(pair.precision) || pair.precision < 1 || pair.precision > 100) {
    throw new TypeError("Invalid native raw quantity")
  }
  const arithmetic = data.bignumber_
  if (arithmetic === null || typeof arithmetic !== "object") throw new TypeError("Expected native quantity arithmetic")
  const value = arithmeticSnapshot(arithmetic)
  const json = BigNumber.prototype.toJSON.call(new BigNumber(value.toString()))
  if (!Number.isFinite(json) || !new CheckedNumber(pair.value).isFinite()) throw new TypeError("Expected finite native quantity")
  return { json, exact: pair.value }
}
