import { Schema } from "effect";

/** Checked native spellings, not a SQL parser. DML appends the active-row
 * guard to the quoted Boolean condition before either repository compiles it. */
const BooleanWhere = Schema.TemplateLiteral([
  Schema.Literal('"'),
  Schema.String.check(Schema.isMaxLength(256), Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
  Schema.Literals(['" = true AND deleted_at IS NULL', '" = false AND deleted_at IS NULL']),
]);
const UnquotedBooleanWhere = Schema.String.check(Schema.isPattern(
  /^[A-Za-z_][A-Za-z0-9_]{0,255} = (?:true|false) AND deleted_at IS NULL(?![\s\S])/,
));
const TwoNullWhere = Schema.String.check(Schema.isPattern(
  /^[A-Za-z_][A-Za-z0-9_]{0,255} IS NULL AND deleted_at IS NULL(?![\s\S])/,
));
const NotNullWhere = Schema.String.check(Schema.isPattern(
  /^[A-Za-z_][A-Za-z0-9_]{0,255} IS NOT NULL(?![\s\S])/,
));
const NullAndNotNullWhere = Schema.String.check(Schema.isPattern(
  /^(?:[A-Za-z_][A-Za-z0-9_]{0,255} IS NULL AND [A-Za-z_][A-Za-z0-9_]{0,255} IS NOT NULL|[A-Za-z_][A-Za-z0-9_]{0,255} IS NOT NULL AND [A-Za-z_][A-Za-z0-9_]{0,255} IS NULL)(?![\s\S])/,
));

export const CompiledIndexWhere = Schema.Union([
  Schema.Literals(["deleted_at IS NULL", "deleted_at IS NULL AND status = 'active'"]),
  BooleanWhere,
  UnquotedBooleanWhere,
  TwoNullWhere,
  NotNullWhere,
  NullAndNotNullWhere,
]);

export function lowerCompiledIndexWhere(where: typeof CompiledIndexWhere.Type | undefined) {
  if (where === undefined) return null;
  if (where.includes(" IS NOT NULL")) {
    const notNullFirst = where.indexOf(" IS NOT NULL AND ");
    if (notNullFirst > 0) return { kind: "isNullAndNotNull" as const,
      notNullColumnId: where.slice(0, notNullFirst),
      nullColumnId: where.slice(notNullFirst + " IS NOT NULL AND ".length, -" IS NULL".length) };
    const nullFirst = where.indexOf(" IS NULL AND ");
    if (nullFirst > 0) return { kind: "isNullAndNotNull" as const,
      nullColumnId: where.slice(0, nullFirst),
      notNullColumnId: where.slice(nullFirst + " IS NULL AND ".length, -" IS NOT NULL".length) };
    return { kind: "isNotNull" as const, columnId: where.slice(0, -" IS NOT NULL".length) };
  }
  if (where === "deleted_at IS NULL") return { kind: "isNull" as const, columnId: "deleted_at" };
  if (where === "deleted_at IS NULL AND status = 'active'") {
    return { kind: "isNullAndTextEquals" as const, nullColumnId: "deleted_at", textColumnId: "status", value: "active" };
  }
  if (where.endsWith(" IS NULL AND deleted_at IS NULL")) {
    return { kind: "allNull" as const, columnIds: [where.slice(0, -" IS NULL AND deleted_at IS NULL".length), "deleted_at"] };
  }
  if (!where.startsWith('"')) {
    return { kind: "isNullAndBooleanEquals" as const, nullColumnId: "deleted_at",
      booleanColumnId: where.slice(0, where.indexOf(" = ")), value: where.endsWith(" = true AND deleted_at IS NULL") };
  }
  return {
    kind: "isNullAndBooleanEquals" as const,
    nullColumnId: "deleted_at",
    booleanColumnId: where.slice(1, where.indexOf('"', 1)),
    value: where.endsWith('" = true AND deleted_at IS NULL'),
  };
}
