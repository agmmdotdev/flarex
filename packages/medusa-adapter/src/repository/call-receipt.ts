import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";

/** Receipt mechanics operate after the module owner authenticates the command.
 * This type deliberately carries no native-command provenance claim. */
export type LogicalCallReceiptValidation = (call: Parameters<LogicalCommerceCallValidation>[0],
  activity: Parameters<LogicalCommerceCallValidation>[1]) => ReturnType<LogicalCommerceCallValidation>;
