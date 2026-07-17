import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertExecutionArtifactRefMatchesSourcePackage,
  cloneArtifactSourcePackage,
  executionArtifactManifestKey,
  executionArtifactRefForSourcePackage,
  executionArtifactRefsEqual,
  executionArtifactSourcePackageKey,
  stableSourcePackageManifest,
  validateExecutionArtifactRef,
  validateStoredExecutionArtifactManifest,
  type ArtifactSourcePackage,
  type MaterializedArtifactSourcePackage,
  type StoredExecutionArtifactManifest,
} from "../src/artifacts";

describe("execution artifact refs", () => {
  it("derives stable refs from the source package manifest", async () => {
    const first = sourcePackage();
    const reordered = {
      ...first,
      modules: [...first.modules].reverse(),
      functions: [...first.functions].reverse(),
    };

    await expect(executionArtifactRefForSourcePackage(reordered)).resolves.toEqual(
      await executionArtifactRefForSourcePackage(first),
    );
    expect(stableSourcePackageManifest(reordered)).toBe(stableSourcePackageManifest(first));
  });

  it("changes refs when a module hash changes", async () => {
    const first = await executionArtifactRefForSourcePackage(sourcePackage("a".repeat(64)));
    const second = await executionArtifactRefForSourcePackage(sourcePackage("b".repeat(64)));

    expect(second).not.toEqual(first);
    expect(second).toMatchObject({
      runtime: "dynamic-worker",
      artifactId: expect.stringMatching(/^artifact_[a-f0-9]{32}$/),
      sourcePackageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      executionModule: "_flarex/execution.js",
    });
  });

  it("changes refs when auth config changes", async () => {
    const first = await executionArtifactRefForSourcePackage(sourcePackageWithAuth("app-a"));
    const second = await executionArtifactRefForSourcePackage(sourcePackageWithAuth("app-b"));

    expect(second).not.toEqual(first);
    expect(second.executionModule).toBe(first.executionModule);
  });

  it("canonicalizes auth config object key order in stable manifests", () => {
    const first = sourcePackageWithAuth("app-a");
    const reordered: ArtifactSourcePackage = {
      ...first,
      authConfig: {
        providers: [{
          applicationID: "app-a",
          domain: "https://auth.example.com",
        }],
      },
    };

    expect(stableSourcePackageManifest(reordered)).toBe(stableSourcePackageManifest(first));
  });

  it("orders module and function names by UTF-16 code units", () => {
    const manifest: unknown = JSON.parse(stableSourcePackageManifest({
      ...sourcePackage(),
      modules: [
        { path: "\uE000.js", environment: "isolate", sha256: "3".repeat(64) },
        { path: "😀.js", environment: "isolate", sha256: "4".repeat(64) },
      ],
      functions: ["\uE000.js", "😀.js"],
    }));

    expect(manifest).toMatchObject({
      modules: [{ path: "😀.js" }, { path: "\uE000.js" }],
      functions: ["😀.js", "\uE000.js"],
    });
  });

  it("compares execution artifact ref fields that can differ between typed refs", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());

    expect(executionArtifactRefsEqual(ref, { ...ref })).toBe(true);
    expect(
      executionArtifactRefsEqual(ref, {
        ...ref,
        artifactId: "artifact_ffffffffffffffffffffffffffffffff",
      }),
    ).toBe(false);
    expect(
      executionArtifactRefsEqual(ref, {
        ...ref,
        executionModule: "_flarex/other-execution.js",
      }),
    ).toBe(false);
    expect(
      executionArtifactRefsEqual(ref, {
        ...ref,
        sourcePackageHash: "f".repeat(64),
      }),
    ).toBe(false);
  });

  it("asserts refs against the source package that produced them", async () => {
    const package_ = sourcePackage();
    const ref = await executionArtifactRefForSourcePackage(package_);

    await expect(
      assertExecutionArtifactRefMatchesSourcePackage(ref, package_),
    ).resolves.toBeUndefined();
    await expect(
      assertExecutionArtifactRefMatchesSourcePackage(
        {
          ...ref,
          executionModule: "_flarex/other-execution.js",
        },
        package_,
      ),
    ).rejects.toThrow(`Execution artifact ref does not match source package: ${ref.artifactId}`);
  });

  it("validates stored artifact refs from unknown input", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());

    expect(validateExecutionArtifactRef(ref)).toEqual(ref);
    expect(() => validateExecutionArtifactRef([])).toThrow(
      "Stored execution artifact reference is invalid.",
    );
  });
});

describe("execution artifact storage contracts", () => {
  it("derives the manifest and source-package object keys", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());

    expect(executionArtifactManifestKey(ref)).toBe(
      `artifacts/${ref.artifactId}/manifest.json`,
    );
    expect(executionArtifactSourcePackageKey(ref)).toBe(
      `artifacts/${ref.artifactId}/source-package.json`,
    );
  });

  it("validates the stored manifest version, path, and exact ref", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());
    const manifest: unknown = {
      version: 1,
      ref,
      sourcePackagePath: executionArtifactSourcePackageKey(ref),
    };

    validateStoredExecutionArtifactManifest(ref, manifest);
    expectTypeOf(manifest).toEqualTypeOf<StoredExecutionArtifactManifest>();
    expect(() =>
      validateStoredExecutionArtifactManifest(ref, {
        version: 2,
        ref,
        sourcePackagePath: executionArtifactSourcePackageKey(ref),
      })
    ).toThrow(
      `Unsupported execution artifact manifest version for ${ref.artifactId}.`,
    );
    expect(() =>
      validateStoredExecutionArtifactManifest(ref, {
        version: 1,
        ref,
        sourcePackagePath: "artifacts/other/source-package.json",
      })
    ).toThrow(
      `Execution artifact manifest path mismatch for ${ref.artifactId}.`,
    );
    expect(() =>
      validateStoredExecutionArtifactManifest(ref, {
        version: 1,
        ref: { ...ref, sourcePackageHash: "f".repeat(64) },
        sourcePackagePath: executionArtifactSourcePackageKey(ref),
      })
    ).toThrow(
      `Execution artifact manifest ref mismatch for ${ref.artifactId}.`,
    );
    expect(() =>
      validateStoredExecutionArtifactManifest(ref, null)
    ).toThrow(
      `Stored execution artifact manifest is invalid for ${ref.artifactId}.`,
    );
    expect(() =>
      validateStoredExecutionArtifactManifest(ref, {
        version: 1,
        sourcePackagePath: executionArtifactSourcePackageKey(ref),
      })
    ).toThrow(
      `Execution artifact manifest ref mismatch for ${ref.artifactId}.`,
    );
  });

  it("clones only source-package fields while preserving module details", () => {
    const package_: MaterializedArtifactSourcePackage & {
      ignoredMetadata: string;
    } = {
      ...sourcePackageWithAuth("app-a"),
      modules: sourcePackageWithAuth("app-a").modules.map((module) => ({
        ...module,
        source: `// ${module.path}`,
      })),
      ignoredMetadata: "not persisted",
    };

    const cloned = cloneArtifactSourcePackage(package_);

    expect(cloned).toEqual({
      modules: package_.modules,
      functions: package_.functions,
      schema: package_.schema,
      authConfig: package_.authConfig,
      authConfigModule: package_.authConfigModule,
      execution: package_.execution,
    });
    expect(Object.hasOwn(cloned, "ignoredMetadata")).toBe(false);
    expect(cloned.modules).not.toBe(package_.modules);
    expect(cloned.modules[0]).not.toBe(package_.modules[0]);
    expect(cloned.functions).not.toBe(package_.functions);
    expect(cloned.authConfig).not.toBe(package_.authConfig);
    expect(cloned.authConfig?.providers).not.toBe(
      package_.authConfig?.providers,
    );
  });

  it("keeps absent optional source-package fields absent", () => {
    const cloned = cloneArtifactSourcePackage(sourcePackage());

    expect(Object.hasOwn(cloned, "authConfig")).toBe(false);
    expect(Object.hasOwn(cloned, "authConfigModule")).toBe(false);
  });
});

function sourcePackage(functionHash = "a".repeat(64)): ArtifactSourcePackage {
  return {
    modules: [
      { path: "_flarex/execution.js", environment: "isolate", sha256: "0".repeat(64) },
      { path: "_flarex/schema.js", environment: "isolate", sha256: "1".repeat(64) },
      { path: "lessons.js", environment: "isolate", sha256: functionHash },
    ],
    functions: ["lessons.js"],
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}

function sourcePackageWithAuth(applicationID: string): ArtifactSourcePackage {
  return {
    ...sourcePackage(),
    modules: [
      ...sourcePackage().modules,
      { path: "_flarex/auth.config.js", environment: "isolate", sha256: "2".repeat(64) },
    ],
    authConfigModule: "_flarex/auth.config.js",
    authConfig: {
      providers: [{
        domain: "https://auth.example.com",
        applicationID,
      }],
    },
  };
}
