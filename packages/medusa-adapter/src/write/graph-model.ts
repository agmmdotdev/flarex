import type { Effect, Result } from "effect";
import type { CommerceTransactionError, Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceRelations, CommerceRelationOrder } from "../query/relations";
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
export type GraphLoad = (table: GraphTable, column: string, values: readonly string[]) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
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
  /** Native update and upsertWithReplace differ on root writes and empty collections. */
  readonly operation: "upsertWithReplace" | "update";
  /** Opt into replacing explicit empty collections during update. Omission
   * always leaves a collection unchanged; the default ignores update empties. */
  readonly emptyCollections?: "replace";
  /** Restrict owned has-many replacement omissions to active rows. The default
   * includes historical members; association and pivot membership are separate. */
  readonly replacementMembers?: "active";
  /** A selected update profile may coalesce repeated existing active key-only
   * owned has-many references with the same owner. Full writes, new members,
   * roots, association changes and the default policy still reject repeats. */
  readonly repeatedOwnedReferences?: "coalesceIdentical";
  /** Native owned-child assignment may accept a retained update timestamp as
   * a dirty-tracking signal. Its value never reaches storage: a changed stamp
   * triggers an ordinary managed update. Roots and other managed fields stay
   * strict, and deleted-row reconstitution keeps its separate proof. */
  readonly ownedChildUpdatedAt?: "managed";
  /** Selected native assignment may dirty an existing root without changing
   * business values. This requests an ordinary core-managed update only; it
   * never admits supplied timestamps or mutable foreign keys. */
  readonly touchExistingRoot?: true;
  readonly ordering: ReadonlyMap<string, CommerceRelationOrder>;
  /** Complete deleted-child DTOs still need the accepting core's exact
   * same-root deletion proof; this policy never grants timestamp authority. */
  readonly allowReconstitution?: true;
  /** Native DAL.update touches supplied owned to-one objects even for { id }. */
  readonly touchOwnedToOne?: true;
  readonly allowedRelations: (entity: GraphEntity) => readonly string[];
  readonly ownedToOne: (entity: GraphEntity) => readonly string[];
  readonly mutableForeignKeys: (entity: GraphEntity) => boolean;
  readonly admitSelection: (table: GraphTable, rows: readonly JsonObject[]) => Result.Result<void, CommerceTransactionError>;
  readonly prepareProjection: (entity: GraphEntity, roots: readonly JsonObject[], load: GraphLoad) => Effect.Effect<void, CommerceTransactionError>;
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
  | { readonly kind: "ownedToOne"; readonly name: string; readonly foreignKey: string; readonly node: CreationNode }
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
