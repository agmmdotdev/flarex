import type { Id } from "./values";

export type GenericDocument = Record<string, any>;
export type GenericTableInfo = {
  document: GenericDocument;
  fieldPaths: string;
  indexes: Record<string, readonly string[]>;
};
export type GenericDataModel = Record<string, GenericTableInfo>;
export type AnyDataModel = Record<
  string,
  {
    document: any;
    fieldPaths: string;
    indexes: Record<string, readonly string[]>;
  }
>;
export type TableNamesInDataModel<DataModel extends GenericDataModel> = keyof DataModel & string;
export type DocumentByName<
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>,
> = DataModel[TableName]["document"];
export type NamedTableInfo<
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>,
> = DataModel[TableName];
export type IndexNames<TableInfo extends GenericTableInfo> = keyof TableInfo["indexes"] & string;
export type NamedIndex<
  TableInfo extends GenericTableInfo,
  IndexName extends IndexNames<TableInfo>,
> = TableInfo["indexes"][IndexName];
export type FieldTypeFromFieldPath<
  Document extends GenericDocument,
  Path extends string,
> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Document
    ? NonNullable<Document[Head]> extends GenericDocument
      ? FieldTypeFromFieldPath<NonNullable<Document[Head]>, Tail>
      : never
    : never
  : Path extends keyof Document
    ? Document[Path]
    : never;
export type WithoutSystemFields<Document extends GenericDocument> = Omit<
  Document,
  "_id" | "_creationTime"
>;
export type SystemFields<TableName extends string> = {
  _id: Id<TableName>;
  _creationTime: number;
};
