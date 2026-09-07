import { Result } from "effect";
import type { ValidatorJSON } from "flarex/values";
import { ApplicationWritePolicyError, type ApplicationWritePolicies } from "./model.ts";
import type { AnalyzedApplicationRelation } from "../applicationRelationAnalysis.ts";

/** The first profile admits exactly declared, required flat scalar fields. */
export function validateApplicationWritePolicySchema(
  policies: ApplicationWritePolicies,
  tables: ReadonlyArray<Readonly<{ readonly name: string; readonly validator: ValidatorJSON }>>,
  relations: ReadonlyArray<AnalyzedApplicationRelation> = [],
): Result.Result<void, ApplicationWritePolicyError> {
  for (const configured of policies.configuration.tables) {
    const validator = tables.find(table => table.name === configured.logicalTableName)?.validator;
    if (validator?.type !== "object" ||
      Object.keys(validator.value).length !== configured.fields.length ||
      configured.fields.some(field => {
        if (!Object.hasOwn(validator.value, field.name)) return true;
        const declared = validator.value[field.name];
        if (field.kind === "relationship") return declared === undefined || !declared.optional ||
          declared.fieldType.type !== "id" || declared.fieldType.tableName !== field.target;
        const expected = field.kind === "text" || field.kind === "date" ? "string" : field.kind;
        return declared === undefined || declared.optional || declared.fieldType.type !== expected;
      })) {
      return Result.fail(new ApplicationWritePolicyError({
        reason: "configurationMismatch", path: `configuration.tables.${configured.logicalTableName}`,
      }));
    }
  }
  if (policies.configuration.profile === "payload.content-relations") {
    const declaration = relations[0]?.declaration;
    if (relations.length !== 1 || declaration?.source.table !== "posts" || declaration.source.path[0].name !== "relatedPost" ||
      declaration.source.forwardName !== "relatedPost" || declaration.target.table !== "posts" ||
      declaration.value.cardinality !== "one" || declaration.value.required || declaration.localized ||
      declaration.inverse.cardinality !== "many" || declaration.inverse.name !== null || declaration.onTargetDelete !== "restrict") {
      return Result.fail(new ApplicationWritePolicyError({ reason: "configurationMismatch", path: "configuration.relations" }));
    }
  } else if (relations.some(relation => policies.configuration.tables.some(table => table.logicalTableName === relation.declaration.source.table))) {
    return Result.fail(new ApplicationWritePolicyError({ reason: "configurationMismatch", path: "configuration.relations" }));
  }
  return Result.succeed(undefined);
}
