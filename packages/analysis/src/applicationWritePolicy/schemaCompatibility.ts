import { Result } from "effect";
import type { ValidatorJSON } from "flarex/values";
import { ApplicationWritePolicyError, type ApplicationWritePolicies } from "./model.ts";
import type { AnalyzedApplicationRelation } from "../applicationRelationAnalysis.ts";

/** Payload-owned validators and native relation declarations must agree exactly. */
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
        if (field.kind === "relationship") {
          if (field.cardinality === "one") return declared === undefined || !declared.optional ||
            declared.fieldType.type !== "id" || declared.fieldType.tableName !== field.target;
          return declared === undefined || declared.optional || declared.fieldType.type !== "array" ||
            declared.fieldType.value.type !== "id" || declared.fieldType.value.tableName !== field.target;
        }
        const expected = field.kind === "text" || field.kind === "date" ? "string" : field.kind;
        return declared === undefined || declared.optional || declared.fieldType.type !== expected;
      })) {
      return Result.fail(new ApplicationWritePolicyError({
        reason: "configurationMismatch", path: `configuration.tables.${configured.logicalTableName}`,
      }));
    }
  }
  const manyProfile = policies.configuration.profile === "payload.content-many" || policies.configuration.profile === "payload.content-joins";
  if (policies.configuration.profile !== "payload.scalar") {
    const source = policies.configuration.tables.find(table => table.fields.some(field => field.kind === "relationship" && field.cardinality === "one"));
    const field = source?.fields.find(candidate => candidate.kind === "relationship" && candidate.cardinality === "one");
    const declaration = relations[0]?.declaration;
    if (field?.kind !== "relationship" || source === undefined || relations.length !== (manyProfile ? 2 : 1) ||
      declaration?.source.table !== source.logicalTableName || declaration.source.path.length !== 1 || declaration.source.path[0].name !== field.name ||
      declaration.source.forwardName !== field.name || declaration.target.table !== field.target ||
      declaration.value.cardinality !== "one" || declaration.value.required || declaration.localized ||
      declaration.inverse.cardinality !== "many" || declaration.inverse.name !== null || declaration.onTargetDelete !== "restrict") {
      return Result.fail(new ApplicationWritePolicyError({ reason: "configurationMismatch", path: "configuration.relations" }));
    }
    if (manyProfile) {
      const many = relations[1]?.declaration;
      if (many?.source.table !== "posts" || many.source.path.length !== 1 || many.source.path[0]?.name !== "relatedPosts" ||
        many.source.forwardName !== "relatedPosts" || many.target.table !== "posts" || many.value.cardinality !== "many" ||
        many.value.minItems !== 0 || many.value.maxItems !== 32 || !many.value.ordered || many.localized || many.inverse.cardinality !== "many" ||
        many.inverse.name !== null || many.onTargetDelete !== "restrict") {
        return Result.fail(new ApplicationWritePolicyError({ reason: "configurationMismatch", path: "configuration.relations" }));
      }
    }
  } else if (relations.some(relation => policies.configuration.tables.some(table => table.logicalTableName === relation.declaration.source.table))) {
    return Result.fail(new ApplicationWritePolicyError({ reason: "configurationMismatch", path: "configuration.relations" }));
  }
  return Result.succeed(undefined);
}
