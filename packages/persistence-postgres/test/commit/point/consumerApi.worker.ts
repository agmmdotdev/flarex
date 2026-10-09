import * as point from "@flarex/persistence-postgres/point-commit-transaction";

export default {
  fetch() {
    const copiedPort = Object.freeze({});
    return Response.json({
      exports: Object.keys(point).sort(),
      copiedPublisher: point.isPointFiniteCommitPublisherPort(copiedPort),
      copiedDeveloperMaintenance: point.hasPointCommitDeveloperIndexMaintenanceV1(copiedPort),
      copiedUniqueMaintenance: point.hasPointCommitUniqueConstraintMaintenanceV1(copiedPort),
      copiedUniqueEligibility: point.hasPointCommitUniqueConstraintEligibilityV1(copiedPort),
      copiedRelationMaintenance: point.hasPointCommitApplicationRelationMaintenance(copiedPort),
      error: new point.PointCommitUniqueConstraintEligibilityUnavailableV1Error({ reason: "notSameFactory" })._tag,
    });
  },
};
