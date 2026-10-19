/** Selected MikroORM6.4.16 JSON assignment, Copyright(c)2018 Martin Adámek.
 * MIT notice: ../../LICENSE.mikro-orm. Frozen sources and exact extraction guard:
 * third_party/medusa/runtime-dependencies/mikro-orm-core-6.4.16.
 *
 * Inputs have passed the owning bounded JsonObject/null decoder. Only captured
 * JSON is supported: ORM PlainObject instances, custom clones and entity values
 * are outside this seam. The existing native Medusa copier establishes ordinary
 * JSON container representation before the pinned plain-object decisions and
 * supplies the equivalent JSON-only Utils.copy binding.
 */
import { parseStringifyIfNecessary } from "../common/parse-stringify-if-necessary"

type JsonRecord = Record<string, unknown>
type JsonInput = Readonly<JsonRecord> | null

/** Algorithm-domain policy after the caller's JSON capture/decoder. Own
 * __proto__ keys are unsupported because the original foreign merge can follow
 * an inherited target object. Constructor/prototype business keys stay valid.
 * This is not a replacement JSON validator, byte/depth limit or authority. */
export function supportsNativeJsonObjectAssignment(input: JsonInput): boolean {
  const active = new Set<object>()
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== "object") return true
    if (active.has(value) || Object.prototype.hasOwnProperty.call(value, "__proto__")) return false
    const prototype = Object.getPrototypeOf(value)
    if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false
    active.add(value)
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || !visit(descriptor.value)) return false
    }
    active.delete(value)
    return true
  }
  return visit(input)
}

function ordinaryJsonObject(input: JsonInput): JsonRecord | null {
  const value: unknown = parseStringifyIfNecessary(input)
  if (value === null || Utils.isObject(value)) return value
  throw new TypeError("Expected captured native JSON object or null")
}

/** Native mergeObjectProperties:true for a checked JSON column. Refusal occurs
 * before normalization or the original unsafe merge. Callers own input/stored
 * failure classification and decode the returned JSON with their DML contract. */
export function assignNativeJsonObject(current: JsonInput, patch: JsonInput): JsonRecord | null {
  if (!supportsNativeJsonObjectAssignment(current) || !supportsNativeJsonObjectAssignment(patch)) {
    throw new TypeError("Unsupported native JSON assignment domain")
  }
  const before = ordinaryJsonObject(current), value = ordinaryJsonObject(patch)
  if (Utils.isPlainObject(before) && Utils.isPlainObject(value)) {
    return Utils.merge({}, before, value)
  }
  return value
}

class Utils {
    static isObject(o: unknown): o is JsonRecord {
        return !!o && typeof o === 'object' && !Array.isArray(o);
    }

    static isPlainObject(value: unknown): value is JsonRecord {
        return !!((value !== null
            && typeof value === 'object'
            && typeof value.constructor === 'function'
            && (Object.prototype.hasOwnProperty.call(value.constructor.prototype, 'isPrototypeOf') || Object.getPrototypeOf(value.constructor.prototype) === null))
            || (value && Object.getPrototypeOf(value) === null)
            );
    }

    static merge(target: JsonRecord, ...sources: unknown[]): JsonRecord {
        return Utils._merge(target, sources, false);
    }

    static _merge(target: JsonRecord, sources: unknown[], ignoreUndefined: boolean): JsonRecord {
        if (!sources.length) {
            return target;
        }
        const source = sources.shift();
        if (Utils.isObject(target) && Utils.isPlainObject(source)) {
            for (const [key, value] of Object.entries(source)) {
                if (ignoreUndefined && typeof value === 'undefined') {
                    continue;
                }
                if (Utils.isPlainObject(value)) {
                    if (!Utils.isObject(target[key])) {
                        target[key] = Utils.copy(value);
                        continue;
                    }
                    /* istanbul ignore next */
                    if (!(key in target)) {
                        Object.assign(target, { [key]: {} });
                    }
                    Utils._merge(target[key], [value], ignoreUndefined);
                }
                else {
                    Object.assign(target, { [key]: value });
                }
            }
        }
        return Utils._merge(target, sources, ignoreUndefined);
    }

    static copy(entity: unknown, respectCustomCloneMethod = true): unknown {
        return parseStringifyIfNecessary(entity);
    }
}
