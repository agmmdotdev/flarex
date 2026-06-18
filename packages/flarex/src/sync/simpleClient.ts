export type OnUpdateOptions = {
  partitionKey: string;
  journal?: string | null;
};

export type Watch<T> = {
  onUpdate(callback: () => void): () => void;
  localQueryResult(): T | undefined;
};

export type Unsubscribe<T> = (() => void) & {
  unsubscribe(): void;
  getCurrentValue(): T | undefined;
};
