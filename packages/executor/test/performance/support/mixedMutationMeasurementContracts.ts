/** Original owner demands, captured after the timed request. Counts here are
 * evidence observations, never net committed-row deltas. */
export interface PerformanceSettlementLedger {
  readonly syscallReceipts: number;
  readonly observedDocuments: number;
  readonly admittedRangeDemands: number;
  readonly admittedPageDemands: number;
  readonly admittedUniqueDemands: number;
  readonly admittedRangeEntryOccurrences: number;
  readonly admittedPageEntryOccurrences: number;
  readonly admittedIndexDefinitionDemands: number;
  readonly admittedConstraintDefinitionDemands: number;
  readonly distinctAdmittedIndexDefinitions: number;
  readonly distinctAdmittedConstraintDefinitions: number;
  readonly publicationQueries: readonly Readonly<{ ownerQuery: string; dispatches: number;
    parameterCount: number; scalarParameterBytes: number; unknownEncodingParameters: number }>[];
  readonly pointDependencies: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencies: number;
  readonly relationReadSyscalls: number;
  readonly relationDependencies: number;
  readonly finalRows: number;
  readonly bytes: Readonly<Record<string, number>>;
  readonly unavailable: readonly string[];
}
