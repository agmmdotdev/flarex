import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DECLARATIVE_V2_PARSER_PRODUCTIONS_V1,
} from "../src/declarativeV2VerifierExecutableV1.contract";
import {
  DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1,
} from "../src/declarativeV2VerifierExecutableV1";
import {
  DECLARATIVE_V2_INCREMENTAL_CANONICAL_JSON_MAXIMUM_ESCAPE_BYTES_PER_INPUT_BYTE_V1,
} from "../src/declarativeV2IncrementalCanonicalJsonV1";
import {
  DECLARATIVE_V2_VERIFICATION_EVIDENCE_PARSE_CAPACITY_BOUNDS_V2,
} from "../src/declarativeV2VerificationEvidenceV2";
import {
  DECLARATIVE_V2_CORE_DIAGNOSTICS_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_BYTE_FACTORS_V1,
  DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1,
  DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1,
} from "../src/declarativeV2VerifierV1.contract";

const GENERATED_FILE = "src/declarativeV2VerifierBoundsV1.generated.ts";
const MAX_U32 = 0xffff_ffffn;
// Keep the analysis-owned arena below half of the 128 MiB Worker isolate
// ceiling. Capability 2 still owns request concurrency and all non-arena
// host/resource admission before this private owner can be wired.
const ARENA_OPERATIONAL_BYTE_LIMIT = 64 * 1024 * 1024;
const MAXIMUM_EVIDENCE_TEXT_FIELDS =
  DECLARATIVE_V2_VERIFICATION_EVIDENCE_PARSE_CAPACITY_BOUNDS_V2
    .maximumSourceDerivedTextFieldsPerFrame;
const MAXIMUM_JSON_ESCAPE_BYTES_PER_INPUT_BYTE =
  DECLARATIVE_V2_INCREMENTAL_CANONICAL_JSON_MAXIMUM_ESCAPE_BYTES_PER_INPUT_BYTE_V1;
const MAXIMUM_EVIDENCE_FIXED_BYTES =
  DECLARATIVE_V2_VERIFICATION_EVIDENCE_PARSE_CAPACITY_BOUNDS_V2
    .maximumFixedCanonicalBytesPerFrame;
const SEMANTIC_OUTPUT_RECORDS_PER_DOMAIN_UNIT =
  DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1
    .semanticOutputRecordsPerDomainUnit;
const MAXIMUM_SEMANTIC_TRANSITIONS_PER_DOMAIN_UNIT_SQUARED =
  DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1
    .maximumSemanticTransitionsPerDomainUnitSquared;

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Unsafe generated bound.");
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, member]) =>
          `${JSON.stringify(key)}:${canonicalJson(member)}`
        )
        .join(",")
    }}`;
  }
  throw new Error("Unsupported generated bound value.");
};

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseDiagnosticPhases: ReadonlySet<string> = new Set(
  DECLARATIVE_V2_CORE_DIAGNOSTICS_V1
    .map(({ phase }) => phase)
    .filter((phase) =>
      phase === "source" ||
      phase === "lexical" ||
      phase === "parse" ||
      phase === "valueFlow"
    ),
);
const parseDiagnosticDefinitionCount = DECLARATIVE_V2_CORE_DIAGNOSTICS_V1
  .filter(({ phase }) => parseDiagnosticPhases.has(phase))
  .length;

const maximumProductionRhsLength = Math.max(
  ...DECLARATIVE_V2_PARSER_PRODUCTIONS_V1.map(({ rhsLength }) => rhsLength),
);
const epsilonProductionCount = DECLARATIVE_V2_PARSER_PRODUCTIONS_V1.filter(
  ({ rhsLength }) => rhsLength === 0,
).length;
const parserStackEntriesPerDomainUnit =
  maximumProductionRhsLength + epsilonProductionCount + 1;
const evidenceFramesPerDomainUnit =
  DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1
    .nonDiagnosticEvidenceFramesPerDomainUnit +
  parseDiagnosticDefinitionCount;

const parseCapacity = (domainByteLength: number) => {
  const domain = BigInt(domainByteLength);
  const units = domain + 1n;
  const diagnosticCount = BigInt(parseDiagnosticDefinitionCount) * units;
  const evidenceFrameCount =
    1n + BigInt(evidenceFramesPerDomainUnit) * units;
  const maximumEvidenceFrameBytes =
    BigInt(MAXIMUM_EVIDENCE_FIXED_BYTES) +
    domain *
      BigInt(
        MAXIMUM_EVIDENCE_TEXT_FIELDS *
          MAXIMUM_JSON_ESCAPE_BYTES_PER_INPUT_BYTE,
      );
  const canonicalBytes = evidenceFrameCount * maximumEvidenceFrameBytes;
  const diagnosticBytes = diagnosticCount *
    (
      BigInt(MAXIMUM_EVIDENCE_FIXED_BYTES) +
      domain * BigInt(MAXIMUM_JSON_ESCAPE_BYTES_PER_INPUT_BYTE)
    );
  const outputBytes =
    BigInt(SEMANTIC_OUTPUT_RECORDS_PER_DOMAIN_UNIT) *
    units *
    (
      BigInt(MAXIMUM_EVIDENCE_FIXED_BYTES) +
      BigInt(
          DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1
            .maximumSemanticOutputBytesPerDomainByte,
        ) *
        domain
    );
  return {
    objectBodyBytes: domain,
    tokenBytes: domain,
    stringBytes: domain,
    canonicalBytes,
    frameBytes: canonicalBytes,
    diagnosticBytes,
    outputBytes,
    tokens: units,
    parserStates: BigInt(parserStackEntriesPerDomainUnit) * units,
    nestingDepth: units,
    modules: 1n,
    importEdges: 2n * units,
    exports: units,
    functions: units,
    schemaNodes: 0n,
    validatorNodes: 0n,
    graphNodes: diagnosticCount,
    frontierEntries: units,
  } as const;
};

const arenaBytes = (domainByteLength: number): bigint => {
  const capacity = parseCapacity(domainByteLength);
  let total = BigInt(DECLARATIVE_V2_VERIFIER_SPECIFICATION_V1.arena.baseBytes);
  for (const width of DECLARATIVE_V2_VERIFIER_ARENA_WIDTHS_V1) {
    total += capacity[width.dimension] * BigInt(width.bytes);
  }
  for (const factor of DECLARATIVE_V2_VERIFIER_ARENA_BYTE_FACTORS_V1) {
    total += capacity[factor.dimension] * BigInt(factor.factor);
  }
  return total;
};

export function generateDeclarativeV2VerifierBoundsV1(): string {
  let selectedDomainByteLimit = 1;
  while (
    arenaBytes(selectedDomainByteLimit * 2) <=
      BigInt(ARENA_OPERATIONAL_BYTE_LIMIT)
  ) {
    selectedDomainByteLimit *= 2;
  }
  const nextPowerOfTwo = selectedDomainByteLimit * 2;
  const selectedArenaBytes = arenaBytes(selectedDomainByteLimit);
  const nextPowerOfTwoArenaBytes = arenaBytes(nextPowerOfTwo);
  if (
    selectedArenaBytes > BigInt(ARENA_OPERATIONAL_BYTE_LIMIT) ||
    nextPowerOfTwoArenaBytes <= BigInt(ARENA_OPERATIONAL_BYTE_LIMIT) ||
    selectedArenaBytes > MAX_U32
  ) {
    throw new Error("Selected parse domain limit lost its checked arena proof.");
  }
  const withoutIdentity = Object.freeze({
    generatorVersion: 1,
    maximumProductionRhsLength,
    epsilonProductionCount,
    parseDiagnosticPhasesPerDomainUnit: parseDiagnosticPhases.size,
    parseDiagnosticDefinitionsPerDomainUnit: parseDiagnosticDefinitionCount,
    parserStackEntriesPerDomainUnit,
    evidenceFramesPerDomainUnit,
    maximumEvidenceTextFields: MAXIMUM_EVIDENCE_TEXT_FIELDS,
    maximumJsonEscapeBytesPerInputByte:
      MAXIMUM_JSON_ESCAPE_BYTES_PER_INPUT_BYTE,
    maximumEvidenceFixedBytes: MAXIMUM_EVIDENCE_FIXED_BYTES,
    semanticOutputRecordsPerDomainUnit:
      SEMANTIC_OUTPUT_RECORDS_PER_DOMAIN_UNIT,
    maximumSemanticOutputBytesPerDomainByte:
      DECLARATIVE_V2_VERIFIER_PARSE_SEMANTIC_CAPACITY_BOUNDS_V1
        .maximumSemanticOutputBytesPerDomainByte,
    maximumSemanticTransitionsPerDomainUnitSquared:
      MAXIMUM_SEMANTIC_TRANSITIONS_PER_DOMAIN_UNIT_SQUARED,
    arenaOperationalByteLimit: ARENA_OPERATIONAL_BYTE_LIMIT,
    selectedSourceAndModulePathByteLimit: selectedDomainByteLimit,
    arenaBytesAtSelectedLimit: Number(selectedArenaBytes),
    arenaBytesAtNextPowerOfTwo: Number(nextPowerOfTwoArenaBytes),
  });
  const value = Object.freeze({
    ...withoutIdentity,
    boundsIdentity: sha256(canonicalJson(withoutIdentity)),
  });
  return [
    "/* Generated by scripts/declarativeV2VerifierBoundsV1.ts. Do not edit. */",
    `const GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_VALUE_V1 = ${
      JSON.stringify(value, null, 2)
    } as const;`,
    "export const GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1 = Object.freeze(GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_VALUE_V1);",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const path = resolve(packageRoot, GENERATED_FILE);
  const generated = generateDeclarativeV2VerifierBoundsV1();
  if (command === "update") {
    await writeFile(path, generated, "utf8");
    process.stdout.write(`updated ${GENERATED_FILE}\n`);
    return;
  }
  if (command === "check") {
    if (await readFile(path, "utf8") !== generated) {
      throw new Error(`${GENERATED_FILE} is stale.`);
    }
    process.stdout.write(`verified ${GENERATED_FILE}\n`);
    return;
  }
  throw new Error(
    "Usage: declarativeV2VerifierBoundsV1.ts <update|check>",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
