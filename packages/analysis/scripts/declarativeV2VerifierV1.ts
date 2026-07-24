import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1,
  DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1,
  DECLARATIVE_V2_CORE_DIAGNOSTICS_V1,
  DECLARATIVE_V2_CORE_FAILURE_CLASSES_V1,
  DECLARATIVE_V2_CORE_GRAMMAR_RULES_V1,
  DECLARATIVE_V2_CORE_LEXICAL_RULES_V1,
  DECLARATIVE_V2_CORE_OPERATOR_RULES_V1,
  DECLARATIVE_V2_CORE_OPERATIONAL_RULES_V1,
  DECLARATIVE_V2_CORE_VALUE_CLASSES_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1,
  DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1,
  DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
} from "../src/declarativeV2VerifierV1.contract";

const UTF8_ENCODER = new TextEncoder();
const GENERATOR_VERSION = "1" as const;
const GENERATED_FILE = "src/declarativeV2VerifierV1.generated.ts";
const SPEC_FILE = "src/declarativeV2VerifierV1.contract.ts";
const GENERATOR_FILE = "scripts/declarativeV2VerifierV1.ts";
const PROVENANCE_FILE = "vendor/unicode-14.0.0/PROVENANCE.json";
const DCP_FILE = "vendor/unicode-14.0.0/DerivedCoreProperties.txt";
const README_FILE = "vendor/unicode-14.0.0/ReadMe.txt";
const LICENSE_FILE = "vendor/unicode-14.0.0/LICENSE.txt";

interface UnicodeRange {
  readonly start: number;
  readonly end: number;
}

interface AssetSection {
  readonly id: number;
  readonly recordBytes: number;
  readonly count: number;
  readonly bytes: Uint8Array;
}

export interface DeclarativeV2VerifierGeneratedManifestV1 {
  readonly formatVersion: 1;
  readonly generatorVersion: "1";
  readonly assetSha256: string;
  readonly assetByteLength: number;
  readonly specificationSha256: string;
  readonly specificationSourceSha256: string;
  readonly generatorSourceSha256: string;
  readonly unicodeBehaviorSha256: string;
  readonly unicodeInputs: Readonly<{
    readonly derivedCorePropertiesSha256: string;
    readonly readMeSha256: string;
    readonly licenseSha256: string;
    readonly provenanceSha256: string;
  }>;
  readonly toolchain: Readonly<{
    readonly typescriptDeclared: string;
    readonly typescriptResolved: string;
    readonly tsxDeclared: string;
    readonly tsxResolved: string;
  }>;
  readonly sectionCount: number;
  readonly manifestIdentity: string;
}

export interface GeneratedDeclarativeV2VerifierV1 {
  readonly asset: Uint8Array;
  readonly manifest: DeclarativeV2VerifierGeneratedManifestV1;
  readonly source: string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Generator canonical JSON rejects non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error("Generator canonical JSON received an unsupported value.");
}

function align(value: number, alignment: number): number {
  const remainder = value % alignment;
  return remainder === 0 ? value : value + alignment - remainder;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength)
    .setUint32(offset, value, false);
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("Expected a SHA-256 lowerhex value.");
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  );
}

function assertStableIds(
  name: string,
  rows: ReadonlyArray<Readonly<{ id: number }>>,
): void {
  const observed = new Set<number>();
  for (let index = 0; index < rows.length; index += 1) {
    const id = rows[index]?.id;
    if (!Number.isSafeInteger(id) || id !== index + 1 || observed.has(id)) {
      throw new Error(`${name} must use unique contiguous stable numeric IDs.`);
    }
    observed.add(id);
  }
}

function parseUnicodeRanges(
  text: string,
  property: "ID_Start" | "ID_Continue",
): ReadonlyArray<UnicodeRange> {
  const ranges: UnicodeRange[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const withoutComment = line.split("#", 1)[0]?.trim() ?? "";
    if (withoutComment.length === 0) continue;
    const match = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*(ID_Start|ID_Continue)\s*$/u.exec(
      withoutComment,
    );
    if (match === null || match[3] !== property) continue;
    const start = Number.parseInt(match[1]!, 16);
    const end = Number.parseInt(match[2] ?? match[1]!, 16);
    const previous = ranges.at(-1);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      end > 0x10ffff ||
      (previous !== undefined && start <= previous.end)
    ) {
      throw new Error(`Unicode ${property} ranges are malformed or overlap.`);
    }
    ranges.push(Object.freeze({ start, end }));
  }
  if (ranges.length === 0) throw new Error(`Unicode ${property} ranges are missing.`);
  return Object.freeze(ranges);
}

function encodeRanges(ranges: ReadonlyArray<UnicodeRange>): Uint8Array {
  const bytes = new Uint8Array(ranges.length * 8);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    writeU32(bytes, index * 8, range.start);
    writeU32(bytes, index * 8 + 4, range.end);
  }
  return bytes;
}

function encodeHashedRows(
  rows: ReadonlyArray<Readonly<{ id: number }>>,
  recordBytes: number,
): Uint8Array {
  if (recordBytes < 8) throw new Error("Fixed row width is too small.");
  const bytes = new Uint8Array(rows.length * recordBytes);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const offset = index * recordBytes;
    writeU32(bytes, offset, row.id);
    const digest = hexToBytes(sha256(canonicalJson(row)));
    bytes.set(digest.subarray(0, recordBytes - 4), offset + 4);
  }
  return bytes;
}

function requireCatalogVersion(workspaceText: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^\\s*"${escaped}":\\s*"([^"]+)"\\s*$`, "mu").exec(
    workspaceText,
  );
  if (match === null) throw new Error(`Missing pinned catalog entry for ${name}.`);
  return match[1]!;
}

function requireAnalysisImporterVersion(lockText: string, name: string): string {
  const importer = /(?:^|\n)  packages\/analysis:\r?\n([\s\S]*?)(?=\r?\n  [^\s])/u
    .exec(lockText)?.[1];
  if (importer === undefined) {
    throw new Error("Missing packages/analysis lockfile importer.");
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `^      ${escaped}:\\r?\\n        specifier:.*\\r?\\n        version: ([^\\s]+)\\s*$`,
    "mu",
  ).exec(importer);
  if (match === null || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(match[1]!)) {
    throw new Error(`Missing exact packages/analysis lockfile version for ${name}.`);
  }
  return match[1]!;
}

function buildAsset(
  sections: ReadonlyArray<AssetSection>,
  specificationSha256: string,
  unicodeBehaviorSha256: string,
): Uint8Array {
  const tableEnd = DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 +
    sections.length * DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1;
  let cursor = align(tableEnd, DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1);
  const placements = sections.map((section) => {
    const offset = cursor;
    cursor = align(
      cursor + section.bytes.byteLength,
      DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1,
    );
    return Object.freeze({ ...section, offset });
  });
  const asset = new Uint8Array(cursor);
  asset.set(UTF8_ENCODER.encode(DECLARATIVE_V2_VERIFIER_ASSET_MAGIC_V1), 0);
  writeU32(asset, 8, DECLARATIVE_V2_VERIFIER_ASSET_FORMAT_VERSION_V1);
  writeU32(asset, 12, DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1);
  writeU32(asset, 16, sections.length);
  writeU32(asset, 20, DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1);
  writeU32(asset, 24, DECLARATIVE_V2_VERIFIER_ASSET_ALIGNMENT_V1);
  asset.set(hexToBytes(specificationSha256), 32);
  asset.set(hexToBytes(unicodeBehaviorSha256), 64);
  for (let index = 0; index < placements.length; index += 1) {
    const section = placements[index]!;
    const entry = DECLARATIVE_V2_VERIFIER_ASSET_HEADER_BYTES_V1 +
      index * DECLARATIVE_V2_VERIFIER_ASSET_SECTION_ENTRY_BYTES_V1;
    writeU32(asset, entry, section.id);
    writeU32(asset, entry + 4, section.recordBytes);
    writeU32(asset, entry + 8, section.offset);
    writeU32(asset, entry + 12, section.bytes.byteLength);
    writeU32(asset, entry + 16, section.count);
    writeU32(asset, entry + 20, 0);
    asset.set(section.bytes, section.offset);
  }
  return asset;
}

export async function generateDeclarativeV2VerifierV1(
  packageRoot: string,
): Promise<GeneratedDeclarativeV2VerifierV1> {
  const [
    specificationSource,
    generatorSource,
    dcp,
    readMe,
    license,
    provenance,
    workspace,
    lockfile,
  ] = await Promise.all([
    readFile(resolve(packageRoot, SPEC_FILE)),
    readFile(resolve(packageRoot, GENERATOR_FILE)),
    readFile(resolve(packageRoot, DCP_FILE)),
    readFile(resolve(packageRoot, README_FILE)),
    readFile(resolve(packageRoot, LICENSE_FILE)),
    readFile(resolve(packageRoot, PROVENANCE_FILE)),
    readFile(resolve(packageRoot, "../../pnpm-workspace.yaml"), "utf8"),
    readFile(resolve(packageRoot, "../../pnpm-lock.yaml"), "utf8"),
  ]);
  const provenanceValue = JSON.parse(provenance.toString("utf8")) as unknown;
  if (canonicalJson(provenanceValue) !== provenance.toString("utf8").trim()) {
    throw new Error("Unicode provenance must be canonical JSON.");
  }
  if (
    (provenanceValue as { readonly license?: unknown }).license !==
      "Unicode License V3" ||
    !license.toString("utf8").startsWith("UNICODE LICENSE V3\n")
  ) {
    throw new Error("Unicode provenance license identity does not match the vendored text.");
  }
  const expectedInputHashes = [
    sha256(dcp),
    sha256(readMe),
    sha256(license),
  ];
  const provenanceInputs = (provenanceValue as {
    readonly inputs?: ReadonlyArray<{ readonly sha256?: unknown }>;
  }).inputs;
  if (
    !Array.isArray(provenanceInputs) ||
    expectedInputHashes.some((hash, index) => provenanceInputs[index]?.sha256 !== hash)
  ) {
    throw new Error("Unicode provenance hashes do not match the vendored bytes.");
  }

  const tableSets = [
    ["lexicalRules", DECLARATIVE_V2_CORE_LEXICAL_RULES_V1],
    ["grammarRules", DECLARATIVE_V2_CORE_GRAMMAR_RULES_V1],
    ["valueClasses", DECLARATIVE_V2_CORE_VALUE_CLASSES_V1],
    ["operatorRules", DECLARATIVE_V2_CORE_OPERATOR_RULES_V1],
    ["operationalRules", DECLARATIVE_V2_CORE_OPERATIONAL_RULES_V1],
    ["capabilityMatrix", DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1],
    ["abiOperations", DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1],
    ["diagnostics", DECLARATIVE_V2_CORE_DIAGNOSTICS_V1],
    ["failureClasses", DECLARATIVE_V2_CORE_FAILURE_CLASSES_V1],
    ["arenaWidths", DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1],
  ] as const;
  for (const [name, rows] of tableSets) assertStableIds(name, rows);
  assertStableIds("assetSections", DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1);

  const canonicalSpecification = canonicalJson({
    generatorVersion: GENERATOR_VERSION,
    specification: DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
    unicodeProvenance: provenanceValue,
  });
  const specificationSha256 = sha256(canonicalSpecification);
  const unicodeBehaviorSha256 = sha256(
    new Uint8Array([...dcp, ...readMe]),
  );
  const idStart = parseUnicodeRanges(dcp.toString("utf8"), "ID_Start");
  const idContinue = parseUnicodeRanges(dcp.toString("utf8"), "ID_Continue");
  const textRows = tableSets.flatMap(([, rows]) => rows.map((row) => canonicalJson(row)));
  const stringPool = UTF8_ENCODER.encode(textRows.join("\0"));
  const sectionData = new Map<string, Uint8Array>([
    ["unicodeIdStart", encodeRanges(idStart)],
    ["unicodeIdContinue", encodeRanges(idContinue)],
    ["lexicalRules", encodeHashedRows(DECLARATIVE_V2_CORE_LEXICAL_RULES_V1, 24)],
    ["grammarRules", encodeHashedRows(DECLARATIVE_V2_CORE_GRAMMAR_RULES_V1, 24)],
    ["valueClasses", encodeHashedRows(DECLARATIVE_V2_CORE_VALUE_CLASSES_V1, 24)],
    ["operatorRules", encodeHashedRows(DECLARATIVE_V2_CORE_OPERATOR_RULES_V1, 24)],
    ["operationalRules", encodeHashedRows(DECLARATIVE_V2_CORE_OPERATIONAL_RULES_V1, 24)],
    ["capabilityMatrix", encodeHashedRows(DECLARATIVE_V2_CORE_CAPABILITY_MATRIX_V1, 24)],
    ["abiOperations", encodeHashedRows(DECLARATIVE_V2_CORE_ABI_OPERATIONS_V1, 32)],
    ["diagnostics", encodeHashedRows(DECLARATIVE_V2_CORE_DIAGNOSTICS_V1, 28)],
    ["failureClasses", encodeHashedRows(DECLARATIVE_V2_CORE_FAILURE_CLASSES_V1, 24)],
    ["arenaWidths", encodeHashedRows(DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1, 20)],
    ["stringPool", stringPool],
    ["canonicalSpecification", UTF8_ENCODER.encode(canonicalSpecification)],
  ]);
  const sections = DECLARATIVE_V2_VERIFIER_ASSET_SECTIONS_V1.map((definition) => {
    const bytes = sectionData.get(definition.name);
    if (bytes === undefined || bytes.byteLength % definition.recordBytes !== 0) {
      throw new Error(`Asset section ${definition.name} has an invalid fixed-width representation.`);
    }
    return Object.freeze({
      id: definition.id,
      recordBytes: definition.recordBytes,
      count: bytes.byteLength / definition.recordBytes,
      bytes,
    });
  });
  const asset = buildAsset(sections, specificationSha256, unicodeBehaviorSha256);
  const unicodeInputs = Object.freeze({
    derivedCorePropertiesSha256: expectedInputHashes[0]!,
    readMeSha256: expectedInputHashes[1]!,
    licenseSha256: expectedInputHashes[2]!,
    provenanceSha256: sha256(provenance),
  });
  const toolchain = Object.freeze({
    typescriptDeclared: requireCatalogVersion(workspace, "typescript"),
    typescriptResolved: requireAnalysisImporterVersion(lockfile, "typescript"),
    tsxDeclared: requireCatalogVersion(workspace, "tsx"),
    tsxResolved: requireAnalysisImporterVersion(lockfile, "tsx"),
  });
  const manifestWithoutIdentity = Object.freeze({
    formatVersion: 1 as const,
    generatorVersion: GENERATOR_VERSION,
    assetSha256: sha256(asset),
    assetByteLength: asset.byteLength,
    specificationSha256,
    specificationSourceSha256: sha256(specificationSource),
    generatorSourceSha256: sha256(generatorSource),
    unicodeBehaviorSha256,
    unicodeInputs,
    toolchain,
    sectionCount: sections.length,
  });
  const manifest = Object.freeze({
    ...manifestWithoutIdentity,
    manifestIdentity: sha256(canonicalJson(manifestWithoutIdentity)),
  });
  const source = [
    "/* Generated by scripts/declarativeV2VerifierV1.ts. Do not edit. */",
    `const GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_VALUE_V1 = ${JSON.stringify(manifest, null, 2)} as const;`,
    "Object.freeze(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_VALUE_V1.unicodeInputs);",
    "Object.freeze(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_VALUE_V1.toolchain);",
    "export const GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_V1 = Object.freeze(GENERATED_DECLARATIVE_V2_VERIFIER_MANIFEST_VALUE_V1);",
    `export const GENERATED_DECLARATIVE_V2_VERIFIER_ASSET_BASE64_V1 = ${JSON.stringify(Buffer.from(asset).toString("base64"))} as const;`,
    "",
  ].join("\n");
  return Object.freeze({ asset: new Uint8Array(asset), manifest, source });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "update" && command !== "check") {
    throw new Error("Usage: declarativeV2VerifierV1.ts <update|check>");
  }
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const first = await generateDeclarativeV2VerifierV1(packageRoot);
  const second = await generateDeclarativeV2VerifierV1(packageRoot);
  if (
    first.source !== second.source ||
    !Buffer.from(first.asset).equals(Buffer.from(second.asset))
  ) {
    throw new Error("Two clean Declarative V2 verifier generations diverged.");
  }
  const generatedPath = resolve(packageRoot, GENERATED_FILE);
  if (command === "update") {
    await writeFile(generatedPath, first.source, "utf8");
    process.stdout.write(
      `updated ${GENERATED_FILE} ${first.manifest.assetSha256} ${first.manifest.assetByteLength}\n`,
    );
    return;
  }
  const current = await readFile(generatedPath, "utf8");
  if (current !== first.source) {
    throw new Error("Declarative V2 verifier generated asset is stale.");
  }
  process.stdout.write(
    `verified ${GENERATED_FILE} ${first.manifest.assetSha256} ${first.manifest.assetByteLength}\n`,
  );
}

if (process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
