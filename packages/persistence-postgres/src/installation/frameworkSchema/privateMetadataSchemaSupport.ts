import { sql, type SQLWrapper } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

export const frameworkMetadataCollatedText = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'text COLLATE "C"';
  },
});

const ecmaScriptTrimCharacters = sql`
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
`;

export function isFrameworkMetadataTextPhysicallyNonBlank(
  value: SQLWrapper,
) {
  return sql`btrim(${value}, ${ecmaScriptTrimCharacters}) <> ''`;
}

export function isFrameworkMetadataTextWithin(
  value: SQLWrapper,
  maximumUtf8Bytes: number,
) {
  return sql`
    octet_length(convert_to(${value}, 'UTF8'))
      between 1 and ${sql.raw(String(maximumUtf8Bytes))}
    and ${isFrameworkMetadataTextPhysicallyNonBlank(value)}
  `;
}
