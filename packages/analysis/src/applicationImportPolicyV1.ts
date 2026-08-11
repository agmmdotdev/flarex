export const APPLICATION_IMPORT_FIXED_UNIX_TIME_MILLISECONDS_V1 =
  1_700_000_000_000;
export const APPLICATION_IMPORT_POLICY_IDENTITY_V1 =
  "flarex.application-import-policy/v1" as const;

const ARRAY_FROM = Array.from;
const DATE = Date;
const MATH_IMUL = Math.imul;
const OBJECT_CREATE = Object.create;
const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_SET_PROTOTYPE_OF = Object.setPrototypeOf;
const REFLECT_CONSTRUCT = Reflect.construct;
const REFLECT_DELETE_PROPERTY = Reflect.deleteProperty;
const REFLECT_GET = Reflect.get;

export class ApplicationImportForbiddenEffectV1 extends Error {
  readonly _tag = "ApplicationImportForbiddenEffectV1";
}

export interface InstalledApplicationImportPolicyV1 {
  readonly forbiddenAttempted: () => boolean;
  readonly restore: () => void;
}

export interface ApplicationImportPolicyV1Options {
  readonly onForbidden?: (operation: string) => void;
}

/** Installs the shared deterministic, sticky import-time admission policy. */
export function installApplicationImportPolicyV1(
  options: ApplicationImportPolicyV1Options = {},
): InstalledApplicationImportPolicyV1 {
  const restorers: Array<() => void> = [];
  let forbiddenAttempted = false;
  const reject = (operation: string): never => {
    forbiddenAttempted = true;
    options.onForbidden?.(operation);
    throw new ApplicationImportForbiddenEffectV1();
  };
  try {
    function ApplicationImportDate(
      ...args: ReadonlyArray<unknown>
    ): string | Date {
      if (new.target === undefined) {
        return new DATE(
          APPLICATION_IMPORT_FIXED_UNIX_TIME_MILLISECONDS_V1,
        ).toString();
      }
      return REFLECT_CONSTRUCT(
        DATE,
        args.length === 0
          ? [APPLICATION_IMPORT_FIXED_UNIX_TIME_MILLISECONDS_V1]
          : ARRAY_FROM(args),
        new.target,
      );
    }
    OBJECT_SET_PROTOTYPE_OF(ApplicationImportDate, DATE);
    const datePrototype = OBJECT_CREATE(DATE.prototype);
    OBJECT_DEFINE_PROPERTY(datePrototype, "constructor", {
      configurable: true,
      writable: true,
      value: ApplicationImportDate,
    });
    OBJECT_DEFINE_PROPERTY(ApplicationImportDate, "prototype", {
      value: datePrototype,
    });
    OBJECT_DEFINE_PROPERTY(ApplicationImportDate, "now", {
      configurable: true,
      value: () => APPLICATION_IMPORT_FIXED_UNIX_TIME_MILLISECONDS_V1,
    });
    installValue(restorers, globalThis, "Date", ApplicationImportDate);
    let seed = 0x5eed1234;
    installValue(restorers, Math, "random", () => {
      seed = (MATH_IMUL(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    });
    installValue(restorers, globalThis, "fetch", () => reject("fetch"));
    installRejectedGlobalObject(restorers, reject, "crypto");
    installDeterministicPerformance(restorers, reject);
    installValue(
      restorers,
      globalThis,
      "setTimeout",
      () => reject("setTimeout"),
    );
    installValue(
      restorers,
      globalThis,
      "setInterval",
      () => reject("setInterval"),
    );
    if ("scheduler" in globalThis) {
      installRejectedGlobalObject(restorers, reject, "scheduler");
    }
  } catch (cause) {
    restoreInReverse(restorers);
    throw cause;
  }
  return OBJECT_FREEZE({
    forbiddenAttempted: () => forbiddenAttempted,
    restore: once(() => restoreInReverse(restorers)),
  });
}

function installDeterministicPerformance(
  restorers: Array<() => void>,
  reject: (operation: string) => never,
): void {
  const deterministic = new Proxy(OBJECT_FREEZE({
    now: () => 0,
    timeOrigin: APPLICATION_IMPORT_FIXED_UNIX_TIME_MILLISECONDS_V1,
  }), {
    get: (target, property, receiver) => {
      if (property === "now" || property === "timeOrigin") {
        return REFLECT_GET(target, property, receiver);
      }
      return reject(`performance.${String(property)}`);
    },
  });
  installValue(restorers, globalThis, "performance", deterministic);
}

function installRejectedGlobalObject(
  restorers: Array<() => void>,
  reject: (operation: string) => never,
  key: "crypto" | "scheduler",
): void {
  const denied = new Proxy(OBJECT_FREEZE({}), {
    get: (_target, property) => reject(`${key}.${String(property)}`),
  });
  installValue(restorers, globalThis, key, denied);
}

function installValue(
  restorers: Array<() => void>,
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(target, key);
  OBJECT_DEFINE_PROPERTY(target, key, {
    configurable: true,
    writable: true,
    value,
  });
  restorers.push(() => {
    if (descriptor === undefined) {
      REFLECT_DELETE_PROPERTY(target, key);
    } else {
      OBJECT_DEFINE_PROPERTY(target, key, descriptor);
    }
  });
}

function restoreInReverse(restorers: ReadonlyArray<() => void>): void {
  for (let index = restorers.length - 1; index >= 0; index -= 1) {
    restorers[index]?.();
  }
}

function once(operation: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    operation();
  };
}
