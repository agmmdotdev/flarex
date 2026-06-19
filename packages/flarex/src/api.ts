import type { RegisteredFunction } from "./server";

export const functionName = Symbol.for("flarex.functionName");

export type FunctionType = "query" | "mutation" | "workflowMutation" | "action";
export type FunctionVisibility = "public" | "internal";
export type FunctionRoutePolicy = { type: "args"; field: string };
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
export type FunctionPartitionInputPolicy =
  | FunctionPartitionPolicy
  | FunctionPartitionRootPolicy;
export type FunctionRouteMap = Record<string, FunctionRoutePolicy | null | undefined>;
export type FunctionReferenceMetadata = {
  route?: FunctionRoutePolicy | null;
  partition?: FunctionPartitionPolicy | null;
};
export type FunctionReferenceMetadataMap = Record<
  string,
  FunctionRoutePolicy | FunctionReferenceMetadata | null | undefined
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
  readonly _route?: FunctionRoutePolicy | null;
  readonly _partition?: FunctionPartitionPolicy | null;
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
  route?: FunctionRoutePolicy | null,
  partition?: FunctionPartitionPolicy | null,
): FunctionReference<Type, "public", Args, ReturnType> {
  return {
    _path: name,
    ...(kind === undefined ? {} : { _kind: kind }),
    ...(route === undefined ? {} : { _route: route }),
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
  UnionToIntersection<
    {
      [Path in keyof Modules]: ApiForModule<Path & string, Modules[Path]>;
    }[keyof Modules]
  >;

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
      if (property === "_route") {
        return metadataForPath(metadataByPath, functionPath(path)).route;
      }
      if (property === "_partition") {
        return metadataForPath(metadataByPath, functionPath(path)).partition;
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

function metadataForPath(
  metadataByPath: FunctionReferenceMetadataMap,
  path: string,
): Required<FunctionReferenceMetadata> {
  const metadata = metadataByPath[path];
  if (metadata === undefined || metadata === null) return { route: null, partition: null };
  if (isFunctionRoutePolicy(metadata)) {
    return { route: metadata, partition: null };
  }
  return {
    route: metadata.route ?? null,
    partition: metadata.partition ?? null,
  };
}

function isFunctionRoutePolicy(
  metadata: FunctionRoutePolicy | FunctionReferenceMetadata,
): metadata is FunctionRoutePolicy {
  return "type" in metadata && metadata.type === "args";
}
