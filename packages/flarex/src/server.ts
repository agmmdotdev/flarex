import { isValidator, v } from "./values";
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
  FunctionPartitionInputPolicy,
  FunctionPartitionPolicy,
  FunctionPartitionRootPolicy,
  FunctionReference,
  FunctionType,
  FunctionVisibility,
} from "./api";

export type FunctionValidators = PropertyValidators;
export type FunctionArgsValidator =
  | Validator<any, "required", any>
  | FunctionValidators;
export type FunctionKind = FunctionType;
export type DefaultFunctionArgs = Record<string, unknown>;

type FunctionPartitionInput = FunctionPartitionInputPolicy;

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
  replace<Table extends TableNamesInDataModel<DataModel>>(
    id: Id<Table>,
    value: WithoutSystemFields<DocumentByName<DataModel, Table>>,
  ): Promise<void>;
  delete<Table extends TableNamesInDataModel<DataModel>>(id: Id<Table>): Promise<void>;
};

export type DatabaseWriterForTables<
  DataModel extends GenericDataModel = AnyDataModel,
  WritableTables extends TableNamesInDataModel<DataModel> =
    TableNamesInDataModel<DataModel>,
> =
  DatabaseReader<DataModel> & {
  insert<Table extends WritableTables>(
    table: Table,
    value: WithoutSystemFields<DocumentByName<DataModel, Table>>,
  ): Promise<Id<Table>>;
  patch<Table extends WritableTables>(
    id: Id<Table>,
    value: Partial<WithoutSystemFields<DocumentByName<DataModel, Table>>>,
  ): Promise<void>;
  replace<Table extends WritableTables>(
    id: Id<Table>,
    value: WithoutSystemFields<DocumentByName<DataModel, Table>>,
  ): Promise<void>;
  delete<Table extends WritableTables>(id: Id<Table>): Promise<void>;
};

export type PartitionScopeMap<DataModel extends GenericDataModel> = Partial<
  Record<TableNamesInDataModel<DataModel>, TableNamesInDataModel<DataModel>>
>;
export type DefaultPartitionScopeMap<DataModel extends GenericDataModel> = Record<
  TableNamesInDataModel<DataModel>,
  TableNamesInDataModel<DataModel>
>;
type WritableTablesForPartition<
  DataModel extends GenericDataModel,
  Scopes extends PartitionScopeMap<DataModel>,
  Partition,
> = Partition extends { table: infer Table }
  ? Table extends keyof Scopes
    ? Extract<Scopes[Table], TableNamesInDataModel<DataModel>>
    : TableNamesInDataModel<DataModel>
  : TableNamesInDataModel<DataModel>;

export type QueryCtx<DataModel extends GenericDataModel = AnyDataModel> = {
  db: DatabaseReader<DataModel>;
};
export type MutationCtx<DataModel extends GenericDataModel = AnyDataModel> = {
  db: DatabaseWriter<DataModel>;
};
export type MutationCtxForTables<
  DataModel extends GenericDataModel = AnyDataModel,
  WritableTables extends TableNamesInDataModel<DataModel> =
    TableNamesInDataModel<DataModel>,
> = {
  db: DatabaseWriterForTables<DataModel, WritableTables>;
};
export type MutationCtxForPartition<
  DataModel extends GenericDataModel,
  Scopes extends PartitionScopeMap<DataModel>,
  Partition,
> = MutationCtxForTables<
  DataModel,
  WritableTablesForPartition<DataModel, Scopes, Partition>
>;
export type ActionCtx<DataModel extends GenericDataModel = AnyDataModel> = {
  runQuery: (reference: AnyFunctionReference, args: unknown) => Promise<unknown>;
  runMutation: (reference: AnyFunctionReference, args: unknown) => Promise<unknown>;
};

export type RegisteredFunction<
  Kind extends FunctionKind = FunctionKind,
  Visibility extends FunctionVisibility = FunctionVisibility,
  Args extends DefaultFunctionArgs = DefaultFunctionArgs,
  ReturnType = unknown,
> = {
  readonly __flarexFunction: true;
  readonly isFlarexFunction: true;
  readonly kind: Kind;
  readonly visibility: Visibility;
  readonly args: FunctionArgsValidator;
  readonly returns: DefinedReturnValidator | null;
  readonly partition: FunctionPartitionInputPolicy | null;
  readonly handler: (ctx: never, args: never) => ReturnType;
  readonly exportArgs: () => string;
  readonly exportReturns: () => string;
  readonly exportPartition: () => string;
  readonly _handler: (ctx: never, args: never) => ReturnType;
  readonly __args?: Args;
} & KindProperties<Kind> & VisibilityProperties<Visibility>;

type KindProperties<Kind extends FunctionKind> =
  Kind extends "query" ? { readonly isQuery: true } :
  Kind extends "mutation" ? { readonly isMutation: true } :
  Kind extends "workflowMutation" ? { readonly isWorkflowMutation: true } :
  Kind extends "action" ? { readonly isAction: true } :
  never;

type VisibilityProperties<Visibility extends FunctionVisibility> =
  Visibility extends "public"
    ? { readonly isPublic: true }
    : { readonly isInternal: true };

type DefinedReturnValidator =
  | Validator<any, "required", any>
  | PropertyValidators;
type MaybePromise<Value> = Value | Promise<Value>;
type OneArgArray<Args extends DefaultFunctionArgs = DefaultFunctionArgs> = [Args];
type NoArgsArray = [];
type ArgsArray = OneArgArray | NoArgsArray;
type EmptyObject = Record<string, never>;
type Expand<ObjectType extends DefaultFunctionArgs> = {
  [Key in keyof ObjectType]: ObjectType[Key];
};
type ArgsArrayToObject<Args extends ArgsArray> =
  Args extends OneArgArray<infer ArgsObject> ? Expand<ArgsObject> : EmptyObject;
type ReturnValueForOptionalValidator<
  Returns extends DefinedReturnValidator | void,
> = [Returns] extends [GenericValidator] ? Infer<Extract<Returns, GenericValidator>> :
  [Returns] extends [PropertyValidators] ? ObjectType<Extract<Returns, PropertyValidators>> :
  unknown;
type ArgsArrayForOptionalValidator<
  Args extends FunctionArgsValidator | void,
> = [Args] extends [GenericValidator] ? OneArgArray<Infer<Extract<Args, GenericValidator>>> :
  [Args] extends [PropertyValidators] ? OneArgArray<ObjectType<Extract<Args, PropertyValidators>>> :
  ArgsArray;
type DefaultArgsForOptionalValidator<
  Args extends FunctionArgsValidator | void,
> = [Args] extends [GenericValidator] ? OneArgArray<Infer<Extract<Args, GenericValidator>>> :
  [Args] extends [PropertyValidators] ? OneArgArray<ObjectType<Extract<Args, PropertyValidators>>> :
  OneArgArray;
type FunctionDefinition<Ctx> =
  | ((ctx: Ctx, args: DefaultFunctionArgs) => unknown)
  | {
      args?: FunctionArgsValidator;
      returns?: DefinedReturnValidator;
      partition?: FunctionPartitionInput;
      handler: (ctx: Ctx, args: DefaultFunctionArgs) => unknown;
    };

function strictReplacer(key: string, value: unknown): unknown {
  if (value === undefined) {
    throw new Error(
      `A validator is undefined for field "${key}". ` +
        "This is often caused by circular imports.",
    );
  }
  return value;
}

function exportArgs(functionDefinition: FunctionDefinition<unknown>): () => string {
  return () => {
    const args =
      typeof functionDefinition === "object" && functionDefinition.args !== undefined
        ? validatorJson(functionDefinition.args)
        : v.any().json;
    return JSON.stringify(args, strictReplacer);
  };
}

function exportReturns(functionDefinition: FunctionDefinition<unknown>): () => string {
  return () => {
    const returns =
      typeof functionDefinition === "object" && functionDefinition.returns !== undefined
        ? validatorJson(functionDefinition.returns)
        : null;
    return JSON.stringify(returns, strictReplacer);
  };
}

function exportPartition(functionDefinition: FunctionDefinition<unknown>): () => string {
  return () => {
    const partition =
      typeof functionDefinition === "object" &&
      functionDefinition.partition !== undefined &&
      (functionDefinition.partition.type === "partition" ||
        functionDefinition.partition.type === "partitionRoot")
        ? functionDefinition.partition
        : null;
    return JSON.stringify(partition, strictReplacer);
  };
}

function validatorJson(validator: FunctionArgsValidator | DefinedReturnValidator): unknown {
  if (isValidator(validator)) return validator.json;
  return {
    type: "object",
    value: Object.fromEntries(
      Object.entries(validator).map(([name, field]) => [
        name,
        {
          fieldType: field?.json,
          optional: field?.isOptional === "optional",
        },
      ]),
    ),
  };
}

function register<
  Kind extends FunctionKind,
  Visibility extends FunctionVisibility,
  Ctx,
>(
  kind: Kind,
  visibility: Visibility,
  functionDefinition: FunctionDefinition<Ctx>,
): RegisteredFunction<Kind, Visibility, DefaultFunctionArgs, unknown> {
  const handler =
    typeof functionDefinition === "function"
      ? functionDefinition
      : functionDefinition.handler;
  const args =
    typeof functionDefinition === "object" && functionDefinition.args !== undefined
      ? functionDefinition.args
      : v.any();
  const returns =
    typeof functionDefinition === "object" && functionDefinition.returns !== undefined
      ? functionDefinition.returns
      : null;
  const partition =
    typeof functionDefinition === "object" &&
    functionDefinition.partition !== undefined &&
    (functionDefinition.partition.type === "partition" ||
      functionDefinition.partition.type === "partitionRoot")
      ? functionDefinition.partition
      : null;
  const registered = {
    __flarexFunction: true,
    isFlarexFunction: true,
    kind,
    visibility,
    args,
    returns,
    partition,
    handler,
    _handler: handler,
    exportArgs: exportArgs(functionDefinition as FunctionDefinition<unknown>),
    exportReturns: exportReturns(functionDefinition as FunctionDefinition<unknown>),
    exportPartition: exportPartition(functionDefinition as FunctionDefinition<unknown>),
    ...(kind === "query" ? { isQuery: true } : {}),
    ...(kind === "mutation" ? { isMutation: true } : {}),
    ...(kind === "workflowMutation" ? { isWorkflowMutation: true } : {}),
    ...(kind === "action" ? { isAction: true } : {}),
    ...(visibility === "public" ? { isPublic: true } : { isInternal: true }),
  };
  return registered as unknown as RegisteredFunction<
    Kind,
    Visibility,
    DefaultFunctionArgs,
    unknown
  >;
}

export type QueryBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
> = {
  <
    ArgsValidator extends FunctionArgsValidator | void,
    ReturnsValidator extends DefinedReturnValidator | void,
    ReturnValue extends MaybePromise<ReturnValueForOptionalValidator<ReturnsValidator>> = any,
    OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
      DefaultArgsForOptionalValidator<ArgsValidator>,
  >(
    query:
      | {
          args?: ArgsValidator;
          returns?: ReturnsValidator;
          partition?: FunctionPartitionInput;
          handler: (ctx: QueryCtx<DataModel>, ...args: OneOrZeroArgs) => ReturnValue;
        }
      | ((ctx: QueryCtx<DataModel>, ...args: OneOrZeroArgs) => ReturnValue),
  ): RegisteredFunction<"query", Visibility, ArgsArrayToObject<OneOrZeroArgs>, ReturnValue>;
};

export type MutationBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
  Kind extends "mutation" | "workflowMutation" = "mutation",
  Scopes extends PartitionScopeMap<DataModel> = DefaultPartitionScopeMap<DataModel>,
> = {
  <
    ArgsValidator extends FunctionArgsValidator | void,
    ReturnsValidator extends DefinedReturnValidator | void,
    Partition extends FunctionPartitionPolicy | FunctionPartitionRootPolicy,
    ReturnValue extends MaybePromise<ReturnValueForOptionalValidator<ReturnsValidator>> = any,
    OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
      DefaultArgsForOptionalValidator<ArgsValidator>,
  >(
    mutation: {
      args?: ArgsValidator;
      returns?: ReturnsValidator;
      partition: Partition;
      handler: (
        ctx: MutationCtxForPartition<DataModel, Scopes, Partition>,
        ...args: OneOrZeroArgs
      ) => ReturnValue;
    },
  ): RegisteredFunction<Kind, Visibility, ArgsArrayToObject<OneOrZeroArgs>, ReturnValue>;
  <
    ArgsValidator extends FunctionArgsValidator | void,
    ReturnsValidator extends DefinedReturnValidator | void,
    ReturnValue extends MaybePromise<ReturnValueForOptionalValidator<ReturnsValidator>> = any,
    OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
      DefaultArgsForOptionalValidator<ArgsValidator>,
  >(
    mutation:
      | {
          args?: ArgsValidator;
          returns?: ReturnsValidator;
          handler: (ctx: MutationCtx<DataModel>, ...args: OneOrZeroArgs) => ReturnValue;
        }
      | ((ctx: MutationCtx<DataModel>, ...args: OneOrZeroArgs) => ReturnValue),
  ): RegisteredFunction<Kind, Visibility, ArgsArrayToObject<OneOrZeroArgs>, ReturnValue>;
};

export type ActionBuilder<
  DataModel extends GenericDataModel,
  Visibility extends FunctionVisibility,
> = {
  <
    ArgsValidator extends FunctionArgsValidator | void,
    ReturnsValidator extends DefinedReturnValidator | void,
    ReturnValue extends MaybePromise<ReturnValueForOptionalValidator<ReturnsValidator>> = any,
    OneOrZeroArgs extends ArgsArrayForOptionalValidator<ArgsValidator> =
      DefaultArgsForOptionalValidator<ArgsValidator>,
  >(
    action:
      | {
          args?: ArgsValidator;
          returns?: ReturnsValidator;
          partition?: FunctionPartitionInput;
          handler: (ctx: ActionCtx<DataModel>, ...args: OneOrZeroArgs) => ReturnValue;
        }
      | ((ctx: ActionCtx<DataModel>, ...args: OneOrZeroArgs) => ReturnValue),
  ): RegisteredFunction<"action", Visibility, ArgsArrayToObject<OneOrZeroArgs>, ReturnValue>;
};

export const queryGeneric = ((definition: FunctionDefinition<QueryCtx<AnyDataModel>>) =>
  register("query", "public", definition)) as QueryBuilder<AnyDataModel, "public">;
export const internalQueryGeneric = ((
  definition: FunctionDefinition<QueryCtx<AnyDataModel>>,
) => register("query", "internal", definition)) as QueryBuilder<AnyDataModel, "internal">;
export const mutationGeneric = ((
  definition: FunctionDefinition<MutationCtx<AnyDataModel>>,
) => register("mutation", "public", definition)) as MutationBuilder<AnyDataModel, "public">;
export const internalMutationGeneric = ((
  definition: FunctionDefinition<MutationCtx<AnyDataModel>>,
) => register("mutation", "internal", definition)) as MutationBuilder<AnyDataModel, "internal">;
export const workflowMutationGeneric: MutationBuilder<
  AnyDataModel,
  "public",
  "workflowMutation"
> = ((definition: FunctionDefinition<MutationCtx<AnyDataModel>>) =>
  register("workflowMutation", "public", definition)) as MutationBuilder<
  AnyDataModel,
  "public",
  "workflowMutation"
>;
export const actionGeneric = ((definition: FunctionDefinition<ActionCtx<AnyDataModel>>) =>
  register("action", "public", definition)) as ActionBuilder<AnyDataModel, "public">;
export const internalActionGeneric = ((definition: FunctionDefinition<ActionCtx<AnyDataModel>>) =>
  register("action", "internal", definition)) as ActionBuilder<AnyDataModel, "internal">;

export const query = queryGeneric;
export const internalQuery = internalQueryGeneric;
export const mutation = mutationGeneric;
export const internalMutation = internalMutationGeneric;
export const workflowMutation = workflowMutationGeneric;
export const action = actionGeneric;
export const internalAction = internalActionGeneric;

export {
  anyApi,
  createApi,
  filterApi,
  functionName,
  getFunctionName,
  justInternal,
  justPublic,
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
  DatabaseQueryResult,
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
  FilterApi,
  FunctionReference,
  FunctionReferenceFromExport,
  FunctionArgs,
  FunctionPartitionCreateRootPolicy,
  FunctionPartitionPolicy,
  FunctionReferencePartitionPolicy,
  FunctionPartitionRootPolicy,
  FunctionReturnType,
  FunctionType,
  FunctionVisibility,
} from "./api";
export {
  defineColocatedTable,
  defineGlobalTable,
  definePartitionTable,
  defineProjection,
  defineSchema,
  defineTable,
} from "./schema";
export {
  functionArgsToValidatorJson,
  validateFunctionArgs,
  validateValue,
  validatorToJson,
  ValidationError,
} from "./validation";
export { assertValidatorJson } from "./validatorJson.ts";
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
