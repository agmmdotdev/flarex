import { Result } from "effect";
import {
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

// @ts-expect-error The private repository identity must stay absent from the root.
import type { FrameworkSchemaArtifactRepository as RootRepository } from
  "../src";
// @ts-expect-error The private session dependency must stay absent from the root.
import type { FrameworkSchemaArtifactControlSessionStarter as RootStarter } from
  "../src";
import * as persistenceRoot from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FrameworkSchemaArtifactControlSessionStarter } from
  "../src/frameworkSchema/artifact/controlSession";
import { FrameworkSchemaArtifactRepositoryConfigurationError } from
  "../src/frameworkSchema/artifact/errors";
import {
  hasFrameworkSchemaArtifactRepositoryComposition,
  makeFrameworkSchemaArtifactRepository,
  type FrameworkSchemaArtifactRepository,
  type FrameworkSchemaArtifactRepositoryTimeoutPolicy,
} from "../src/frameworkSchema/artifact/repository";

const DEFAULT_TIMEOUT_POLICY = Object.freeze({
  readTimeoutMilliseconds: 1_000,
  attemptTimeoutMilliseconds: 2_000,
  recoveryTimeoutMilliseconds: 3_000,
  lockTimeoutMilliseconds: 500,
} satisfies FrameworkSchemaArtifactRepositoryTimeoutPolicy);

describe("private framework schema artifact repository composition", () => {
  it("returns a typed, fresh, frozen, and opaque repository identity", () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      | "makeFrameworkSchemaArtifactRepository"
      | "hasFrameworkSchemaArtifactRepositoryComposition"
      | "FrameworkSchemaArtifactRepositoryConfigurationError"
    >;
    expectTypeOf<ReturnType<
      typeof makeFrameworkSchemaArtifactRepository
    >>().toEqualTypeOf<Result.Result<
      FrameworkSchemaArtifactRepository,
      FrameworkSchemaArtifactRepositoryConfigurationError
    >>();
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("makeFrameworkSchemaArtifactRepository" in persistenceRoot)
      .toBe(false);
    expect("hasFrameworkSchemaArtifactRepositoryComposition" in persistenceRoot)
      .toBe(false);
    expect("FrameworkSchemaArtifactRepositoryConfigurationError" in
      persistenceRoot).toBe(false);

    const controlDb = databaseIdentity();
    const first = makeRepository(controlDb);
    const second = makeRepository(controlDb);

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    const keys = Reflect.ownKeys(first);
    expect(keys).toHaveLength(1);
    expect(typeof keys[0]).toBe("symbol");
    expect(hasFrameworkSchemaArtifactRepositoryComposition(
      first,
      controlDb,
    )).toBe(true);
    expect(hasFrameworkSchemaArtifactRepositoryComposition(
      second,
      controlDb,
    )).toBe(true);
  });

  it.each([
    {
      name: "minimum values",
      policy: {
        readTimeoutMilliseconds: 1,
        attemptTimeoutMilliseconds: 1,
        recoveryTimeoutMilliseconds: 1,
        lockTimeoutMilliseconds: 1,
      },
    },
    {
      name: "maximum values",
      policy: {
        readTimeoutMilliseconds: 60_000,
        attemptTimeoutMilliseconds: 60_000,
        recoveryTimeoutMilliseconds: 60_000,
        lockTimeoutMilliseconds: 60_000,
      },
    },
    {
      name: "independent shorter read deadline",
      policy: {
        readTimeoutMilliseconds: 1,
        attemptTimeoutMilliseconds: 50_000,
        recoveryTimeoutMilliseconds: 40_000,
        lockTimeoutMilliseconds: 40_000,
      },
    },
    {
      name: "independent longer read deadline",
      policy: {
        readTimeoutMilliseconds: 60_000,
        attemptTimeoutMilliseconds: 2,
        recoveryTimeoutMilliseconds: 2,
        lockTimeoutMilliseconds: 1,
      },
    },
  ] satisfies ReadonlyArray<{
    readonly name: string;
    readonly policy: FrameworkSchemaArtifactRepositoryTimeoutPolicy;
  }>)("accepts $name", ({ policy }) => {
    const controlDb = databaseIdentity();
    const result = makeFrameworkSchemaArtifactRepository({
      controlDb,
      controlSessionStarter: controlSessionStarterIdentity(),
      ...policy,
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(hasFrameworkSchemaArtifactRepositoryComposition(
        result.success,
        controlDb,
      )).toBe(true);
    }
  });

  it("rejects every invalid timeout value with the separate configuration error", () => {
    const invalidValues = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      60_001,
    ] as const;
    const fields = [
      "readTimeoutMilliseconds",
      "attemptTimeoutMilliseconds",
      "recoveryTimeoutMilliseconds",
      "lockTimeoutMilliseconds",
    ] as const;

    for (const field of fields) {
      for (const value of invalidValues) {
        const result = makeFrameworkSchemaArtifactRepository({
          controlDb: databaseIdentity(),
          controlSessionStarter: controlSessionStarterIdentity(),
          ...DEFAULT_TIMEOUT_POLICY,
          [field]: value,
        });
        expectInvalidTimeoutPolicy(result);
      }
    }

    for (const policy of [
      {
        ...DEFAULT_TIMEOUT_POLICY,
        attemptTimeoutMilliseconds: 499,
      },
      {
        ...DEFAULT_TIMEOUT_POLICY,
        recoveryTimeoutMilliseconds: 499,
      },
    ]) {
      expectInvalidTimeoutPolicy(makeFrameworkSchemaArtifactRepository({
        controlDb: databaseIdentity(),
        controlSessionStarter: controlSessionStarterIdentity(),
        ...policy,
      }));
    }
  });

  it("validates policy before reading either retained dependency", () => {
    let databasePropertyReads = 0;
    let starterPropertyReads = 0;
    const controlDb = observedIdentity<FlarexMetadataDatabase>(() => {
      databasePropertyReads += 1;
    });
    const controlSessionStarter = observedIdentity<
      FrameworkSchemaArtifactControlSessionStarter
    >(() => {
      starterPropertyReads += 1;
    });

    const invalid = makeFrameworkSchemaArtifactRepository({
      controlDb,
      controlSessionStarter,
      ...DEFAULT_TIMEOUT_POLICY,
      lockTimeoutMilliseconds: 0,
    });
    expectInvalidTimeoutPolicy(invalid);
    expect(databasePropertyReads).toBe(0);
    expect(starterPropertyReads).toBe(0);

    const valid = makeFrameworkSchemaArtifactRepository({
      controlDb,
      controlSessionStarter,
      ...DEFAULT_TIMEOUT_POLICY,
    });
    expect(Result.isSuccess(valid)).toBe(true);
    expect(databasePropertyReads).toBe(0);
    expect(starterPropertyReads).toBe(0);
  });

  it("snapshots every timeout value exactly once before retaining state", () => {
    const reads = {
      read: 0,
      attempt: 0,
      recovery: 0,
      lock: 0,
    };
    const result = makeFrameworkSchemaArtifactRepository({
      controlDb: databaseIdentity(),
      controlSessionStarter: controlSessionStarterIdentity(),
      get readTimeoutMilliseconds() {
        reads.read += 1;
        return DEFAULT_TIMEOUT_POLICY.readTimeoutMilliseconds;
      },
      get attemptTimeoutMilliseconds() {
        reads.attempt += 1;
        return DEFAULT_TIMEOUT_POLICY.attemptTimeoutMilliseconds;
      },
      get recoveryTimeoutMilliseconds() {
        reads.recovery += 1;
        return DEFAULT_TIMEOUT_POLICY.recoveryTimeoutMilliseconds;
      },
      get lockTimeoutMilliseconds() {
        reads.lock += 1;
        return DEFAULT_TIMEOUT_POLICY.lockTimeoutMilliseconds;
      },
    });

    expect(Result.isSuccess(result)).toBe(true);
    expect(reads).toEqual({
      read: 1,
      attempt: 1,
      recovery: 1,
      lock: 1,
    });
  });

  it("accepts only authentic repository and exact control-database pairs", () => {
    const controlDb = databaseIdentity();
    const otherDb = databaseIdentity();
    const repository = makeRepository(controlDb);
    const brandKey = Reflect.ownKeys(repository)[0];
    if (typeof brandKey !== "symbol") {
      throw new Error("Expected repository symbol brand.");
    }

    let repositoryProxyPropertyReads = 0;
    const proxy = new Proxy(repository, {
      get(target, property, receiver) {
        repositoryProxyPropertyReads += 1;
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        repositoryProxyPropertyReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        repositoryProxyPropertyReads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const forgeries: readonly unknown[] = [
      controlDb,
      { drizzle: controlDb },
      { ...repository },
      Object.freeze({ [brandKey]: true }),
      structuredClone(repository),
      proxy,
      null,
      undefined,
    ];

    expect(hasFrameworkSchemaArtifactRepositoryComposition(
      repository,
      controlDb,
    )).toBe(true);
    expect(hasFrameworkSchemaArtifactRepositoryComposition(
      repository,
      otherDb,
    )).toBe(false);
    for (const forgery of forgeries) {
      expect(Reflect.apply(
        hasFrameworkSchemaArtifactRepositoryComposition,
        undefined,
        [forgery, controlDb],
      )).toBe(false);
    }
    expect(repositoryProxyPropertyReads).toBe(0);
  });

  it("keeps repository construction and session contracts package-private", async () => {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const exportTargets = Object.values(packageJson.default.exports);

    expect(exportTargets).not.toContain(
      "./src/frameworkSchema/artifact/repository.ts",
    );
    expect(exportTargets).not.toContain(
      "./src/frameworkSchema/artifact/controlSession.ts",
    );
  });
});

function makeRepository(
  controlDb: FlarexMetadataDatabase,
): FrameworkSchemaArtifactRepository {
  return Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: controlSessionStarterIdentity(),
    ...DEFAULT_TIMEOUT_POLICY,
  }));
}

function expectInvalidTimeoutPolicy(
  result: Result.Result<
    unknown,
    FrameworkSchemaArtifactRepositoryConfigurationError
  >,
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(
      FrameworkSchemaArtifactRepositoryConfigurationError,
    );
    expect(result.failure).toMatchObject({
      _tag: "FrameworkSchemaArtifactRepositoryConfigurationError",
      reason: "invalidTimeoutPolicy",
      message: "Framework schema artifact repository timeout policy is invalid",
    });
    expect(Object.hasOwn(result.failure, "cause")).toBe(false);
    expect(Object.hasOwn(result.failure, "operation")).toBe(false);
    expect(Object.hasOwn(result.failure, "retryable")).toBe(false);
  }
}

function databaseIdentity(): FlarexMetadataDatabase {
  // SAFETY: composition tests exercise only object identity and never invoke
  // database methods, so an inert frozen sentinel is the complete fixture.
  return Object.freeze({}) as unknown as FlarexMetadataDatabase;
}

function controlSessionStarterIdentity():
  FrameworkSchemaArtifactControlSessionStarter
{
  // SAFETY: executable starter authority is explicitly deferred; this test
  // slice needs only an inert identity retained by repository composition.
  return Object.freeze({}) as FrameworkSchemaArtifactControlSessionStarter;
}

function observedIdentity<Identity extends object>(
  onPropertyRead: () => void,
): Identity {
  // SAFETY: callers select only an object-identity contract and this hostile
  // proxy deliberately supplies no domain behavior beyond read observation.
  return new Proxy(Object.freeze({}), {
    get(target, property, receiver) {
      onPropertyRead();
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      onPropertyRead();
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    ownKeys(target) {
      onPropertyRead();
      return Reflect.ownKeys(target);
    },
  }) as Identity;
}
