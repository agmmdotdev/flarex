import { Data, Result } from "effect";
import type { ValidatorJSON } from "flarex/values";
import {
  canonicalizeRelationDeclarationV1Result,
  compareRelationDeclarationsV1,
  decodeRelationDeclarationsV1Result,
  MAX_RELATION_DECLARATIONS_V1,
  type RelationDeclarationV1,
} from "flarex-protocol/internal/relation-declaration-v1";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

export const APPLICATION_ANALYSIS_MAXIMUM_RELATIONS =
  MAX_RELATION_DECLARATIONS_V1;

export interface RelationAnalysisTable {
  readonly tableId: number;
  readonly name: string;
  readonly validator: RelationAnalysisValidator;
}

type RelationAnalysisValidator = ValidatorJSON | ValidatorJsonV1;

export interface RelationAnalysisSchema {
  readonly tables: ReadonlyArray<RelationAnalysisTable>;
}

export interface AnalyzedApplicationRelation {
  /** Dense, one-based, analysis-local ordinal. Never a catalog identity. */
  readonly relationOrdinal: number;
  /** Dense, one-based, analysis-local table ordinal. */
  readonly sourceTableOrdinal: number;
  /** Dense, one-based, analysis-local table ordinal. */
  readonly targetTableOrdinal: number;
  readonly declaration: RelationDeclarationV1;
}

export type ApplicationRelationAnalysisIssueReason =
  | "invalidDeclarations"
  | "relationLimitExceeded"
  | "relationDeclarationBytesExceeded"
  | "unknownSourceTable"
  | "unknownTargetTable"
  | "missingSourceField"
  | "sourceValidatorMismatch"
  | "duplicateSourcePath"
  | "inverseNameCollidesWithField"
  | "duplicateInverseName";

/**
 * Pure semantic-analysis issue retained as Result data until the analyzer or
 * manifest boundary translates it to its owning typed failure.
 */
export interface ApplicationRelationAnalysisIssue {
  readonly reason: ApplicationRelationAnalysisIssueReason;
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly observed?: number;
  readonly maximum?: number;
}

export class ApplicationRelationAnalysisError extends Data.TaggedError(
  "ApplicationRelationAnalysisError",
)<{
  readonly operation: "analyzeDeclarations";
  readonly message: string;
  readonly issue: ApplicationRelationAnalysisIssue;
}> {}

export function analyzeApplicationRelationDeclarationsResult(
  input: unknown,
  schema: RelationAnalysisSchema,
): Result.Result<
  ReadonlyArray<AnalyzedApplicationRelation>,
  ApplicationRelationAnalysisIssue
> {
  return Result.gen(function* () {
    const decoded = yield* decodeRelationDeclarationsV1Result(input).pipe(
      Result.mapError(cause =>
        cause.issue.reason === "declarationLimitExceeded"
          ? relationCountLimitIssue(cause.issue.observed)
          : invalidDeclarationsIssue(cause)
      ),
    );
    const declarations: RelationDeclarationV1[] = [];
    for (let index = 0; index < decoded.length; index += 1) {
      const declaration = decoded[index];
      if (declaration === undefined) {
        throw new Error("Decoded relation declaration set lost an entry.");
      }
      const canonical = yield* canonicalizeRelationDeclarationV1Result(
        declaration,
      ).pipe(Result.mapError(cause =>
        cause.issue.reason === "canonicalBytesExceeded"
          ? issue(
              "relationDeclarationBytesExceeded",
              `relations[${index}]`,
              `Application relation declaration ${index} exceeds the canonical byte limit.`,
              {
                cause,
                observed: cause.issue.observedBytes,
                maximum: cause.issue.maximumBytes,
              },
            )
          : invalidDeclarationsIssue(cause)
      ));
      declarations.push(canonical.declaration);
    }
    return yield* analyzeDecodedApplicationRelationsResult(
      Object.freeze(declarations),
      schema,
    );
  });
}

export function analyzeDecodedApplicationRelationsResult(
  declarations: ReadonlyArray<RelationDeclarationV1>,
  schema: RelationAnalysisSchema,
): Result.Result<
  ReadonlyArray<AnalyzedApplicationRelation>,
  ApplicationRelationAnalysisIssue
> {
  if (declarations.length > APPLICATION_ANALYSIS_MAXIMUM_RELATIONS) {
    return Result.fail(relationCountLimitIssue(declarations.length));
  }

  const ordered = declarations.toSorted(compareRelationDeclarationsV1);
  const tablesByName = new Map(
    schema.tables.map(table => [table.name, table] as const),
  );
  const sourcePaths = new Set<string>();
  const inverseNamesByTarget = new Map<string, Set<string>>();
  const analyzed: AnalyzedApplicationRelation[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const declaration = ordered[index];
    if (declaration === undefined) {
      throw new Error("Application relation ordering lost a declaration.");
    }
    const path = `relations[${index}]`;
    const sourceTable = tablesByName.get(declaration.source.table);
    if (sourceTable === undefined) {
      return Result.fail(issue(
        "unknownSourceTable",
        `${path}.source.table`,
        `Relation source table ${JSON.stringify(declaration.source.table)} does not exist.`,
      ));
    }
    const targetTable = tablesByName.get(declaration.target.table);
    if (targetTable === undefined) {
      return Result.fail(issue(
        "unknownTargetTable",
        `${path}.target.table`,
        `Relation target table ${JSON.stringify(declaration.target.table)} does not exist.`,
      ));
    }

    const sourcePathKey = canonicalSourcePathKey(declaration);
    if (sourcePaths.has(sourcePathKey)) {
      return Result.fail(issue(
        "duplicateSourcePath",
        `${path}.source.path`,
        `Relation source path ${formatSourcePath(declaration)} is declared more than once.`,
      ));
    }
    sourcePaths.add(sourcePathKey);

    const sourceFieldName = declaration.source.path[0]?.name;
    if (sourceFieldName === undefined) {
      throw new Error("Decoded Relation Declaration V1 lost its source field.");
    }
    if (sourceTable.validator.type !== "object") {
      return Result.fail(issue(
        "missingSourceField",
        `${path}.source.path`,
        `Relation source table ${JSON.stringify(sourceTable.name)} must have an object validator containing ${JSON.stringify(sourceFieldName)}.`,
      ));
    }
    const sourceField = Object.hasOwn(sourceTable.validator.value, sourceFieldName)
      ? sourceTable.validator.value[sourceFieldName]
      : undefined;
    if (sourceField === undefined) {
      return Result.fail(issue(
        "missingSourceField",
        `${path}.source.path`,
        `Relation source field ${formatSourcePath(declaration)} does not exist.`,
      ));
    }
    if (!sourceValidatorMatchesDeclaration(sourceField, declaration)) {
      return Result.fail(issue(
        "sourceValidatorMismatch",
        `${path}.source.path`,
        sourceValidatorMismatchMessage(declaration),
      ));
    }

    const inverseName = declaration.inverse.name;
    if (inverseName !== null) {
      if (
        targetTable.validator.type === "object" &&
        Object.hasOwn(targetTable.validator.value, inverseName)
      ) {
        return Result.fail(issue(
          "inverseNameCollidesWithField",
          `${path}.inverse.name`,
          `Relation inverse name ${JSON.stringify(inverseName)} collides with a field on target table ${JSON.stringify(targetTable.name)}.`,
        ));
      }
      const targetInverseNames = inverseNamesByTarget.get(targetTable.name) ??
        new Set<string>();
      if (targetInverseNames.has(inverseName)) {
        return Result.fail(issue(
          "duplicateInverseName",
          `${path}.inverse.name`,
          `Relation inverse name ${JSON.stringify(inverseName)} is declared more than once for target table ${JSON.stringify(targetTable.name)}.`,
        ));
      }
      targetInverseNames.add(inverseName);
      inverseNamesByTarget.set(targetTable.name, targetInverseNames);
    }

    analyzed.push(Object.freeze({
      relationOrdinal: index + 1,
      sourceTableOrdinal: sourceTable.tableId,
      targetTableOrdinal: targetTable.tableId,
      declaration,
    }));
  }

  return Result.succeed(Object.freeze(analyzed));
}

function relationCountLimitIssue(
  observed: number,
): ApplicationRelationAnalysisIssue {
  return issue(
    "relationLimitExceeded",
    "relations",
    `Application analysis admits at most ${APPLICATION_ANALYSIS_MAXIMUM_RELATIONS} relations.`,
    {
      observed,
      maximum: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
    },
  );
}

function invalidDeclarationsIssue(
  cause: unknown,
): ApplicationRelationAnalysisIssue {
  return issue(
    "invalidDeclarations",
    "relations",
    "Application relation declarations do not match Relation Declaration V1.",
    { cause },
  );
}

export function compareAnalyzedApplicationRelations(
  left: AnalyzedApplicationRelation,
  right: AnalyzedApplicationRelation,
): number {
  return left.relationOrdinal - right.relationOrdinal ||
    compareRelationDeclarationsV1(left.declaration, right.declaration);
}

function sourceValidatorMatchesDeclaration(
  field: Readonly<{
    readonly fieldType: RelationAnalysisValidator;
    readonly optional: boolean;
  }>,
  declaration: RelationDeclarationV1,
): boolean {
  const expectedTable = declaration.target.table;
  if (declaration.value.cardinality === "one") {
    return field.optional === !declaration.value.required &&
      field.fieldType.type === "id" &&
      field.fieldType.tableName === expectedTable;
  }
  return field.optional === false &&
    field.fieldType.type === "array" &&
    field.fieldType.value.type === "id" &&
    field.fieldType.value.tableName === expectedTable;
}

function sourceValidatorMismatchMessage(
  declaration: RelationDeclarationV1,
): string {
  const field = formatSourcePath(declaration);
  if (declaration.value.cardinality === "one") {
    const requiredness = declaration.value.required ? "required" : "optional";
    return `Relation source field ${field} must be a ${requiredness} ID for target table ${JSON.stringify(declaration.target.table)}.`;
  }
  return `Relation source field ${field} must be a required array of IDs for target table ${JSON.stringify(declaration.target.table)}.`;
}

function canonicalSourcePathKey(
  declaration: RelationDeclarationV1,
): string {
  return JSON.stringify([
    declaration.source.table,
    ...declaration.source.path.map(segment => [segment.kind, segment.name]),
  ]);
}

function formatSourcePath(declaration: RelationDeclarationV1): string {
  return [
    declaration.source.table,
    ...declaration.source.path.map(segment => segment.name),
  ].join(".");
}

function issue(
  reason: ApplicationRelationAnalysisIssueReason,
  path: string,
  message: string,
  details: Readonly<{
    readonly cause?: unknown;
    readonly observed?: number;
    readonly maximum?: number;
  }> = {},
): ApplicationRelationAnalysisIssue {
  return Object.freeze({
    reason,
    path,
    message,
    ...(details.cause === undefined ? {} : { cause: details.cause }),
    ...(details.observed === undefined ? {} : { observed: details.observed }),
    ...(details.maximum === undefined ? {} : { maximum: details.maximum }),
  });
}
