import { isJsonObject, type Json } from "flarex-protocol/json";

/** PostgreSQL JSONB containment on decoded JSON. The scalar member exception
 * applies only to a top-level array; nested containers match their own type. */
export function jsonbContains(left: Json, right: Json, topLevel = true): boolean {
  if (Array.isArray(left)) {
    if (Array.isArray(right)) return right.every(member => left.some(candidate =>
      jsonbContains(candidate, member, false)));
    return topLevel && (right === null || typeof right !== "object") &&
      left.some(member => member === right);
  }
  if (Array.isArray(right)) return false;
  if (isJsonObject(left) && isJsonObject(right))
    return Object.entries(right).every(([key, value]) => Object.hasOwn(left, key) &&
      jsonbContains(left[key]!, value, false));
  return left === right;
}
