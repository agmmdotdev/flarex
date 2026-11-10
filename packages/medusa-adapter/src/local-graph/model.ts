import type { Effect, Result } from "effect";
import type { AtomicCommerceContext, AtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceTransactionError, Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ReadTable } from "../query/catalog";
import type { GraphPresentation } from "./presentation";
export type { GraphPresentation } from "./presentation";
import type { GraphReadCommand } from "./commands";
import type { GraphRemotePath, GraphLinkEndpoint } from "./links";
import type { GraphDirectPath } from "./direct-paths";
export type { GraphRemotePath, GraphRemotePathSelection } from "./links";

export interface GraphRelationPath {
  readonly path: string;
  readonly table: ReadTable;
  /** Authenticated computed output names; never stored key or join evidence. */
  readonly presentation?: GraphPresentation;
  readonly many: boolean;
  /** A service-owned absent to-one value, not an arbitrary missing response. */
  readonly optional?: boolean;
  /** Source join columns from the module's checked relationship catalog. */
  readonly sourceFields?: readonly string[];
  /** Native joins retain the actual target join columns, which need not be
   * the row's primary key (for example a rich Link's parent foreign key). */
  readonly targetFields?: readonly string[];
  /** Native graph forwarding retains this selected edge's actual join keys. */
  readonly nativeFields?: true;
}

interface GraphReadMetadata {
  readonly model: string;
  readonly command: GraphReadCommand;
  readonly table: ReadTable;
  /** Authenticated computed output names; never stored key or join evidence. */
  readonly presentation?: GraphPresentation;
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
  /** Selected native Query profiles retain their actual hydration join keys. */
  readonly nativeFields?: true;
  /** Explicit nonpersistent presentation names. Missing values stay omitted;
   * persisted columns still require complete read evidence. */
  readonly optionalFields?: readonly string[];
}
/** Counted graph pages and native list selections are different capabilities.
 * A list result never supplies metadata for a counted page or Link traversal. */
export type GraphReadDefinition = GraphReadMetadata & ({
  readonly result?: "count";
  readonly decode: (value: Json) => Result.Result<readonly [readonly JsonObject[], number], CommerceTransactionError>;
} | {
  readonly result: "list";
  readonly decode: (value: Json) => Result.Result<readonly JsonObject[], CommerceTransactionError>;
});

export interface GraphModuleDefinition {
  readonly aliases: readonly { readonly name: string; readonly model: string }[];
  /** Native Link service identities are distinct from public entity aliases. */
  readonly services?: readonly { readonly name: string; readonly model: string }[];
  readonly reads: readonly GraphReadDefinition[];
  readonly remotePaths?: readonly GraphRemotePath[];
  readonly linkEndpoints?: readonly GraphLinkEndpoint[];
  readonly directPaths?: readonly GraphDirectPath[];
}

export type LocalGraphResult = {
  readonly data: readonly JsonObject[];
  readonly metadata: { readonly count: number; readonly skip: number; readonly take: number };
};

/** Explicit per-transaction instance; several module sets can coexist. */
export interface LocalGraphQuery {
  readonly graph: (input: unknown, options?: unknown) => Effect.Effect<LocalGraphResult, CommerceTransactionError>;
  readonly service: (input: unknown) => Effect.Effect<LocalGraphResult, CommerceTransactionError>;
  /** Callable RemoteQuery retains the native join fields used by its plan. */
  readonly native: (input: unknown) => Effect.Effect<LocalGraphResult, CommerceTransactionError>;
  /** Count-free selected native list ABI; pagination and remote joins refuse. */
  readonly list: (input: unknown) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
}
export interface PreparedLocalGraph {
  readonly entities: readonly string[];
  /** Validate a counted graph projection without binding or reading storage. */
  readonly admitProjection: (entity: string, fields: readonly string[]) => Result.Result<void, CommerceTransactionError>;
  readonly bind: <Context extends GraphReadContext>(context: Context) => LocalGraphQuery;
}
/** Both workflow roots and protected HTTP read groups provide exactly these
 * capabilities. Graph planning never needs events or settlement authority. */
export type GraphReadContext = Pick<AtomicCommerceContext, "call" | "refuse" | "recordFailure">;
export interface GraphParticipant {
  readonly participant: AtomicCommerceParticipant;
  readonly module: GraphModuleDefinition;
}
export interface GraphReadSelection {
  readonly participant: AtomicCommerceParticipant;
  readonly read: GraphReadDefinition;
}
