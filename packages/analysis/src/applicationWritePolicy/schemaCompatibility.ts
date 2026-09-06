import { Result } from "effect";
import type { ValidatorJSON } from "flarex/values";
import { ApplicationWritePolicyError, type ApplicationWritePolicies } from "./model.ts";

/** The first profile admits exactly declared, required flat scalar fields. */
export function validateApplicationWritePolicySchema(
  policies: ApplicationWritePolicies,
  tables: ReadonlyArray<Readonly<{ readonly name: string; readonly validator: ValidatorJSON }>>,
): Result.Result<void, ApplicationWritePolicyError> {
  for (const configured of policies.configuration.tables) {
    const validator = tables.find(table => table.name === configured.logicalTableName)?.validator;
    if (validator?.type !== "object" ||
      Object.keys(validator.value).length !== configured.fields.length ||
      configured.fields.some(field => {
        if (!Object.hasOwn(validator.value, field.name)) return true;
        const declared = validator.value[field.name];
        const expected = field.kind === "text" || field.kind === "date" ? "string" : field.kind;
        return declared === undefined || declared.optional || declared.fieldType.type !== expected;
      })) {
      return Result.fail(new ApplicationWritePolicyError({
        reason: "configurationMismatch", path: `configuration.tables.${configured.logicalTableName}`,
      }));
    }
  }
  return Result.succeed(undefined);
}
