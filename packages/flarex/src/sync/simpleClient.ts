export type OnUpdateOptions = {
  partitionKey: string;
  journal?: string | null;
};

export type Unsubscribe<T> = (() => void) & {
  unsubscribe(): void;
  getCurrentValue(): T | undefined;
};
