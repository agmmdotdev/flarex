import { Result } from "effect";
import { requireAppDocumentIdentityV1ForTableResult } from
  "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ValidatorIdPolicyV1 } from
  "flarex-protocol/validator-engine";

import type { AuthenticatedActiveApplicationRevisionSelectionV1 } from
  "./applicationRevisionActivationV1";

declare const syscallValidatorBrand: unique symbol;
export interface ApplicationRevisionSyscallValidatorV1 {
  readonly [syscallValidatorBrand]: true;
}

export interface ValidatorTableV1 {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly documentType: SchemaManifestAppSchemaV1["tableDefinitions"]["tables"][number]["definition"]["documentType"];
}

export interface ActivationFencedValidatorStateV1 {
  readonly kind: "activationFenced";
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tablesByName: ReadonlyMap<string, ValidatorTableV1>;
  readonly idPolicy: ValidatorIdPolicyV1;
}

export interface SetupSeededProofValidatorStateV1 {
  readonly kind: "setupSeededProof";
  readonly scopeId: ScopeId | null;
  readonly schemaVersionId: CatalogSchemaVersionId | null;
  readonly tablesByName: ReadonlyMap<string, ValidatorTableV1> | null;
  readonly idPolicy: ValidatorIdPolicyV1 | null;
}

export type SyscallValidatorStateV1 =
  | ActivationFencedValidatorStateV1
  | SetupSeededProofValidatorStateV1;

const states = new WeakMap<
  ApplicationRevisionSyscallValidatorV1,
  SyscallValidatorStateV1
>();

export function issueApplicationRevisionSyscallValidatorStateV1(
  state: SyscallValidatorStateV1,
): ApplicationRevisionSyscallValidatorV1 {
  const capability = Object.freeze({}) as
    ApplicationRevisionSyscallValidatorV1;
  states.set(capability, state);
  return capability;
}

export function revokeApplicationRevisionSyscallValidatorStateV1(
  capability: ApplicationRevisionSyscallValidatorV1,
): void {
  states.delete(capability);
}

export function readApplicationRevisionSyscallValidatorStateV1(
  capability: unknown,
): Result.Result<SyscallValidatorStateV1, void> {
  if (typeof capability !== "object" || capability === null) {
    return Result.fail(undefined);
  }
  const state = states.get(capability as ApplicationRevisionSyscallValidatorV1);
  return state === undefined ? Result.fail(undefined) : Result.succeed(state);
}

export function activationFencedSyscallValidatorStateV1(input: Readonly<{
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}>): ActivationFencedValidatorStateV1 {
  const tables = captureTables(input.schemaManifest);
  return Object.freeze({
    kind: "activationFenced",
    selection: input.selection,
    scopeId: input.scopeId,
    schemaVersionId: input.schemaVersionId,
    tablesByName: tables,
    idPolicy: tableAwareIdPolicy(tables),
  });
}

export function setupSeededSyscallValidatorStateV1(input: Readonly<{
  readonly scopeId?: ScopeId;
  readonly schemaVersionId?: CatalogSchemaVersionId;
  readonly schemaManifest?: SchemaManifestAppSchemaV1;
}>): SetupSeededProofValidatorStateV1 {
  const tables = input.schemaManifest === undefined
    ? null
    : captureTables(input.schemaManifest);
  return Object.freeze({
    kind: "setupSeededProof",
    scopeId: input.scopeId ?? null,
    schemaVersionId: input.schemaVersionId ?? null,
    tablesByName: tables,
    idPolicy: tables === null ? null : tableAwareIdPolicy(tables),
  });
}

function captureTables(
  manifest: SchemaManifestAppSchemaV1,
): ReadonlyMap<string, ValidatorTableV1> {
  const tables = new Map<string, ValidatorTableV1>();
  for (const table of manifest.tableDefinitions.tables) {
    tables.set(table.logicalName, Object.freeze({
      tableId: table.tableId,
      tableName: table.logicalName,
      documentType: table.definition.documentType,
    }));
  }
  return tables;
}

function tableAwareIdPolicy(
  tables: ReadonlyMap<string, ValidatorTableV1>,
): ValidatorIdPolicyV1 {
  return Object.freeze({
    mode: "tableAware",
    check: (tableName, value) => {
      if (tableName.startsWith("_")) return "unavailable";
      const table = tables.get(tableName);
      if (table === undefined) return "unavailable";
      return Result.isSuccess(
          requireAppDocumentIdentityV1ForTableResult(value, table.tableId),
        )
        ? "valid"
        : "invalid";
    },
  });
}
