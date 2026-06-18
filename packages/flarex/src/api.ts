import type { RegisteredFunction } from "./server";

export const functionName = Symbol.for("flarex.functionName");

export type FunctionType = "query" | "mutation" | "workflowMutation" | "action";
export type FunctionVisibility = "public" | "internal";
export type FunctionRoutePolicy = { type: "args"; field: string };
export type FunctionRouteMap = Record<string, FunctionRoutePolicy | null | undefined>;

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
): FunctionReference<Type, "public", Args, ReturnType> {
  return {
    _path: name,
    ...(kind === undefined ? {} : { _kind: kind }),
    ...(route === undefined ? {} : { _route: route }),
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

export function createApi(routeByPath: FunctionRouteMap = {}, path: string[] = []): AnyApiNode {
  return new Proxy({} as AnyApiNode, {
    get(_, property: string | symbol) {
      if (property === functionName || property === "_path") {
        return functionPath(path);
      }
      if (property === "_route") {
        return routeByPath[functionPath(path)] ?? null;
      }
      if (property === Symbol.toStringTag) return "FunctionReference";
      if (typeof property === "string") return createApi(routeByPath, [...path, property]);
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
