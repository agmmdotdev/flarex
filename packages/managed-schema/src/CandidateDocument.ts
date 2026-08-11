import { Result } from "effect";
import { requireAppDocumentIdentityV1ForTableResult } from
  "flarex-protocol/app-document-id";
import {
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_VALIDATOR_PATH_BYTES_V1,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
import type {
  CatalogTableId,
} from "flarex-protocol/catalog";
import type {
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  validateValidatorValueV1,
  type ValidatorIdPolicyV1,
} from "flarex-protocol/validator-engine";
import type {
  CanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";

const TEXT_ENCODER = new TextEncoder();

export interface CandidateDocumentValidationInput {
  readonly candidateManifest: SchemaManifestAppSchemaV1;
  readonly tableId: CatalogTableId;
  readonly developerFields: CanonicalFlarexRuntimeObjectV1;
}

export type CandidateDocumentValidationResult =
  | Readonly<{ readonly status: "valid" }>
  | Readonly<{
      readonly status: "invalid";
      readonly reason: "candidateTableRemoved";
      readonly validatorPath: null;
    }>
  | Readonly<{
      readonly status: "invalid";
      readonly reason: "candidateValidatorRejected";
      readonly validatorPath: string;
    }>;

export interface CandidateDocumentValidator {
  readonly hasTable: (tableId: CatalogTableId) => boolean;
  readonly validate: (input: CandidateDocumentValueInput) =>
    CandidateDocumentValidationResult;
}

export interface CandidateDocumentValueInput extends Readonly<{
    readonly tableId: CatalogTableId;
    readonly developerFields: CanonicalFlarexRuntimeObjectV1;
  }> {}

const VALID_RESULT = Object.freeze({
  status: "valid",
} satisfies CandidateDocumentValidationResult);

/**
 * Pure candidate-schema policy over one already-authenticated historical live
 * document. Persistence owns row identity/evidence and supplies only the
 * developer fields; this operation owns manifest membership and validator-ID
 * policy without acquiring storage or lifecycle authority.
 */
export function validateCandidateDocument(
  input: CandidateDocumentValidationInput,
): CandidateDocumentValidationResult {
  return prepareCandidateDocumentValidator(input.candidateManifest).validate({
    tableId: input.tableId,
    developerFields: input.developerFields,
  });
}

/** Prepare immutable manifest lookups once for a bounded validation scan. */
export function prepareCandidateDocumentValidator(
  manifest: SchemaManifestAppSchemaV1,
): CandidateDocumentValidator {
  const tablesById = new Map(
    manifest.tableDefinitions.tables.map((table) => [table.tableId, table]),
  );
  const tableIdsByLogicalName = new Map(
    manifest.tableDefinitions.tables.map((table) => [
      table.logicalName,
      table.tableId,
    ]),
  );
  const idPolicy = candidateIdPolicy(tableIdsByLogicalName);
  return Object.freeze({
    hasTable: (tableId: CatalogTableId) => tablesById.has(tableId),
    validate: (input: CandidateDocumentValueInput) => {
      const table = tablesById.get(input.tableId);
      if (table === undefined) {
        return Object.freeze({
          status: "invalid" as const,
          reason: "candidateTableRemoved" as const,
          validatorPath: null,
        });
      }

      const validation = validateValidatorValueV1(
        table.definition.documentType,
        input.developerFields,
        { path: "$document", idPolicy },
      );
      return Result.match(validation, {
        onSuccess: () => VALID_RESULT,
        onFailure: (error) => Object.freeze({
          status: "invalid" as const,
          reason: "candidateValidatorRejected" as const,
          validatorPath: boundedValidatorPath(error.issue.path),
        }),
      });
    },
  });
}

function candidateIdPolicy(
  tableIdsByLogicalName: ReadonlyMap<string, CatalogTableId>,
): ValidatorIdPolicyV1 {
  return Object.freeze({
    mode: "tableAware" as const,
    check: (tableName: string, value: string) => {
      if (tableName.startsWith("_")) return "unavailable";
      const tableId = tableIdsByLogicalName.get(tableName);
      if (tableId === undefined) return "unavailable";
      return Result.isSuccess(
          requireAppDocumentIdentityV1ForTableResult(value, tableId),
        )
        ? "valid"
        : "invalid";
    },
  });
}

function boundedValidatorPath(path: string): string {
  if (
    TEXT_ENCODER.encode(path).byteLength
      <= MAX_APP_SCHEMA_CANDIDATE_VALIDATION_VALIDATOR_PATH_BYTES_V1
  ) return path;
  return "$document";
}
