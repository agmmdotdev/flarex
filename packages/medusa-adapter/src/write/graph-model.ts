import type { Effect, Result } from "effect";
import type { CommerceTransactionError, Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceRelations } from "../commerce-relations";
import type { SchemaTable } from "../schema/model";

export type GraphTable = Pick<SchemaTable, "name" | "columns" | "foreignKeys">;
export interface GraphEntity {
  readonly table: GraphTable;
  readonly model: string;
  readonly keyColumn: string;
  readonly prefix: string | undefined;
}
export interface GraphReference {
  readonly key: string;
  readonly supplied?: JsonObject;
}
export interface GraphCatalog {
  readonly entities: readonly GraphEntity[];
  readonly tables: readonly GraphTable[];
  readonly writablePivots: readonly GraphTable[];
  readonly queryRelations: CommerceRelations;
  readonly decodeRow: (entity: GraphEntity, input: Json) => Result.Result<{
    readonly supplied: JsonObject; readonly key: string | undefined;
  }, CommerceTransactionError>;
  readonly decodeReference: (entity: GraphEntity, input: Json) => Result.Result<GraphReference, CommerceTransactionError>;
  readonly decodeAssociation: (entity: GraphEntity, input: Json) => Result.Result<string, CommerceTransactionError>;
}
export type GraphRows = ReadonlyMap<string, readonly JsonObject[]>;
export type GraphLoad = (table: GraphTable) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
/** The pinned event helper projects actual key names. Its legacy Medusa type
 * promises id even for other keys; that promise must not escape this owner. */
export interface GraphPerformedActions {
  readonly created: Readonly<Record<string, readonly JsonObject[]>>;
  readonly updated: Readonly<Record<string, readonly JsonObject[]>>;
  readonly deleted: Readonly<Record<string, readonly JsonObject[]>>;
}
export interface ReplacedGraph {
  readonly entities: JsonObject[];
  readonly performedActions: GraphPerformedActions;
}

/** Stable module policies, never a storage capability or framework callback.
 * A replacement invocation owns all mutable plans and scoped store handles. */
export interface ReplacementProfile {
  readonly catalog: GraphCatalog;
  readonly allowedRelations: (entity: GraphEntity) => readonly string[];
  readonly ownedToOne: (entity: GraphEntity) => readonly string[];
  readonly mutableForeignKeys: (entity: GraphEntity) => boolean;
  readonly toManyMode: (entity: GraphEntity, name: string, child: GraphEntity) => Result.Result<"replace" | "associate", CommerceTransactionError>;
  readonly validateLink: (source: GraphEntity, next: JsonObject, selected: JsonObject, load: GraphLoad) => Effect.Effect<void, CommerceTransactionError>;
  readonly projectionPaths: (entity: GraphEntity, relations: readonly string[]) => readonly string[];
  readonly project: (rows: GraphRows) => Result.Result<GraphRows, CommerceTransactionError>;
}

export interface CreationNode {
  readonly entity: GraphEntity;
  readonly omitRelations: readonly string[];
  readonly steps: readonly CreationStep[];
}
export type CreationStep =
  | { readonly kind: "children"; readonly name: string; readonly foreignKey: string; readonly node: CreationNode }
  | {
      readonly kind: "references"; readonly name: string; readonly target: GraphEntity;
      readonly membership: "external" | "declaredSnapshot";
      readonly resolve: () => Result.Result<{
        readonly table: string;
        readonly link: (parent: string, reference: string) => JsonObject;
      }, CommerceTransactionError>;
      readonly decode: (input: Json) => Result.Result<GraphReference, CommerceTransactionError>;
    };
export interface CreationProfile {
  readonly catalog: GraphCatalog;
  readonly root: CreationNode;
  readonly rowLimitDetail: (maximum: number, attempted: number, tables: Readonly<Record<string, number>>) => unknown;
}
export interface CreatedGraph {
  readonly roots: readonly string[];
  readonly rows: GraphRows;
}
