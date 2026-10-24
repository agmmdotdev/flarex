/** Extracted from the pinned Medusa 2.13.4 db-error-mapper. PostgreSQL detail
 * parsing is deliberately preserved, including comma/parenthesis behavior.
 * This consumes native detail text; structured reference evidence is not an
 * equivalent input. See scripts/check-medusa-db-error-source.mjs.
 */
import { upperCaseFirst } from "../common/upper-case-first"

export interface DatabaseConstraintDetails {
  readonly detail?: string | null
  readonly table: string
}

export interface DatabaseConstraintInfo {
  readonly table: string
  readonly keys: readonly string[]
  readonly values: readonly string[]
}

function parseValue(value: string | undefined) {
  switch (value) {
    case "t":
      return "true"
    case "f":
      return "false"
    default:
      return value
  }
}

/** Literal native tuple selection, also used by scalar presentation. */
const selectConstraintTuples = (value: string): readonly string[] =>
  value.match(/\([^\(]*\)/g) || []

/** Literal native comma splitting and trimming, shared by both bounded inputs. */
const splitConstraintValues = (value: string): string[] =>
  value.split(",").map((value) => value.trim())

const parseConstraintTupleValues = (tuple: string): string[] =>
  splitConstraintValues(tuple.substring(1, tuple.length - 1))

export const parseDatabaseConstraintInfo = (
  err: DatabaseConstraintDetails,
): DatabaseConstraintInfo | null => {
  const detail = err.detail as string
  if (!detail) {
    return null
  }

  const [keys, values] = selectConstraintTuples(detail)

  if (!keys || !values) {
    return null
  }

  return {
    table: err.table.split("_").join(" "),
    keys: parseConstraintTupleValues(keys),
    values: parseConstraintTupleValues(values),
  }
}

export const formatUniqueConstraintMessage = (info: DatabaseConstraintInfo): string =>
  `${upperCaseFirst(info.table.split("_").join(" "))} with ${info.keys
    .map((key, i) => `${key}: ${parseValue(info.values[i])}`)
    .join(", ")}, already exists.`

export const formatForeignKeyConstraintMessage = (
  info: Pick<DatabaseConstraintInfo, "keys" | "values"> | null,
): string =>
  `You tried to set relationship ${info?.keys.map(
    (key, i) => `${key}: ${info.values[i]}`
  )}, but such entity does not exist`

/** Bounded single-column compatibility presentation for authenticated logical
 * reference evidence. Frame only the raw scalar as a value tuple, then reuse
 * the literal native tuple selection and value parsing. This is message
 * grammar framing, not PostgreSQL detail, a SQL exception or driver evidence.
 * It makes no general composite-constraint claim. */
export const formatScalarForeignKeyConstraintMessage = (
  column: string,
  value: string,
): string => {
  const [tuple] = selectConstraintTuples("(" + value + ")")
  return formatForeignKeyConstraintMessage({
    keys: [column],
    values: tuple === undefined ? [] : parseConstraintTupleValues(tuple),
  })
}

/** Native UNIQUE presentation for an authenticated, nonempty ordered set of
 * all-text DML key columns and corresponding text values. Frame only the joined
 * semantic value tuple and reuse the native tuple parser and formatter,
 * including its literal t/f conversion. This is not SQL detail or a driver
 * exception, and it does not claim support for non-text key representation. */
export const formatTextUniqueConstraintMessage = (
  table: string,
  columns: readonly string[],
  values: readonly string[],
): string => {
  const [tuple] = selectConstraintTuples("(" + values.join(", ") + ")")
  return formatUniqueConstraintMessage({
    table,
    keys: columns,
    values: tuple === undefined ? [] : parseConstraintTupleValues(tuple),
  })
}
