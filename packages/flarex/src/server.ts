import { asObjectValidator } from "./values";
import type {
  GenericValidator,
  Id,
  Infer,
  ObjectType,
  PropertyValidators,
  Validator,
} from "./values";
import type {
  AnyDataModel,
  DocumentByName,
  GenericDataModel,
  NamedTableInfo,
  TableNamesInDataModel,
  WithoutSystemFields,
} from "./dataModel";
import type { QueryInitializer } from "./query";
import type {
  AnyFunctionReference,
  FunctionReference,
  FunctionType,
  FunctionVisibility,
} from "./api";

export type FunctionValidators = Record<string, Validator<unknown>>;
export type FunctionKind = FunctionType;

type TableFromId<Identifier> = Identifier extends Id<infer Table> ? Table : never;

export type DatabaseReader<DataModel extends GenericDataModel = AnyDataModel> = {
  get<Identifier extends Id<TableNamesInDataModel<DataModel>>>(
    id: Identifier,
  ): Promise<DocumentByName<DataModel, TableFromId<Identifier>> | null>;
  query<Table extends TableNamesInDataModel<DataModel>>(
    table: Table,
  ): QueryInitializer<NamedTableInfo<DataModel, Table>>;
};

export type DatabaseWriter<DataModel extends GenericDataModel = AnyDataModel> =
  DatabaseReader<DataModel> & {
  insert<Table extends TableNamesInDataModel<DataModel>>(
    table: Table,
    value: WithoutSystemFields<DocumentByName<DataModel, Table>>,
  ): Promise<Id<Table>>;
  patch<Table extends TableNamesInDataModel<DataModel>>(
    id: Id<Table>,
    value: Partial<WithoutSystemFields<DocumentByName<DataModel, Table>>>,
  ): Promise<void>;
  delete<Table extends TableNamesInDataModel<DataModel>>(id: Id<Table>): Promise<void>;
};

export type QueryCtx<DataModel extends GenericDataModel = AnyDataModel> = {
  db: DatabaseReader<DataModel>;
};
export type MutationCtx<DataModel extends GenericDataModel = AnyDataModel> = {
  db: DatabaseWriter<DataModel>;
};
export type ActionCtx<DataModel extends GenericDataModel = AnyDataModel> = {
  runQuery: (reference: AnyFunctionReference, args: unknown) => Promise<unknown>;
  runMutation: (reference: AnyFunctionReference, args: unknown) => Promise<unknown>;
};

export type RegisteredFunction<
  Kind extends FunctionKind = FunctionKind,
  Visibility extends FunctionVisibility = FunctionVisibility,
  Args extends Record<string, unknown> = Record<string, unknown>,
  ReturnType = unknown,
> = {
  readonly __flarexFunction: true;
  readonly kind: Kind;
  readonly visibility: Visibility;
  readonly args: FunctionValidators;
  readonly returns: GenericValidator | null;
  readonly handler: (ctx: never, args: never) => ReturnType;
  readonly __args?: Args;
};

type ValidatedArgs<Args extends FunctionValidators> = { [K in keyof Args]: Infer<Args[K]> };
type DefinedReturnValidator = GenericValidator | PropertyValidators;
type MaybePromise<Value> = Value | Promise<Value>;
type ReturnValueForValidator<Returns extends DefinedReturnValidator> =
  Returns extends GenericValidator ? Infer<Returns> :
  Returns extends PropertyValidators ? ObjectType<Returns> :
  never;

type FunctionConfigWithoutReturns<Ctx, Args extends FunctionValidators, HandlerReturn> = {
  args: Args;
  returns?: undefined;
  handler: (ctx: Ctx, args: ValidatedArgs<Args>) => HandlerReturn;
};

type FunctionConfigWithReturns<
  Ctx,
  Args extends FunctionValidators,
  Returns extends DefinedReturnValidator,
  HandlerReturn extends MaybePromise<ReturnValueForValidator<Returns>>,
> = {
  args: Args;
  returns: Returns;
  handler: (ctx: Ctx, args: ValidatedArgs<Args>) => HandlerReturn;
};

type AnyFunctionConfig<Ctx, Args extends FunctionValidators> =
  | FunctionConfigWithoutReturns<Ctx, Args, unknown>
  | FunctionConfigWithReturns<Ctx, Args, DefinedReturnValidator, MaybePromise<unknown>>;

function register<
  Kind extends FunctionKind,
  Visibility extends FunctionVisibility,
  Ctx,
  Args extends FunctionValidators,
>(
  kind: Kind,
  visibility: Visibility,
  config: AnyFunctionConfig<Ctx, Args>,
): RegisteredFunction<Kind, Visibility, ValidatedArgs<Args>, unknown> {
  const returns = config.returns === undefined ? null : asObjectValidator(config.returns);
  return {
    __flarexFunction: true,
    kind,
    visibility,
    args: config.args,
    returns,
    handler: config.handler as RegisteredFunction<Kind, Visibility, ValidatedArgs<Args>, unknown>["handler"],
  };
}

export type QueryBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
> = {
  <Args extends FunctionValidators, HandlerReturn>(
    config: FunctionConfigWithoutReturns<QueryCtx<DataModel>, Args, HandlerReturn>,
  ): RegisteredFunction<"query", Visibility, ValidatedArgs<Args>, HandlerReturn>;
  <
    Args extends FunctionValidators,
    Returns extends DefinedReturnValidator,
    HandlerReturn extends MaybePromise<ReturnValueForValidator<Returns>>,
  >(
    config: FunctionConfigWithReturns<QueryCtx<DataModel>, Args, Returns, HandlerReturn>,
  ): RegisteredFunction<"query", Visibility, ValidatedArgs<Args>, HandlerReturn>;
};

export type MutationBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  Kind extends "mutation" | "workflowMutation" = "mutation",
> = {
  <Args extends FunctionValidators, HandlerReturn>(
    config: FunctionConfigWithoutReturns<MutationCtx<DataModel>, Args, HandlerReturn>,
  ): RegisteredFunction<Kind, Visibility, ValidatedArgs<Args>, HandlerReturn>;
  <
    Args extends FunctionValidators,
    Returns extends DefinedReturnValidator,
    HandlerReturn extends MaybePromise<ReturnValueForValidator<Returns>>,
  >(
    config: FunctionConfigWithReturns<MutationCtx<DataModel>, Args, Returns, HandlerReturn>,
  ): RegisteredFunction<Kind, Visibility, ValidatedArgs<Args>, HandlerReturn>;
};

export type ActionBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
> = {
  <Args extends FunctionValidators, HandlerReturn>(
    config: FunctionConfigWithoutReturns<ActionCtx<DataModel>, Args, HandlerReturn>,
  ): RegisteredFunction<"action", Visibility, ValidatedArgs<Args>, HandlerReturn>;
  <
    Args extends FunctionValidators,
    Returns extends DefinedReturnValidator,
    HandlerReturn extends MaybePromise<ReturnValueForValidator<Returns>>,
  >(
    config: FunctionConfigWithReturns<ActionCtx<DataModel>, Args, Returns, HandlerReturn>,
  ): RegisteredFunction<"action", Visibility, ValidatedArgs<Args>, HandlerReturn>;
};

export const queryGeneric = ((config: AnyFunctionConfig<QueryCtx<AnyDataModel>, FunctionValidators>) =>
  register("query", "public", config)) as QueryBuilder<AnyDataModel, "public">;
export const internalQueryGeneric = ((
  config: AnyFunctionConfig<QueryCtx<AnyDataModel>, FunctionValidators>,
) => register("query", "internal", config)) as QueryBuilder<AnyDataModel, "internal">;
export const mutationGeneric = ((
  config: AnyFunctionConfig<MutationCtx<AnyDataModel>, FunctionValidators>,
) => register("mutation", "public", config)) as MutationBuilder<AnyDataModel, "public">;
export const internalMutationGeneric = ((
  config: AnyFunctionConfig<MutationCtx<AnyDataModel>, FunctionValidators>,
) => register("mutation", "internal", config)) as MutationBuilder<AnyDataModel, "internal">;
export const workflowMutationGeneric: MutationBuilder<
  AnyDataModel,
  "public",
  "workflowMutation"
> = ((config: AnyFunctionConfig<MutationCtx<AnyDataModel>, FunctionValidators>) =>
  register("workflowMutation", "public", config)) as MutationBuilder<
  AnyDataModel,
  "public",
  "workflowMutation"
>;
export const actionGeneric = ((config: AnyFunctionConfig<ActionCtx<AnyDataModel>, FunctionValidators>) =>
  register("action", "public", config)) as ActionBuilder<AnyDataModel, "public">;

export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const workflowMutation = workflowMutationGeneric;
export const action = actionGeneric;

export {
  anyApi,
  functionName,
  getFunctionName,
  makeFunctionReference,
} from "./api";
export {
  encodeFlarexId,
  isFlarexIdForTable,
  parseFlarexId,
  requireFlarexId,
} from "./ids";
export { createQueryInitializer, paginationOptsValidator } from "./query";
export type { ParsedFlarexId } from "./ids";
export type {
  DatabaseQueryExecutor,
  DatabaseQueryRequest,
  IndexRange,
  IndexRangeBuilder,
  OrderedQuery,
  PaginationOptions,
  PaginationResult,
  QueryInitializer,
} from "./query";
export type {
  AnyApi,
  AnyFunctionReference,
  ApiFromModules,
  FunctionReference,
  FunctionReferenceFromExport,
  FunctionArgs,
  FunctionReturnType,
  FunctionType,
  FunctionVisibility,
} from "./api";
export { defineProjection, defineSchema, defineTable } from "./schema";
export {
  functionArgsToValidatorJson,
  validateFunctionArgs,
  validateValue,
  validatorToJson,
  ValidationError,
} from "./validation";
export type {
  DataModelFromSchemaDefinition,
  ProjectionDefinition,
  SchemaDefinition,
  TableDefinition,
} from "./schema";
export type {
  AnyDataModel,
  DocumentByName,
  GenericDataModel,
  GenericDocument,
  IndexNames,
  NamedIndex,
  NamedTableInfo,
  TableNamesInDataModel,
  WithoutSystemFields,
} from "./dataModel";
