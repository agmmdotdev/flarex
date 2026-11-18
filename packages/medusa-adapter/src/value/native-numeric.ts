import { Result } from "effect";
import { snapshotNativeNumber } from "@medusajs/utils/totals/native-number";
import { measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";
import { commerceError, CommerceTransactionError, defaultCommerceResources, type CommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./input";

/** Native service DTOs retain quantity objects after formatOrder. Normalize
 * only the pinned numeric representations, then use the unchanged strict JSON
 * owner for omission, bytes and value limits. Storage/caller input never opts
 * into this presentation boundary implicitly. */
export function captureNativeNumericDto(input: unknown,
  resources: Pick<CommerceResources, "commandBytes" | "valueNodes"> = defaultCommerceResources) {
  return Result.gen(function* () {
    const normalized = yield* Result.try({ try: () => {
      const active = new Set<object>(); let visited = 0, numericBytes = 0;
      const numbers = new WeakMap<object, NonNullable<ReturnType<typeof snapshotNativeNumber>>>();
      const visit = (value: unknown, depth: number): unknown => {
        if (++visited > resources.valueNodes || depth > 16) throw commerceError("limitExceeded");
        if (value === null || typeof value !== "object") return value;
        const numeric = numbers.get(value) ?? snapshotNativeNumber(value);
        if (numeric !== undefined) {
          numbers.set(value, numeric);
          // Bound generated numeric strings during normalization, before the
          // final strict owner charges the complete expanded graph. Aliases
          // share inert conversion work but each output occurrence is charged.
          const measured = measureCanonicalJsonUtf8Bytes(numeric.json, resources.commandBytes - numericBytes);
          if (measured.kind !== "success") throw commerceError(measured.kind === "invalid" ? "invalidInput" : "limitExceeded");
          numericBytes += measured.bytes;
          return numeric.json;
        }
        if (active.has(value)) throw commerceError("invalidInput");
        const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
        if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw commerceError("invalidInput");
        active.add(value);
        const output: Record<string, unknown> = {}, members: unknown[] = [];
        const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value : undefined;
        const keys = Reflect.ownKeys(value);
        if (keys.length > resources.valueNodes) throw commerceError("limitExceeded");
        for (const key of keys) {
          if (array && key === "length") continue;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== "string" || descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable ||
            array && (key !== String(members.length) || typeof length !== "number" || Number(key) >= length)) throw commerceError("invalidInput");
          const member = visit(descriptor.value, depth + 1);
          if (array) members.push(member);
          else Object.defineProperty(output, key, { value: member, enumerable: true, writable: true, configurable: true });
        }
        if (array && members.length !== length) throw commerceError("invalidInput");
        active.delete(value);
        return array ? members : output;
      };
      return visit(input, 0);
    }, catch: cause => cause instanceof CommerceTransactionError ? cause : commerceError("invalidInput", cause) });
    return yield* captureCommerceInput(normalized, resources);
  });
}
