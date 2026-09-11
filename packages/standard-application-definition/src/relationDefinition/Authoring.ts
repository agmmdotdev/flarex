import type {
  RelationDeclarationV1Schema,
} from "flarex-protocol/internal/relation-declaration-v1";

export type StandardApplicationRelationDeclaration =
  typeof RelationDeclarationV1Schema.Encoded;

export interface StandardApplicationRelationIntent {
  readonly sourceTable: string;
  readonly sourceField: string;
  readonly targetTable: string;
  readonly value:
    | Readonly<{ readonly cardinality: "one"; readonly required: boolean }>
    | Readonly<{
        readonly cardinality: "many";
        readonly minItems: number;
        readonly maxItems: number;
        readonly ordered: boolean;
      }>;
  readonly inverseName: string | null;
  readonly onTargetDelete: "restrict";
}

/** Lowers clean Standard intent into the sole protocol-owned declaration. */
export function lowerStandardApplicationRelationIntent(
  intent: StandardApplicationRelationIntent,
): StandardApplicationRelationDeclaration {
  const sourceTable = intent.sourceTable;
  const sourceField = intent.sourceField;
  const targetTable = intent.targetTable;
  const intentValue = intent.value;
  const inverseName = intent.inverseName;
  const onTargetDelete = intent.onTargetDelete;
  const value = intentValue.cardinality === "one"
    ? Object.freeze({
        cardinality: "one" as const,
        required: intentValue.required,
      })
    : Object.freeze({
        cardinality: "many" as const,
        minItems: intentValue.minItems,
        maxItems: intentValue.maxItems,
        ordered: intentValue.ordered,
        duplicates: "forbid" as const,
      });
  return Object.freeze({
    format: "flarex.relation-declaration" as const,
    version: 1 as const,
    source: Object.freeze({
      table: sourceTable,
      path: Object.freeze([
        Object.freeze({
          kind: "field" as const,
          name: sourceField,
        }),
      ] as const),
      forwardName: sourceField,
    }),
    target: Object.freeze({ table: targetTable }),
    value,
    inverse: Object.freeze({
      cardinality: "many" as const,
      name: inverseName,
    }),
    localized: false as const,
    onTargetDelete,
  });
}
