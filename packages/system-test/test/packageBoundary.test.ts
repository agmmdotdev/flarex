import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "@typescript/typescript6";
import { defaultMigrationsFolder } from
  "@flarex/persistence-postgres/internal/system-test/defaultMigrationsFolder";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, "../..");
const SYSTEM_TEST_PACKAGE_NAME = "@flarex/system-test";
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

interface PackageManifestV1 {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly exports?: unknown;
  readonly dependencies?: Readonly<Record<string, unknown>>;
  readonly devDependencies?: Readonly<Record<string, unknown>>;
  readonly optionalDependencies?: Readonly<Record<string, unknown>>;
  readonly peerDependencies?: Readonly<Record<string, unknown>>;
}

type SourceReferenceV1 =
  | {
      readonly kind: "module";
      readonly specifier: string;
    }
  | {
      readonly kind: "path";
      readonly specifier: string;
    }
  | {
      readonly kind: "types";
      readonly specifier: string;
    };

describe("@flarex/system-test package boundary", () => {
  it("remains a private package with intentional subpath exports", async () => {
    const manifest = await readManifest(join(PACKAGE_ROOT, "package.json"));
    expect(manifest).toMatchObject({
      name: SYSTEM_TEST_PACKAGE_NAME,
      private: true,
      exports: {
        "./environment/v1": "./src/environment/standardApplicationEnvironmentV1.ts",
        "./inspection/v1": "./src/inspection/authoritativeStateV1.ts",
        "./lanes/v1": "./src/lanes/databaseLaneV1.ts",
        "./scenario/v1": "./src/scenario/standardApplicationScenarioV1.ts",
      },
    });
  });

  it("resolves the persistence-owned migration tree through its owner", async () => {
    const journal = await readFile(
      join(defaultMigrationsFolder(), "meta/_journal.json"),
      "utf8",
    );
    expect(JSON.parse(journal)).toMatchObject({ entries: expect.any(Array) });
  });

  it("is never a dependency of another workspace package", async () => {
    const packageDirectories = await workspacePackageDirectories();
    const violations: string[] = [];
    for (const directory of packageDirectories) {
      if (directory === PACKAGE_ROOT) continue;
      const manifest = await readManifest(join(directory, "package.json"));
      for (const field of DEPENDENCY_FIELDS) {
        if (manifest[field]?.[SYSTEM_TEST_PACKAGE_NAME] !== undefined) {
          violations.push(`${manifest.name ?? directory}:${field}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("is never imported by production source", async () => {
    const packageDirectories = await workspacePackageDirectories();
    const violations: string[] = [];
    for (const directory of packageDirectories) {
      if (directory === PACKAGE_ROOT) continue;
      const sourceRoot = join(directory, "src");
      for (const sourcePath of await typescriptFilesUnder(sourceRoot)) {
        if ((await readFile(sourcePath, "utf8")).includes(SYSTEM_TEST_PACKAGE_NAME)) {
          violations.push(sourcePath.slice(WORKSPACE_ROOT.length + 1));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps every relative import inside the private package", async () => {
    const violations: string[] = [];
    for (const sourcePath of await typescriptFilesUnder(PACKAGE_ROOT)) {
      const source = await readFile(sourcePath, "utf8");
      for (const { specifier } of sourceReferencesV1(sourcePath, source)) {
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(sourcePath), specifier);
        if (!isPathInsideV1(PACKAGE_ROOT, target)) {
          violations.push(
            `${sourcePath.slice(PACKAGE_ROOT.length + 1)} -> ${specifier}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("declares every external package used by its source and test closure", async () => {
    const manifest = await readManifest(join(PACKAGE_ROOT, "package.json"));
    const declared = new Set<string>([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    const violations: string[] = [];
    for (const sourcePath of await typescriptFilesUnder(PACKAGE_ROOT)) {
      const source = await readFile(sourcePath, "utf8");
      for (const reference of sourceReferencesV1(sourcePath, source)) {
        const { specifier } = reference;
        if (
          specifier.startsWith(".") ||
          specifier.startsWith("node:") ||
          specifier.startsWith("flarex:") ||
          specifier === SYSTEM_TEST_PACKAGE_NAME ||
          specifier.startsWith(`${SYSTEM_TEST_PACKAGE_NAME}/`)
        ) continue;
        const packageNames = declaredPackageCandidatesV1(reference);
        if (!packageNames.some(packageName => declared.has(packageName))) {
          violations.push(
            `${sourcePath.slice(PACKAGE_ROOT.length + 1)} -> ${packageNames[0]}`,
          );
        }
      }
    }
    expect([...new Set(violations)].sort()).toEqual([]);
  });

  it.each([
    ["side-effect import", 'import "undeclared-side-effect";', "undeclared-side-effect"],
    ["export declaration", 'export * from "undeclared-export";', "undeclared-export"],
    ["dynamic import", 'void import("undeclared-dynamic");', "undeclared-dynamic"],
    ["CommonJS require", 'require("undeclared-require");', "undeclared-require"],
    [
      "import-equals declaration",
      'import dependency = require("undeclared-import-equals");',
      "undeclared-import-equals",
    ],
    [
      "triple-slash type reference",
      '/// <reference types="undeclared-types" />',
      "undeclared-types",
    ],
    [
      "triple-slash path reference",
      '/// <reference path="../../../outside.ts" />',
      "../../../outside.ts",
    ],
  ])("discovers %s syntax", (_name, source, expectedSpecifier) => {
    expect(
      sourceReferencesV1("boundary-fixture.ts", source).map(
        reference => reference.specifier,
      ),
    ).toContain(expectedSpecifier);
  });
});

function sourceReferencesV1(
  sourcePath: string,
  source: string,
): readonly SourceReferenceV1[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindV1(sourcePath),
  );
  const references: SourceReferenceV1[] = [
    ...sourceFile.referencedFiles.map(({ fileName: specifier }) => ({
      kind: "path" as const,
      specifier,
    })),
    ...sourceFile.typeReferenceDirectives.map(({ fileName: specifier }) => ({
      kind: "types" as const,
      specifier,
    })),
  ];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        kind: "module",
        specifier: node.moduleSpecifier.text,
      });
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression !== undefined && ts.isStringLiteralLike(expression)) {
        references.push({ kind: "module", specifier: expression.text });
      }
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        references.push({ kind: "module", specifier: argument.text });
      }
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({
        kind: "module",
        specifier: node.argument.literal.text,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return references;
}

function packageNameV1(specifier: string): string {
  const segments = specifier.split("/");
  const first = segments[0] ?? specifier;
  const second = segments[1];
  return specifier.startsWith("@") && second !== undefined
    ? `${first}/${second}`
    : first;
}

function declaredPackageCandidatesV1(
  reference: SourceReferenceV1,
): readonly string[] {
  const packageName = packageNameV1(reference.specifier);
  return reference.kind === "types" && !packageName.startsWith("@")
    ? [packageName, `@types/${packageName}`]
    : [packageName];
}

function isPathInsideV1(root: string, target: string): boolean {
  const relativeTarget = relative(root, target);
  return relativeTarget === "" ||
    (!isAbsolute(relativeTarget) &&
      relativeTarget !== ".." &&
      !relativeTarget.startsWith(`..${sep}`));
}

function scriptKindV1(sourcePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(sourcePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function workspacePackageDirectories(): Promise<readonly string[]> {
  const roots = [join(WORKSPACE_ROOT, "packages"), join(WORKSPACE_ROOT, "apps")];
  const directories: string[] = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(root, entry.name));
    }
  }
  return directories;
}

async function readManifest(path: string): Promise<PackageManifestV1> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifestV1;
}

async function typescriptFilesUnder(root: string): Promise<readonly string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (cause: unknown) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return [];
    }
    throw cause;
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await typescriptFilesUnder(path));
    } else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths;
}
