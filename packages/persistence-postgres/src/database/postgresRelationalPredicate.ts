import { Result } from "effect";
import { sql, type SQL } from "drizzle-orm";
import { inspectIssuedPostgresRelationalBatch, type NormalizedRelatedRelationalPredicate,
  type PostgresRelationalPredicateBatch, type PostgresRelationalPredicateFailure } from "../values/postgresRelationalPredicate";
import type { NormalizedRelationalPredicate } from "../values/relationalPredicate";

const text = (row: SQL, column: string) => sql`(${row} ->> ${column})`;
const json = (row: SQL, column: string) => sql`(${row} -> ${column})`;
const join = (parts: readonly SQL[], operator: "and" | "or"): SQL => parts.length === 0
  ? operator === "and" ? sql`true` : sql`false`
  : sql`(${sql.join([...parts], operator === "and" ? sql` and ` : sql` or `)})`;
const membership = (row: SQL, column: string, values: readonly (string | boolean | null)[], negative = false): SQL => values.length === 0
  ? negative ? sql`true` : sql`false`
  : negative ? sql`${text(row, column)} not in (${sql.join(values.map(value => sql`${value === null ? null : String(value)}`), sql`, `)})`
    : sql`${text(row, column)} in (${sql.join(values.map(value => sql`${value === null ? null : String(value)}`), sql`, `)})`;

function expression(node: NormalizedRelationalPredicate, row: SQL): SQL {
  switch (node.kind) {
    case "and": case "or": return join(node.children.map(child => expression(child, row)), node.kind);
    case "in": return membership(row, node.column, node.values);
    case "numberIn": return node.values.length === 0 ? sql`false`
      : sql`(${text(row, node.column)})::double precision in (${sql.join(node.values.map(value => sql`${String(value)}::double precision`), sql`, `)})`;
    case "numericIn": return node.values.length === 0 ? sql`false`
      : sql`(${text(row, node.column)})::numeric in (${sql.join(node.values.map(value => sql`${value}::numeric`), sql`, `)})`;
    case "postgresNumericCast": {
      // Bind the finite number's decimal spelling. Stored TEXT remains intact:
      // PostgreSQL alone determines numeric precision, special values/errors.
      const left = sql`(${text(row, node.column)})::numeric`, right = sql`${String(node.value)}::numeric`;
      switch (node.operator) {
        case "gt": return sql`${left} > ${right}`;
        case "gte": return sql`${left} >= ${right}`;
        case "lt": return sql`${left} < ${right}`;
        case "lte": return sql`${left} <= ${right}`;
      }
    }
    case "indexedPoints": return join(node.values.map(point => join(node.columns.map((column, offset) =>
      sql`${text(row, column)} = ${String(point[offset])}`), "and")), "or");
    case "isNull": return sql`${text(row, node.column)} is null`;
    case "textNotEqual": return sql`${text(row, node.column)} <> ${node.value}`;
    case "greaterThan": return sql`convert_to(${text(row, node.column)}, 'UTF8') > convert_to(${node.value}, 'UTF8')`;
    case "lessThan": return sql`convert_to(${text(row, node.column)}, 'UTF8') < convert_to(${node.value}, 'UTF8')`;
    case "textLikeAscii": return sql`translate(${text(row, node.column)}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" like translate(${node.pattern}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" escape ''`;
    case "jsonContains": return sql`(${text(row, node.column)} is not null and ${json(row, node.column)} @> ${JSON.stringify(node.value)}::jsonb)`;
    case "postgresText": switch (node.operator) {
    case "gt": return sql`${text(row, node.column)} > ${node.value}`;
    case "gte": return sql`${text(row, node.column)} >= ${node.value}`;
    case "lt": return sql`${text(row, node.column)} < ${node.value}`;
    case "lte": return sql`${text(row, node.column)} <= ${node.value}`;
    case "like": return sql`${text(row, node.column)} like ${node.value}`;
    case "ilike": return sql`${text(row, node.column)} ilike ${node.value}`;
    case "regex": return sql`${text(row, node.column)} ~ ${node.value}`;
    case "fulltext": return sql`to_tsvector('simple', ${text(row, node.column)}) @@ plainto_tsquery('simple', ${node.value})`;
    case "notIn": return membership(row, node.column, node.values, true);
    case "exists": return node.value ? sql`${text(row, node.column)} is not null` : sql`${text(row, node.column)} is null`;
    }
  }
}

/** No database identifiers, arbitrary SQL, callbacks or sessions cross this
 * boundary. Every value and column key is a parameter in a closed expression. */
export function buildPostgresRelationalPredicateBody<Binding, Failure>(batch: PostgresRelationalPredicateBatch<Binding>,
  tableId: Binding, error: PostgresRelationalPredicateFailure<Failure>) {
  return inspectIssuedPostgresRelationalBatch(batch, error).pipe(Result.flatMap(facts =>
    facts.tableId !== tableId ? Result.fail(error("invalidAuthority")) : Result.succeed(facts)), Result.map(facts => {
    if (facts.program.kind === "related") {
      const program = facts.program;
      const relatedExpression = (node: NormalizedRelatedRelationalPredicate): SQL => {
        if ("children" in node) return join(node.children.map(relatedExpression), node.kind);
        if (node.kind === "parent") return expression(node.predicate, sql`parent.row`);
        if (node.kind === "child") return expression(node.predicate, sql`child.row`);
        return sql`${text(sql`parent.row`, program.child.parentColumn)} not in (
          select ${text(sql`member.row`, program.child.childColumn)} from child_rows member
          where ${expression(node.predicate, sql`member.row`)})`;
      };
      return sql`with candidate_rows as materialized (
        select row, ordinal from jsonb_array_elements(${facts.payload}::jsonb) with ordinality as source(row, ordinal)
      ), child_rows as materialized (
        select row from jsonb_array_elements(${facts.childPayload}::jsonb) as source(row)
      ), matches as materialized (
        select distinct parent.ordinal from candidate_rows parent left join child_rows child
          on ${text(sql`child.row`, program.child.childColumn)} = ${text(sql`parent.row`, program.child.parentColumn)}
        where ${relatedExpression(program.predicate)}
      ) select (candidate.ordinal - 1)::integer as ordinal, matches.ordinal is not null as matched
      from candidate_rows candidate left join matches using (ordinal) order by candidate.ordinal`;
    }
    return sql`with candidate_rows as materialized (
      select row, ordinal from jsonb_array_elements(${facts.payload}::jsonb) with ordinality as source(row, ordinal)
    ), matches as materialized (
      select candidate.ordinal from candidate_rows candidate where ${expression(facts.program.predicate, sql`candidate.row`)}
    ) select (candidate.ordinal - 1)::integer as ordinal, matches.ordinal is not null as matched
    from candidate_rows candidate left join matches using (ordinal) order by candidate.ordinal`;
  }));
}
