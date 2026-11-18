import type { LogicalRelationalStore } from "../../storage/documents/logicalDocuments/model";
import type { CommerceTransactionError } from "./model";

export type CommerceStore = LogicalRelationalStore<CommerceTransactionError>;
