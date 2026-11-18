import { sql, type SQLWrapper } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{
  data: Uint8Array;
  driverData: Uint8Array;
}>({
  dataType() {
    return "bytea";
  },
});

export function nonBlankText(value: SQLWrapper) {
  return sql`btrim(${value}, U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff') <> ''`;
}

export function requiredFrameCheck(
  codecVersion: SQLWrapper,
  byteLength: SQLWrapper,
  sha256: SQLWrapper,
  bytes: SQLWrapper,
) {
  return sql`(
    ${codecVersion} = 1
    and ${byteLength} >= 1
    and octet_length(${sha256}) = 32
    and octet_length(${bytes}) = ${byteLength}
  ) is true`;
}

export function requiredFrameCheckV2(
  codecVersion: SQLWrapper,
  byteLength: SQLWrapper,
  sha256: SQLWrapper,
  bytes: SQLWrapper,
) {
  return sql`(
    ${codecVersion} = 2
    and ${byteLength} >= 1
    and octet_length(${sha256}) = 32
    and octet_length(${bytes}) = ${byteLength}
  ) is true`;
}

export function nullableFrameAbsent(
  codecVersion: SQLWrapper,
  byteLength: SQLWrapper,
  sha256: SQLWrapper,
  bytes: SQLWrapper,
) {
  return sql`(
    ${codecVersion} is null
    and ${byteLength} is null
    and ${sha256} is null
    and ${bytes} is null
  )`;
}
