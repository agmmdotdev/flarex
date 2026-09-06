import type { GenericDataModel, TableNamesInDataModel } from "./dataModel";
import type { MutationCtxForTables } from "./server";

/** Private generated-authoring input; runtime authority comes from the activated policy. */
type TablePolicy = Readonly<{ logicalTableName: string; owner: "application" | "payload" }>;

export type ApplicationMutationCtxForWritePolicies<
  DataModel extends GenericDataModel,
  Policies extends ReadonlyArray<TablePolicy>,
> = MutationCtxForTables<DataModel, Extract<
  Extract<Policies[number], { readonly owner: "application" }>["logicalTableName"],
  TableNamesInDataModel<DataModel>
>>;
