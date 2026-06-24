import type { RegisteredFunction } from "./server";

export const functionName = Symbol.for("flarex.functionName");

export type FunctionType = "query" | "mutation" | "workflowMutation" | "action";
export type FunctionVisibility = "public" | "internal";
export type FunctionPartitionPolicy = {
  type: "partition";
  table: string;
  selector: string;
  partitionField: string;
  argField: string;
};
export type FunctionPartitionRootPolicy = {
  type: "partitionRoot";
  table: string;
  partitionField: string;
};
export type FunctionPartitionCreateRootPolicy = {
  type: "partitionCreateRoot";
  table: string;
  partitionField: "_id";
};
export type FunctionReferencePartitionPolicy =
  | FunctionPartitionPolicy
  | FunctionPartitionCreateRootPolicy;
export type FunctionPartitionInputPolicy =
  | FunctionPartitionPolicy
  | FunctionPartitionRootPolicy;
export type FunctionReferenceMetadata = {
  partition?: FunctionReferencePartitionPolicy | null;
};
export type FunctionReferenceMetadataMap = Record<
  string,
  FunctionReferenceMetadata | FunctionReferencePartitionPolicy | null | undefined
>;

export type FunctionReference<
  Type extends FunctionType = FunctionType,
  Visibility extends FunctionVisibility = "public",
  Args extends Record<string, unknown> = Record<string, unknown>,
  ReturnType = unknown,
> = {
  readonly _path: string;
  readonly _kind?: Type;
  readonly _visibility?: Visibility;
  readonly _partition?: FunctionReferencePartitionPolicy | null;
  readonly [functionName]?: string;
  readonly __args?: Args;
  readonly __returnType?: ReturnType;
};

export type AnyFunctionReference = FunctionReference<any, any, any, any>;
export type FunctionArgs<Reference extends AnyFunctionReference> =
  Reference extends FunctionReference<any, any, infer Args, any> ? Args : never;
export type FunctionReturnType<Reference extends AnyFunctionReference> =
  Reference extends FunctionReference<any, any, any, infer ReturnType> ? ReturnType : never;

export function getFunctionName(reference: AnyFunctionReference | string): string {
  if (typeof reference === "string") return reference;
  const name = reference._path ?? reference[functionName];
  if (name === undefined) {
    throw new Error(`${String(reference)} is not a Flarex function reference.`);
  }
  return name;
}

export function makeFunctionReference<
  Type extends FunctionType,
  Args extends Record<string, unknown> = Record<string, unknown>,
  ReturnType = unknown,
>(
  name: string,
  kind?: Type,
  partition?: FunctionReferencePartitionPolicy | null,
): FunctionReference<Type, "public", Args, ReturnType> {
  return {
    _path: name,
    ...(kind === undefined ? {} : { _kind: kind }),
    ...(partition === undefined ? {} : { _partition: partition }),
    [functionName]: name,
  } as FunctionReference<Type, "public", Args, ReturnType>;
}

export type FunctionReferenceFromExport<Export> =
  Export extends RegisteredFunction<
    infer Kind,
    infer Visibility,
    infer Args,
    infer ReturnType
  >
    ? FunctionReference<Kind, Visibility, Args, Awaited<ReturnType>>
    : never;

type FunctionReferencesInModule<Module extends Record<string, unknown>> = {
  [Name in keyof Module as Module[Name] extends RegisteredFunction<any, any, any, any>
    ? Name
    : never]: FunctionReferenceFromExport<Module[Name]>;
};

type ApiForModule<Path extends string, Module extends Record<string, unknown>> =
  Path extends `${infer Directory}/${infer Rest}`
    ? { [Name in Directory]: ApiForModule<Rest, Module> }
    : { [Name in Path]: FunctionReferencesInModule<Module> };

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export type ApiFromModules<Modules extends Record<string, Record<string, unknown>>> =
  FilterApi<
    UnionToIntersection<
      {
        [Path in keyof Modules]: ApiForModule<Path & string, Modules[Path]>;
      }[keyof Modules]
    >,
    AnyFunctionReference
  >;

type FilterKeysInApi<Key, API, Predicate> =
  API extends Predicate
    ? Key
    : API extends AnyFunctionReference
      ? never
      : FilterApi<API, Predicate> extends Record<string, never>
        ? never
        : Key;

export type FilterApi<API, Predicate> = {
  [Key in keyof API as FilterKeysInApi<Key, API[Key], Predicate>]:
    API[Key] extends Predicate ? API[Key] : FilterApi<API[Key], Predicate>;
};

export function filterApi<API, Predicate>(api: API): FilterApi<API, Predicate> {
  return api as FilterApi<API, Predicate>;
}

export function justPublic<API>(
  api: API,
): FilterApi<API, FunctionReference<FunctionType, "public">> {
  return filterApi(api);
}

export function justInternal<API>(
  api: API,
): FilterApi<API, FunctionReference<FunctionType, "internal">> {
  return filterApi(api);
}

type AnyApiNode = { [name: string]: AnyApiNode } & AnyFunctionReference;
export type AnyApi = Record<string, AnyApiNode>;

export function createApi(
  metadataByPath: FunctionReferenceMetadataMap = {},
  path: string[] = [],
): AnyApiNode {
  return new Proxy({} as AnyApiNode, {
    get(_, property: string | symbol) {
      if (property === functionName || property === "_path") {
        return functionPath(path);
      }
      if (property === "_partition") {
        return partitionForPath(metadataByPath, functionPath(path));
      }
      if (property === Symbol.toStringTag) return "FunctionReference";
      if (typeof property === "string") return createApi(metadataByPath, [...path, property]);
      return undefined;
    },
  });
}

export const anyApi: AnyApi = createApi() as AnyApi;

function functionPath(path: string[]): string {
  if (path.length < 2) {
    throw new Error("Function references must have the form api.module.function.");
  }
  const exportName = path.at(-1)!;
  const moduleName = path.slice(0, -1).join("/");
  return exportName === "default" ? moduleName : `${moduleName}:${exportName}`;
}

function partitionForPath(
  metadataByPath: FunctionReferenceMetadataMap,
  path: string,
): FunctionReferencePartitionPolicy | null {
  const metadata = metadataByPath[path];
  if (metadata === undefined || metadata === null) return null;
  if ("type" in metadata) return metadata;
  return metadata.partition ?? null;
}
