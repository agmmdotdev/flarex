/**
 * Normalized backend Source JSON: Convex common/schemas/json.rs at db914cf06.
 * Numeric layout is serde_json 1.0.151 / zmij 1.0.23. This is distinct from the
 * SDK value-JSON projection: finite f64 literals, including -0.0, are numbers.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { encodeValidatorLiteralV1, type ValidatorJsonV1 } from "./validator-json-core";
import type { SourceResult } from "./validator-source";
import { MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1 } from "./value-runtime-core";

const failure = (reason: string, message: string): SourceResult<never> => ({ ok: false,
  issue: { phase: "semantic", reason, path: "$", message } });

export function serializeSourceSchemaFloat(value: number): SourceResult<string> {
  return Number.isFinite(value) ? { ok: true, value: formatFiniteSchemaFloat(value) }
    : failure("unsupportedFloatLiteral", "Infinite or NaN values are not supported in literal validators.");
}

/** The source emits a mandatory .0 in fixed integral f64s and uses -5..15 fixed exponents. */
function formatFiniteSchemaFloat(value: number): string {
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  const parts = Math.abs(value).toString().split("e");
  const significand = parts[0] ?? "";
  const explicitExponent = parts[1] === undefined ? 0 : Number(parts[1]);
  const dot = significand.indexOf(".");
  const integerDigits = dot < 0 ? significand.length : dot;
  const allDigits = significand.replace(".", "");
  const first = allDigits.search(/[1-9]/);
  const nativeDigits = allDigits.slice(first).replace(/0+$/, "");
  const nativeExponent = explicitExponent + integerDigits - first - 1;
  const { digits, exponent } = closestDecimalDigits(Math.abs(value), nativeDigits.length, nativeExponent);
  if (exponent < -5 || exponent > 15) return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exponent >= 0 ? "+" : ""}${exponent}`;
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const point = exponent + 1;
  return point >= digits.length ? `${sign}${digits}${"0".repeat(point - digits.length)}.0`
    : `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Exact binary-rational closest/even refinement of ECMAScript's shortest digits, as zmij requires. */
function closestDecimalDigits(value: number, digitCount: number, nativeExponent: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const significand = (bits & 0x000f_ffff_ffff_ffffn) | (exponentBits === 0 ? 0n : 0x0010_0000_0000_0000n);
  const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1075;
  const numerator = binaryExponent >= 0 ? significand << BigInt(binaryExponent) : significand;
  const denominator = binaryExponent < 0 ? 1n << BigInt(-binaryExponent) : 1n;
  const decimalExponent = nativeExponent - digitCount + 1;
  const scaledNumerator = decimalExponent < 0 ? numerator * (10n ** BigInt(-decimalExponent)) : numerator;
  const scaledDenominator = decimalExponent > 0 ? denominator * (10n ** BigInt(decimalExponent)) : denominator;
  const floor = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const distance = remainder * 2n;
  const nearest = distance < scaledDenominator || (distance === scaledDenominator && floor % 2n === 0n) ? floor : floor + 1n;
  const selected = Number(`${nearest}e${decimalExponent}`) === value ? nearest : nearest === floor ? floor + 1n : floor;
  const raw = selected.toString();
  return { digits: raw.replace(/0+$/, ""), exponent: decimalExponent + raw.length - 1 };
}

export interface ValidatorSourceSerializationProfile {
  /** The owning envelope can impose a smaller remaining byte budget. The system-value ceiling always applies. */
  readonly maximumBytes?: number;
  /** Raw JSON containers, including field maps/wrappers, rather than logical validator depth. */
  readonly maximumRawContainers?: number;
}
interface Quoted { readonly kind: "quoted"; readonly value: string; readonly bytes: number }
interface Plan { readonly kind: "plan"; readonly parts: readonly Part[]; readonly bytes: number; readonly containers: number }
type Part = string | Quoted | Plan;
const tooManyBytes = () => failure("bytesExceeded", "Source validator JSON exceeds its owning metadata byte budget.");
function unexpectedValidator(value: never): never {
  throw new Error(`Unexpected captured Source validator: ${JSON.stringify(value)}`);
}

/** The escaped JSON string is measured before JSON.stringify can expand it. */
function quoted(value: string, maximumBytes: number): SourceResult<Quoted> {
  if (value.length > maximumBytes - 2) return tooManyBytes();
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 34 || unit === 92 || unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13) bytes += 2;
    else if (unit < 32) bytes += 6;
    else if (unit >= 0xd800 && unit <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { bytes += 4; index++; }
    else if (unit >= 0xd800 && unit <= 0xdfff) bytes += 6;
    else bytes += unit < 128 ? 1 : unit < 2048 ? 2 : 3;
    if (bytes > maximumBytes) return tooManyBytes();
  }
  return { ok: true, value: { kind: "quoted", value, bytes } };
}

/**
 * Consume already captured semantic validators; no parsing or normalization occurs.
 * Memoized graph summaries count repeated DAG branches arithmetically before
 * materializing text. The actual string budget bounds expansion, not node count.
 */
function planValidatorSource(validator: ValidatorJsonV1,
  profile: ValidatorSourceSerializationProfile): SourceResult<Plan> {
  const maximumBytes = Math.min(profile.maximumBytes ?? MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1, MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1);
  const maximumContainers = profile.maximumRawContainers ?? Infinity;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || !(maximumContainers >= 1))
    return failure("invalidBudget", "Invalid Source serialization owner budget.");
  const memo = new WeakMap<ValidatorJsonV1, Plan>();
  const active = new WeakSet<ValidatorJsonV1>();
  const work: { readonly node: ValidatorJsonV1; readonly finish: boolean }[] = [{ node: validator, finish: false }];
  while (work.length > 0) {
    const item = work.pop();
    if (item === undefined) break;
    const node = item.node;
    if (memo.has(node)) continue;
    if (!item.finish) {
      if (active.has(node)) return failure("cycle", "Cyclic semantic validator JSON is invalid.");
      active.add(node);
      work.push({ node, finish: true });
      const children: ValidatorJsonV1[] = [];
      switch (node.type) {
        case "array": children.push(node.value); break;
        case "record": children.push(node.keys, node.values); break;
        case "union": for (const member of node.value) children.push(member); break;
        case "object": for (const field of Object.values(node.value)) children.push(field.fieldType); break;
        case "function": if (node.args !== undefined) children.push(node.args); if (node.returns !== undefined) children.push(node.returns); break;
        case "literal": case "id": case "null": case "number": case "bigint": case "commitTs":
        case "boolean": case "string": case "bytes": case "any": break;
        default: return unexpectedValidator(node);
      }
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child !== undefined) work.push({ node: child, finish: false });
      }
      continue;
    }
    const parts: Part[] = [`{"type":"${node.type}"`];
    let containers = 1;
    const child = (value: ValidatorJsonV1): Plan => {
      const plan = memo.get(value);
      if (plan === undefined) throw new Error("Captured validator serialization lost a child plan.");
      return plan;
    };
    switch (node.type) {
      case "literal": {
        if (typeof node.value === "number") {
          const value = serializeSourceSchemaFloat(node.value);
          if (!value.ok) return value;
          parts.push(',"value":', value.value);
        } else if (typeof node.value === "string") {
          const value = quoted(node.value, maximumBytes);
          if (!value.ok) return value;
          parts.push(',"value":', value.value);
        } else {
          parts.push(',"value":', JSON.stringify(encodeValidatorLiteralV1(node.value)));
          if (typeof node.value === "bigint") containers = 2;
        }
        break;
      }
      case "id": {
        const name = quoted(node.tableName, maximumBytes);
        if (!name.ok) return name;
        parts.push(',"tableName":', name.value); break;
      }
      case "array": { const value = child(node.value); parts.push(',"value":', value); containers = value.containers + 1; break; }
      case "union": {
        parts.push(',"value":['); containers = 2;
        for (let index = 0; index < node.value.length; index++) {
          const member = node.value[index];
          if (member === undefined) throw new Error("Captured union lost a member.");
          const value = child(member); if (index > 0) parts.push(","); parts.push(value);
          containers = Math.max(containers, value.containers + 2);
        }
        parts.push("]"); break;
      }
      case "record": {
        const keys = child(node.keys), values = child(node.values);
        parts.push(',"keys":', keys, ',"values":{"fieldType":', values, ',"optional":false}');
        containers = Math.max(keys.containers + 1, values.containers + 2); break;
      }
      case "object": {
        parts.push(',"value":{'); containers = 2;
        const fields = Object.entries(node.value).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        for (let index = 0; index < fields.length; index++) {
          const field = fields[index];
          if (field === undefined) throw new Error("Captured object lost a field.");
          const key = quoted(field[0], maximumBytes);
          if (!key.ok) return key;
          const value = child(field[1].fieldType);
          if (index > 0) parts.push(",");
          parts.push(key.value, ':{"fieldType":', value, `,"optional":${field[1].optional}}`);
          containers = Math.max(containers, value.containers + 3);
        }
        parts.push("}"); break;
      }
      case "function": {
        if (node.fnType !== undefined) parts.push(`,"fnType":"${node.fnType}"`);
        if (node.args !== undefined) { const value = child(node.args); parts.push(',"args":', value); containers = Math.max(containers, value.containers + 1); }
        if (node.returns !== undefined) { const value = child(node.returns); parts.push(',"returns":', value); containers = Math.max(containers, value.containers + 1); }
        break;
      }
      case "null": case "number": case "bigint": case "commitTs": case "boolean": case "string": case "bytes": case "any": break;
      default: return unexpectedValidator(node);
    }
    parts.push("}");
    if (containers > maximumContainers) return failure("recursionLimit", "Source JSON recursion limit exceeded.");
    let bytes = 0;
    for (const part of parts) {
      const size = typeof part === "string" ? part.length : part.bytes;
      if (size > maximumBytes - bytes) return tooManyBytes();
      bytes += size;
    }
    memo.set(node, { kind: "plan", parts, bytes, containers });
    active.delete(node);
  }
  const root = memo.get(validator);
  if (root === undefined) throw new Error("Captured validator serialization lost its root plan.");
  return { ok: true, value: root };
}

export function measureValidatorSourceResult(validator: ValidatorJsonV1,
  profile: ValidatorSourceSerializationProfile = {}): SourceResult<Readonly<{ bytes: number; rawContainers: number }>> {
  const planned = planValidatorSource(validator, profile);
  return planned.ok ? { ok: true, value: { bytes: planned.value.bytes, rawContainers: planned.value.containers } } : planned;
}

export function serializeValidatorSourceResult(validator: ValidatorJsonV1,
  profile: ValidatorSourceSerializationProfile = {}): SourceResult<string> {
  const planned = planValidatorSource(validator, profile);
  if (!planned.ok) return planned;
  const root = planned.value;
  const pending: Part[] = [root], output: string[] = [];
  while (pending.length > 0) {
    const part = pending.pop();
    if (part === undefined) break;
    if (typeof part === "string") output.push(part);
    else if (part.kind === "quoted") output.push(JSON.stringify(part.value));
    else for (let index = part.parts.length - 1; index >= 0; index--) {
      const child = part.parts[index];
      if (child !== undefined) pending.push(child);
    }
  }
  return { ok: true, value: output.join("") };
}
