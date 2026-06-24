export type LiveQueryDeliveryJson =
  | null
  | boolean
  | number
  | string
  | LiveQueryDeliveryJson[]
  | { [key: string]: LiveQueryDeliveryJson };

export type LiveQueryDeliveryUpdatedChange = {
  kind: "updated";
  deploymentId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: LiveQueryDeliveryJson;
  resultJson: LiveQueryDeliveryJson;
  previousResultHash: string;
  resultHash: string;
};

export type LiveQueryDeliveryFailedChange = {
  kind: "failed";
  deploymentId: string;
  connectionId: string;
  queryId: number;
  functionPath: string;
  argsJson: LiveQueryDeliveryJson;
  previousResultHash: string;
  errorMessage: string;
  errorData: LiveQueryDeliveryJson | null;
};

export type LiveQueryDeliveryChange =
  | LiveQueryDeliveryUpdatedChange
  | LiveQueryDeliveryFailedChange;
