export const SYSTEM_TEST_STRUCTURED_CLONE_BRIDGE_WORKER_SOURCE_V1 = `
const encodeStructuredCloneBridgeValue = (value, ancestors = new WeakSet()) => {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  switch (typeof value) {
    case "boolean":
      return ["boolean", value];
    case "number":
      if (Number.isNaN(value)) return ["number", "nan"];
      if (value === Number.POSITIVE_INFINITY) return ["number", "positiveInfinity"];
      if (value === Number.NEGATIVE_INFINITY) return ["number", "negativeInfinity"];
      if (Object.is(value, -0)) return ["number", "negativeZero"];
      return ["number", "finite", value];
    case "string":
      return ["string", value];
    case "bigint":
      return ["bigint", value.toString()];
    case "object": {
      if (value instanceof Uint8Array) {
        return ["uint8Array", Array.from(value)];
      }
      if (value instanceof ArrayBuffer) {
        return ["arrayBuffer", Array.from(new Uint8Array(value))];
      }
      if (ancestors.has(value)) {
        throw new Error("The system-test RPC bridge received a cyclic value.");
      }
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const keys = Reflect.ownKeys(value);
          if (keys.length !== value.length + 1 || keys.some((key) =>
            key !== "length" &&
            (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
              Number(key) >= value.length ||
              !(Object.getOwnPropertyDescriptor(value, key)?.enumerable) ||
              !("value" in Object.getOwnPropertyDescriptor(value, key))))
          ) throw new Error("The system-test RPC bridge received an invalid array.");
          return ["array", value.map((member) =>
            encodeStructuredCloneBridgeValue(member, ancestors))];
        }
        const prototype = Object.getPrototypeOf(value);
        const constructor = prototype === null
          ? undefined
          : Object.getOwnPropertyDescriptor(prototype, "constructor");
        if (
          prototype !== null && prototype !== Object.prototype &&
          !(constructor && "value" in constructor &&
            typeof constructor.value === "function" && constructor.value.name === "Object")
        ) throw new Error("The system-test RPC bridge received a non-plain object.");
        const entries = [];
        for (const key of Reflect.ownKeys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== "string" || descriptor === undefined ||
            !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error("The system-test RPC bridge received an invalid object property.");
          }
          entries.push([key, encodeStructuredCloneBridgeValue(descriptor.value, ancestors)]);
        }
        return ["object", entries];
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new Error("The system-test RPC bridge received an unsupported value.");
  }
};
const decodeStructuredCloneBridgeValue = value => {
  if (!Array.isArray(value) || typeof value[0] !== "string")
    throw new Error("The system-test RPC bridge received an invalid value tag.");
  const tag = value[0];
  if (tag === "undefined" && value.length === 1) return undefined;
  if (tag === "null" && value.length === 1) return null;
  if (tag === "boolean" && value.length === 2 && typeof value[1] === "boolean") return value[1];
  if (tag === "number") {
    if (value.length === 2 && value[1] === "nan") return Number.NaN;
    if (value.length === 2 && value[1] === "positiveInfinity") return Number.POSITIVE_INFINITY;
    if (value.length === 2 && value[1] === "negativeInfinity") return Number.NEGATIVE_INFINITY;
    if (value.length === 2 && value[1] === "negativeZero") return -0;
    if (value.length === 3 && value[1] === "finite" &&
      typeof value[2] === "number" && Number.isFinite(value[2])) return value[2];
  }
  if (tag === "string" && value.length === 2 && typeof value[1] === "string") return value[1];
  if (tag === "bigint" && value.length === 2 && typeof value[1] === "string" &&
    /^-?(?:0|[1-9][0-9]*)$/u.test(value[1])) return BigInt(value[1]);
  if (tag === "uint8Array" && value.length === 2 && Array.isArray(value[1]) &&
    value[1].every((member) => Number.isInteger(member) && member >= 0 && member <= 255)) {
    return Uint8Array.from(value[1]);
  }
  if (tag === "arrayBuffer" && value.length === 2 && Array.isArray(value[1]) &&
    value[1].every((member) => Number.isInteger(member) && member >= 0 && member <= 255)) {
    return Uint8Array.from(value[1]).buffer;
  }
  if (tag === "array" && value.length === 2 && Array.isArray(value[1]))
    return value[1].map(decodeStructuredCloneBridgeValue);
  if (tag === "object" && value.length === 2 && Array.isArray(value[1])) {
    const entries = [];
    const keys = new Set();
    for (const entry of value[1]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" ||
        keys.has(entry[0])) throw new Error("The system-test RPC bridge received an invalid object entry.");
      keys.add(entry[0]);
      entries.push([entry[0], decodeStructuredCloneBridgeValue(entry[1])]);
    }
    return Object.fromEntries(entries);
  }
  throw new Error("The system-test RPC bridge received an invalid value.");
};`;

export function systemTestStructuredCloneBridgeEchoModuleSourceForTest(): string {
  return `${SYSTEM_TEST_STRUCTURED_CLONE_BRIDGE_WORKER_SOURCE_V1}
export default {
  async fetch(request) {
    const decoded = decodeStructuredCloneBridgeValue(
      JSON.parse(await request.text()),
    );
    return new Response(JSON.stringify(
      encodeStructuredCloneBridgeValue(decoded),
    ));
  },
};`;
}

export function encodeSystemTestStructuredCloneBridgeValueV1(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["number", "nan"];
    if (value === Number.POSITIVE_INFINITY) {
      return ["number", "positiveInfinity"];
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return ["number", "negativeInfinity"];
    }
    if (Object.is(value, -0)) return ["number", "negativeZero"];
    return ["number", "finite", value];
  }
  if (typeof value === "string") return ["string", value];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value !== "object") {
    throw new Error("The system-test RPC bridge received an unsupported value.");
  }
  if (value instanceof Uint8Array) {
    return ["uint8Array", Array.from(value)];
  }
  if (value instanceof ArrayBuffer) {
    return ["arrayBuffer", Array.from(new Uint8Array(value))];
  }
  if (ancestors.has(value)) {
    throw new Error("The system-test RPC bridge received a cyclic value.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== value.length + 1) {
        throw new Error("The system-test RPC bridge received an invalid array.");
      }
      const encoded: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined || !("value" in descriptor) ||
          !descriptor.enumerable
        ) {
          throw new Error("The system-test RPC bridge received an invalid array.");
        }
        encoded.push(encodeSystemTestStructuredCloneBridgeValueV1(
          descriptor.value,
          ancestors,
        ));
      }
      return ["array", encoded];
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    const constructor = prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (
      prototype !== null && prototype !== Object.prototype &&
      !(
        constructor !== undefined && "value" in constructor &&
        typeof constructor.value === "function" &&
        constructor.value.name === "Object"
      )
    ) {
      throw new Error("The system-test RPC bridge received a non-plain object.");
    }
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" || descriptor === undefined ||
        !("value" in descriptor) || !descriptor.enumerable
      ) {
        throw new Error(
          "The system-test RPC bridge received an invalid object property.",
        );
      }
      entries.push([
        key,
        encodeSystemTestStructuredCloneBridgeValueV1(
          descriptor.value,
          ancestors,
        ),
      ]);
    }
    return ["object", entries];
  } finally {
    ancestors.delete(value);
  }
}

export function decodeSystemTestStructuredCloneBridgeValueV1(
  value: unknown,
): unknown {
  if (!Array.isArray(value) || typeof value[0] !== "string") {
    throw new Error("The system-test RPC bridge received an invalid value tag.");
  }
  const tag = value[0];
  if (tag === "undefined" && value.length === 1) return undefined;
  if (tag === "null" && value.length === 1) return null;
  if (
    tag === "boolean" && value.length === 2 &&
    typeof value[1] === "boolean"
  ) return value[1];
  if (tag === "number") {
    if (value.length === 2 && value[1] === "nan") return Number.NaN;
    if (value.length === 2 && value[1] === "positiveInfinity") {
      return Number.POSITIVE_INFINITY;
    }
    if (value.length === 2 && value[1] === "negativeInfinity") {
      return Number.NEGATIVE_INFINITY;
    }
    if (value.length === 2 && value[1] === "negativeZero") return -0;
    if (
      value.length === 3 && value[1] === "finite" &&
      typeof value[2] === "number" && Number.isFinite(value[2])
    ) return value[2];
  }
  if (
    tag === "string" && value.length === 2 &&
    typeof value[1] === "string"
  ) return value[1];
  if (
    tag === "bigint" && value.length === 2 &&
    typeof value[1] === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value[1])
  ) return BigInt(value[1]);
  if (
    tag === "uint8Array" && value.length === 2 && Array.isArray(value[1]) &&
    value[1].every((member) =>
      Number.isInteger(member) && member >= 0 && member <= 255
    )
  ) return Uint8Array.from(value[1] as number[]);
  if (
    tag === "arrayBuffer" && value.length === 2 && Array.isArray(value[1]) &&
    value[1].every((member) =>
      Number.isInteger(member) && member >= 0 && member <= 255
    )
  ) {
    return Uint8Array.from(value[1] as number[]).buffer;
  }
  if (tag === "array" && value.length === 2 && Array.isArray(value[1])) {
    return value[1].map(decodeSystemTestStructuredCloneBridgeValueV1);
  }
  if (tag === "object" && value.length === 2 && Array.isArray(value[1])) {
    const entries: [string, unknown][] = [];
    const keys = new Set<string>();
    for (const entry of value[1]) {
      if (
        !Array.isArray(entry) || entry.length !== 2 ||
        typeof entry[0] !== "string" || keys.has(entry[0])
      ) {
        throw new Error(
          "The system-test RPC bridge received an invalid object entry.",
        );
      }
      keys.add(entry[0]);
      entries.push([
        entry[0],
        decodeSystemTestStructuredCloneBridgeValueV1(entry[1]),
      ]);
    }
    return Object.fromEntries(entries);
  }
  throw new Error("The system-test RPC bridge received an invalid value.");
}
