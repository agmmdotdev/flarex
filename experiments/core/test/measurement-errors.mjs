/** Diagnostic boundary only. Preserve native/Effect causes and AggregateError
 * members without invoking accessors or custom serialization on foreign errors. */
export function failureEvidence(value) {
  const seen = new WeakSet(); let remaining = 4096;
  const visit = (item, depth) => {
    if (remaining-- <= 0) return { truncated: "entries" };
    if (typeof item === "string" && item.length > 16000) return { truncated: "string", value: item.slice(0, 16000) };
    if (item === null || typeof item !== "object") return typeof item === "bigint" ? String(item) : typeof item === "function" ? "[function]" : item;
    if (seen.has(item)) return "[circular]";
    if (depth === 32) return { truncated: "depth" };
    seen.add(item);
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(item); }
    catch { return { unreadable: "foreign property descriptors" }; }
    const decode = descriptor => descriptor === undefined ? "[hole]" : "value" in descriptor ? visit(descriptor.value, depth + 1) : "[accessor omitted]";
    if (Array.isArray(item)) {
      const length = descriptors.length.value; const values = [];
      for (let index = 0; index < length && index < 1000 && remaining > 0; index++) {
        remaining--; values.push(decode(descriptors[String(index)]));
      }
      return values.length === length ? values : { truncated: "array", length, values };
    }
    const entries = Object.entries(descriptors); const values = [];
    for (const [key, descriptor] of entries) {
      if (values.length === 1000 || remaining <= 0) break;
      remaining--; values.push([key, decode(descriptor)]);
    }
    return { ...Object.fromEntries(values), ...(values.length === entries.length ? {} : { truncated: "properties" }) };
  };
  return visit(value, 0);
}
