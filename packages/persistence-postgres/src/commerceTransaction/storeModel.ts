import type { LogicalRelationalStore } from "../logicalDocuments/model";
import type { CommerceTransactionError } from "./model";

export type CommerceStore = LogicalRelationalStore<CommerceTransactionError>;
