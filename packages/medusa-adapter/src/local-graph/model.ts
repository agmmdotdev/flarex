import type { Effect, Result } from "effect";
import type { AtomicCommerceContext, AtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceTransactionError, Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadTable } from "../query/catalog";
import type { GraphReadCommand } from "./commands";
import type { GraphRemotePath, GraphLinkEndpoint } from "./links";
export type { GraphRemotePath, GraphRemotePathSelection } from "./links";

export interface GraphRelationPath {
  readonly path: string;
  readonly table: ReadTable;
  readonly many: boolean;
  /** A service-owned absent to-one value, not an arbitrary missing response. */
  readonly optional?: boolean;
  /** Source join columns from the module's checked relationship catalog. */
  readonly sourceFields?: readonly string[];
}

export interface GraphReadDefinition {
  readonly model: string;
  readonly command: GraphReadCommand;
  readonly table: ReadTable;
  readonly paths: readonly GraphRelationPath[];
  readonly orderable: readonly string[];
  /** Individually unique columns; composite primary-key components are not. */
  readonly uniqueOrder: readonly string[];
  readonly multipleOrder: boolean;
  /** Explicit module-owned OR grammar; the read command still decodes its
   * admitted selector shape and bounds. Other operators remain unavailable. */
  readonly allowOrFilters?: true;
  /** Fetch and authenticate numeric companions, then return exactly the native
   * requested fields. Existing profiles retain companion projection. */
  readonly selectedFieldsOnly?: true;
  readonly decode: (value: Json) => Result.Result<readonly [readonly JsonObject[], number], CommerceTransactionError>;
}

export interface GraphModuleDefinition {
  readonly aliases: readonly { readonly name: string; readonly model: string }[];
  /** Native Link service identities are distinct from public entity aliases. */
  readonly services?: readonly { readonly name: string; readonly model: string }[];
  readonly reads: readonly GraphReadDefinition[];
  readonly remotePaths?: readonly GraphRemotePath[];
  readonly linkEndpoints?: readonly GraphLinkEndpoint[];
}

export type LocalGraphResult = {
  readonly data: readonly JsonObject[];
  readonly metadata: { readonly count: number; readonly skip: number; readonly take: number };
};

/** Explicit per-transaction instance; several module sets can coexist. */
export interface LocalGraphQuery {
  readonly graph: (input: unknown) => Effect.Effect<LocalGraphResult, CommerceTransactionError>;
  readonly service: (input: unknown) => Effect.Effect<LocalGraphResult, CommerceTransactionError>;
  /** Callable RemoteQuery retains the native join fields used by its plan. */
  readonly native: (input: unknown) => Effect.Effect<LocalGraphResult, CommerceTransactionError>;
}
export interface PreparedLocalGraph {
  readonly entities: readonly string[];
  readonly bind: (context: AtomicCommerceContext) => LocalGraphQuery;
}
export interface GraphParticipant {
  readonly participant: AtomicCommerceParticipant;
  readonly module: GraphModuleDefinition;
}
export interface GraphReadSelection {
  readonly participant: AtomicCommerceParticipant;
  readonly read: GraphReadDefinition;
}
