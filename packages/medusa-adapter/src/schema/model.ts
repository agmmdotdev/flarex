import type { DatabaseColumn, DatabaseForeignKey, DatabaseIndex, DatabaseTable } from "@medusajs/drizzle/schema";
import type { CompiledIndexWhere } from "./index-predicate";
import type { CompiledCheckConstraint } from "./check-constraint";
import type {
  RelationalSchema,
} from "flarex-protocol/internal/relational-schema";

type ColumnBase = Readonly<Pick<DatabaseColumn, "name" | "nullable" | "primaryKey" | "generated">> & {
  readonly options?: {
    readonly prefix?: string;
    readonly searchable?: boolean;
    readonly translatable?: boolean;
    readonly choices?: readonly string[];
  };
};

/** Checked adapter subset of the pinned DML compiler. This is a lowering input,
 * not a decoder or authority to admit another module or compiler feature. */
export type SchemaColumn = ColumnBase & (
  | { readonly type: "array"; readonly defaultValue?: readonly [] }
  | { readonly type: "float"; readonly defaultValue?: never }
  /** Preservation of an existing native serial value; no allocation/default. */
  | { readonly type: "serial"; readonly defaultValue?: never; readonly generated?: false }
  | { readonly type: "id" | "text" | "number" | "boolean" | "dateTime" | "json" | "enum";
      readonly defaultValue?: string | number | boolean }
  | { readonly type: "bigNumber"; readonly defaultValue?: string | number | null }
  | { readonly type: "json"; readonly defaultValue?: string | number | boolean | null | Readonly<Record<string, never>> | { readonly value: string; readonly precision: number } }
);

export type SchemaTable = Readonly<Pick<DatabaseTable, "name">> & {
  readonly columns: readonly SchemaColumn[];
  readonly indexes: readonly (Readonly<Pick<DatabaseIndex, "name" | "unique" | "type">> & {
    readonly columns: readonly string[];
    readonly where?: typeof CompiledIndexWhere.Type;
  })[];
  readonly checks?: readonly (typeof CompiledCheckConstraint.Type)[];
  readonly foreignKeys: readonly (Readonly<Pick<DatabaseForeignKey, "name" | "referencedTable" | "onDelete">> & {
    readonly columns: readonly string[];
    readonly referencedColumns: readonly string[];
  })[];
  /** Admitted companion capabilities, including their persisted identities. */
  readonly exactNumbers?: readonly {
    readonly capabilityId: string;
    readonly numericColumn: string;
    readonly rawColumn: string;
  }[];
};

export type ColumnDefault = RelationalSchema["tables"][number]["columns"][number]["default"];
export type DefinitionOrigin = {
  readonly kind: RelationalSchema["tables"][number]["origin"]["kind"];
  readonly sourceId: string;
};

export interface LoweredColumn {
  readonly columnId: string;
  readonly type: RelationalSchema["tables"][number]["columns"][number]["type"];
  readonly nullable: boolean;
  readonly default: ColumnDefault;
  readonly origin: DefinitionOrigin;
}

/** Provenance spellings are part of persisted schema identity. These four
 * declarations differ between the existing module profiles. Derived DML
 * mechanics (FKs, implicit timestamps and active indexes) have one owner. */
export interface SchemaOrigins {
  readonly table: (table: SchemaTable) => DefinitionOrigin;
  readonly column: (table: SchemaTable, column: SchemaColumn) => DefinitionOrigin;
  readonly primaryKey: (table: SchemaTable) => DefinitionOrigin;
  readonly searchable: (table: SchemaTable) => DefinitionOrigin;
}
