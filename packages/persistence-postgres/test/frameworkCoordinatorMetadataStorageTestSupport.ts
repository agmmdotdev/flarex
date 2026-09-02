import { expect } from "vitest";

import type { FlarexSqlClient } from "../src";

export const FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES = [
  "fx_system_framework_migration_admission_assignment",
  "fx_system_framework_migration_attempt_start",
  "fx_system_framework_migration_attempt_terminal",
  "fx_system_framework_migration_collision_domain",
  "fx_system_framework_migration_collision_head",
  "fx_system_framework_migration_event",
  "fx_system_framework_migration_plan",
  "fx_system_framework_migration_plan_admission",
  "fx_system_framework_migration_plan_step",
  "fx_system_framework_migration_plan_step_dependency",
  "fx_system_framework_migration_step_receipt",
  "fx_system_framework_migration_step_receipt_dependency",
  "fx_system_framework_schema_availability_head",
  "fx_system_framework_schema_availability_history",
  "fx_system_framework_schema_installation",
  "fx_system_framework_schema_readiness",
  "fx_system_framework_schema_target_namespace",
  "fx_system_relational_physical_name_assignment",
] as const;

const identitySpecs = [
  [
    "fx_system_framework_migration_attempt_start",
    "attempt_storage_id",
    "fx_framework_migration_attempt_storage_id_seq",
  ],
  [
    "fx_system_framework_migration_attempt_terminal",
    "terminal_storage_id",
    "fx_framework_migration_terminal_storage_id_seq",
  ],
  [
    "fx_system_framework_migration_collision_domain",
    "collision_storage_id",
    "fx_framework_migration_collision_storage_id_seq",
  ],
  [
    "fx_system_framework_migration_event",
    "event_storage_id",
    "fx_framework_migration_event_storage_id_seq",
  ],
  [
    "fx_system_framework_migration_plan",
    "plan_storage_id",
    "fx_framework_migration_plan_storage_id_seq",
  ],
  [
    "fx_system_framework_migration_plan_admission",
    "admission_storage_id",
    "fx_framework_migration_admission_storage_id_seq",
  ],
  [
    "fx_system_framework_migration_step_receipt",
    "receipt_storage_id",
    "fx_framework_migration_receipt_storage_id_seq",
  ],
  [
    "fx_system_framework_schema_availability_history",
    "availability_history_storage_id",
    "fx_framework_availability_history_storage_id_seq",
  ],
  [
    "fx_system_framework_schema_installation",
    "installation_storage_id",
    "fx_framework_installation_storage_id_seq",
  ],
  [
    "fx_system_framework_schema_readiness",
    "readiness_storage_id",
    "fx_framework_readiness_storage_id_seq",
  ],
  [
    "fx_system_framework_schema_target_namespace",
    "target_namespace_storage_id",
    "fx_framework_target_namespace_storage_id_seq",
  ],
  [
    "fx_system_relational_physical_name_assignment",
    "assignment_storage_id",
    "fx_relational_name_assignment_storage_id_seq",
  ],
] as const;

export const FRAMEWORK_COORDINATOR_METADATA_IDENTITY_SEQUENCE_NAMES =
  identitySpecs.map(([, , sequenceName]) => sequenceName).toSorted();

const expectedColumnSignatures = [
  "fx_system_framework_migration_admission_assignment|admission_storage_id:int8:!:-:-,collision_storage_id:int8:!:-:-,assignment_ordinal:int4:!:-:-,assignment_storage_id:int8:!:-:-,spelling:text:!:-:C,assignment_sha256:bytea:!:-:-",
  "fx_system_framework_migration_attempt_start|attempt_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,plan_storage_id:int8:!:-:-,migration_plan_sha256:bytea:!:-:-,admission_storage_id:int8:!:-:-,admission_sha256:bytea:!:-:-,attempt_id:text:!:-:C,attempt_fence:int8:!:-:-,lease_owner_id:text:!:-:C,lease_expires_at:timestamptz:!:-:-,previous_attempt_storage_id:int8:?:-:-,previous_attempt_id:text:?:-:C,attempt_start_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_attempt_terminal|terminal_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,plan_storage_id:int8:!:-:-,attempt_storage_id:int8:!:-:-,admission_storage_id:int8:!:-:-,admission_sha256:bytea:!:-:-,attempt_id:text:!:-:C,attempt_fence:int8:!:-:-,outcome_kind:text:!:-:C,required_step_set_sha256:bytea:?:-:-,failure_reason:text:?:-:C,evidence_sha256:bytea:?:-:-,last_receipt_storage_id:int8:?:-:-,last_step_receipt_sha256:bytea:?:-:-,attempt_terminal_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_collision_domain|collision_storage_id:int8:!:I:-,target_namespace_storage_id:int8:!:-:-,physical_database_identity:text:!:-:C,schema_name:text:!:-:C,owner:text:!:-:C,lineage_id:text:!:-:C,physical_namespace_profile:text:!:-:C",
  "fx_system_framework_migration_collision_head|collision_storage_id:int8:!:-:-,current_plan_storage_id:int8:!:-:-,current_plan_sha256:bytea:!:-:-,current_admission_storage_id:int8:!:-:-,current_admission_sha256:bytea:!:-:-,head_revision:int8:!:-:-,attempt_fence:int8:!:-:-,current_attempt_storage_id:int8:?:-:-,current_attempt_id:text:?:-:C,current_attempt_fence:int8:?:-:-,current_lease_owner_id:text:?:-:C,current_lease_expires_at:timestamptz:?:-:-,last_event_storage_id:int8:?:-:-,last_event_sequence:int8:?:-:-,last_event_sha256:bytea:?:-:-,collision_head_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_event|event_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,event_sequence:int8:!:-:-,event_sha256:bytea:!:-:-,previous_event_storage_id:int8:?:-:-,previous_event_sequence:int8:?:-:-,previous_event_sha256:bytea:?:-:-,event_kind:text:!:-:C,subject_sha256:bytea:?:-:-,lease_attempt_id:text:?:-:C,lease_attempt_fence:int8:?:-:-,lease_owner_id:text:?:-:C,lease_expires_at:timestamptz:?:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_plan|plan_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,artifact_sha256:bytea:!:-:-,locator_kind:text:!:-:C,locator_database_key:text:!:-:C,locator_schema_name:text:!:-:C,migration_plan_sha256:bytea:!:-:-,required_step_set_sha256:bytea:!:-:-,physical_layout_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_plan_admission|admission_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,plan_storage_id:int8:!:-:-,migration_plan_sha256:bytea:!:-:-,previous_plan_storage_id:int8:?:-:-,previous_plan_sha256:bytea:?:-:-,admission_sha256:bytea:!:-:-,admission_profile:text:!:-:C,assignment_count:int4:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_plan_step|plan_storage_id:int8:!:-:-,collision_storage_id:int8:!:-:-,step_ordinal:int4:!:-:-,step_id:text:!:-:C,step_sha256:bytea:!:-:-,precondition_sha256:bytea:!:-:-,postcondition_sha256:bytea:!:-:-,phase:text:!:-:C,operation_format:text:!:-:C,operation_version:int4:!:-:-,dependency_count:int4:!:-:-",
  "fx_system_framework_migration_plan_step_dependency|plan_storage_id:int8:!:-:-,source_step_id:text:!:-:C,dependency_ordinal:int4:!:-:-,dependency_step_id:text:!:-:C,dependency_step_sha256:bytea:!:-:-",
  "fx_system_framework_migration_step_receipt|receipt_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,plan_storage_id:int8:!:-:-,attempt_storage_id:int8:!:-:-,attempt_id:text:!:-:C,attempt_fence:int8:!:-:-,step_id:text:!:-:C,step_sha256:bytea:!:-:-,precondition_sha256:bytea:!:-:-,postcondition_sha256:bytea:!:-:-,observed_postcondition_sha256:bytea:!:-:-,dependency_count:int4:!:-:-,step_receipt_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_migration_step_receipt_dependency|receipt_storage_id:int8:!:-:-,attempt_storage_id:int8:!:-:-,dependency_ordinal:int4:!:-:-,dependency_receipt_storage_id:int8:!:-:-,dependency_step_id:text:!:-:C,dependency_step_receipt_sha256:bytea:!:-:-",
  "fx_system_framework_schema_availability_head|installation_storage_id:int8:!:-:-,readiness_storage_id:int8:!:-:-,availability_history_storage_id:int8:!:-:-,availability_sequence:int8:!:-:-,status:text:!:-:C,history_sha256:bytea:!:-:-,availability_head_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_schema_availability_history|availability_history_storage_id:int8:!:I:-,installation_storage_id:int8:!:-:-,readiness_storage_id:int8:!:-:-,readiness_sha256:bytea:!:-:-,availability_sequence:int8:!:-:-,status:text:!:-:C,reason_sha256:bytea:?:-:-,history_sha256:bytea:!:-:-,previous_history_storage_id:int8:?:-:-,previous_availability_sequence:int8:?:-:-,previous_history_sha256:bytea:?:-:-,previous_status:text:?:-:C,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_schema_installation|installation_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,plan_storage_id:int8:!:-:-,migration_plan_sha256:bytea:!:-:-,admission_storage_id:int8:!:-:-,admission_sha256:bytea:!:-:-,terminal_storage_id:int8:!:-:-,terminal_outcome_kind:text:!:-:C,terminal_sha256:bytea:!:-:-,installation_sha256:bytea:!:-:-,installation_receipt_sha256:bytea:!:-:-,installed_structure_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_schema_readiness|readiness_storage_id:int8:!:I:-,installation_storage_id:int8:!:-:-,installation_sha256:bytea:!:-:-,installation_receipt_sha256:bytea:!:-:-,readiness_sha256:bytea:!:-:-,validation_sha256:bytea:!:-:-,validated_structure_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_framework_schema_target_namespace|target_namespace_storage_id:int8:!:I:-,deployment_id:text:!:-:C,physical_database_identity:text:!:-:C,schema_name:text:!:-:C,target_namespace_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
  "fx_system_relational_physical_name_assignment|assignment_storage_id:int8:!:I:-,collision_storage_id:int8:!:-:-,physical_database_identity:text:!:-:C,schema_name:text:!:-:C,spelling:text:!:-:C,name_sha256:bytea:!:-:-,assignment_sha256:bytea:!:-:-,frame_format:text:!:-:C,frame_version:int4:!:-:-,canonical_byte_length:int4:!:-:-,canonical_bytes:bytea:!:-:-",
] as const;

const expectedConstraintSignatures = [
  "fx_system_framework_migration_admission_assignment|fx_framework_migration_admission_assignment_identity_check:c:assignment_ordinal+assignment_sha256,fx_framework_migration_admission_assignment_parent_fk:f:admission_storage_id+collision_storage_id,fx_framework_migration_admission_assignment_pk:p:admission_storage_id+assignment_ordinal,fx_framework_migration_admission_assignment_value_fk:f:assignment_storage_id+collision_storage_id+spelling+assignment_sha256,fx_framework_migration_admission_member_unique:u:admission_storage_id+assignment_storage_id",
  "fx_system_framework_migration_attempt_start|fx_framework_migration_attempt_admission_fk:f:admission_storage_id+collision_storage_id+plan_storage_id+admission_sha256,fx_framework_migration_attempt_admission_reference_unique:u:attempt_storage_id+collision_storage_id+plan_storage_id+admission_storage_id+admission_sha256+attempt_id+attempt_fence,fx_framework_migration_attempt_fence_unique:u:collision_storage_id+attempt_fence,fx_framework_migration_attempt_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_attempt_id_unique:u:collision_storage_id+attempt_id,fx_framework_migration_attempt_identity_check:c:attempt_storage_id+migration_plan_sha256+admission_sha256+attempt_id+attempt_fence+lease_owner_id+lease_expires_at+previous_attempt_storage_id+previous_attempt_id+attempt_start_sha256,fx_framework_migration_attempt_pk:p:attempt_storage_id,fx_framework_migration_attempt_plan_fk:f:plan_storage_id+collision_storage_id+migration_plan_sha256,fx_framework_migration_attempt_previous_fk:f:previous_attempt_storage_id+collision_storage_id+previous_attempt_id,fx_framework_migration_attempt_previous_unique:u:attempt_storage_id+collision_storage_id+attempt_id,fx_framework_migration_attempt_reference_unique:u:attempt_storage_id+collision_storage_id+plan_storage_id+attempt_id+attempt_fence",
  "fx_system_framework_migration_attempt_terminal|fx_framework_migration_terminal_attempt_fk:f:attempt_storage_id+collision_storage_id+plan_storage_id+admission_storage_id+admission_sha256+attempt_id+attempt_fence,fx_framework_migration_terminal_attempt_unique:u:attempt_storage_id,fx_framework_migration_terminal_digest_unique:u:attempt_terminal_sha256,fx_framework_migration_terminal_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_terminal_identity_check:c:terminal_storage_id+admission_sha256+attempt_fence+outcome_kind+required_step_set_sha256+failure_reason+evidence_sha256+last_receipt_storage_id+last_step_receipt_sha256+attempt_terminal_sha256,fx_framework_migration_terminal_installation_unique:u:terminal_storage_id+collision_storage_id+plan_storage_id+admission_storage_id+admission_sha256+outcome_kind+attempt_terminal_sha256,fx_framework_migration_terminal_last_receipt_fk:f:last_receipt_storage_id+attempt_storage_id+last_step_receipt_sha256,fx_framework_migration_terminal_pk:p:terminal_storage_id,fx_framework_migration_terminal_reference_unique:u:terminal_storage_id+collision_storage_id+plan_storage_id+attempt_storage_id+outcome_kind+attempt_terminal_sha256",
  "fx_system_framework_migration_collision_domain|fx_framework_migration_collision_coordinate_unique:u:target_namespace_storage_id+owner+lineage_id+physical_namespace_profile,fx_framework_migration_collision_identity_check:c:collision_storage_id+owner+lineage_id+physical_namespace_profile,fx_framework_migration_collision_physical_unique:u:collision_storage_id+physical_database_identity+schema_name,fx_framework_migration_collision_pk:p:collision_storage_id,fx_framework_migration_collision_target_fk:f:target_namespace_storage_id+physical_database_identity+schema_name",
  "fx_system_framework_migration_collision_head|fx_framework_migration_collision_head_admission_fk:f:current_admission_storage_id+collision_storage_id+current_plan_storage_id+current_admission_sha256,fx_framework_migration_collision_head_attempt_fk:f:current_attempt_storage_id+collision_storage_id+current_plan_storage_id+current_admission_storage_id+current_admission_sha256+current_attempt_id+current_attempt_fence,fx_framework_migration_collision_head_event_fk:f:last_event_storage_id+collision_storage_id+last_event_sequence+last_event_sha256,fx_framework_migration_collision_head_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_collision_head_identity_check:c:head_revision+attempt_fence+current_plan_sha256+current_admission_sha256+current_attempt_storage_id+current_attempt_id+current_attempt_fence+current_lease_owner_id+current_lease_expires_at+last_event_storage_id+last_event_sequence+last_event_sha256+collision_head_sha256,fx_framework_migration_collision_head_pk:p:collision_storage_id,fx_framework_migration_collision_head_plan_fk:f:current_plan_storage_id+collision_storage_id+current_plan_sha256",
  "fx_system_framework_migration_event|fx_framework_migration_event_collision_fk:f:collision_storage_id,fx_framework_migration_event_digest_unique:u:event_sha256,fx_framework_migration_event_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_event_identity_check:c:event_storage_id+event_sequence+event_sha256+previous_event_storage_id+previous_event_sequence+previous_event_sha256+event_kind+subject_sha256+lease_attempt_id+lease_attempt_fence+lease_owner_id+lease_expires_at,fx_framework_migration_event_pk:p:event_storage_id,fx_framework_migration_event_previous_fk:f:previous_event_storage_id+collision_storage_id+previous_event_sequence+previous_event_sha256,fx_framework_migration_event_reference_unique:u:event_storage_id+collision_storage_id+event_sequence+event_sha256,fx_framework_migration_event_sequence_unique:u:collision_storage_id+event_sequence",
  "fx_system_framework_migration_plan|fx_framework_migration_plan_collision_fk:f:collision_storage_id,fx_framework_migration_plan_context_unique:u:plan_storage_id+collision_storage_id,fx_framework_migration_plan_digest_unique:u:migration_plan_sha256,fx_framework_migration_plan_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_plan_identity_check:c:plan_storage_id+artifact_sha256+migration_plan_sha256+required_step_set_sha256+physical_layout_sha256+locator_kind+locator_database_key+locator_schema_name,fx_framework_migration_plan_pk:p:plan_storage_id,fx_framework_migration_plan_reference_unique:u:plan_storage_id+collision_storage_id+migration_plan_sha256",
  "fx_system_framework_migration_plan_admission|fx_framework_migration_admission_context_unique:u:admission_storage_id+collision_storage_id,fx_framework_migration_admission_digest_unique:u:admission_sha256,fx_framework_migration_admission_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_admission_identity_check:c:admission_storage_id+migration_plan_sha256+admission_sha256+previous_plan_storage_id+previous_plan_sha256+admission_profile+assignment_count,fx_framework_migration_admission_pk:p:admission_storage_id,fx_framework_migration_admission_plan_fk:f:plan_storage_id+collision_storage_id+migration_plan_sha256,fx_framework_migration_admission_previous_plan_fk:f:previous_plan_storage_id+collision_storage_id+previous_plan_sha256,fx_framework_migration_admission_reference_unique:u:admission_storage_id+collision_storage_id+plan_storage_id+admission_sha256",
  "fx_system_framework_migration_plan_step|fx_framework_migration_plan_step_digest_unique:u:plan_storage_id+step_sha256,fx_framework_migration_plan_step_id_unique:u:plan_storage_id+step_id,fx_framework_migration_plan_step_identity_check:c:step_ordinal+step_id+step_sha256+precondition_sha256+postcondition_sha256+phase+operation_format+operation_version+dependency_count,fx_framework_migration_plan_step_pk:p:plan_storage_id+step_ordinal,fx_framework_migration_plan_step_plan_fk:f:plan_storage_id+collision_storage_id,fx_framework_migration_plan_step_receipt_unique:u:plan_storage_id+step_id+step_sha256+precondition_sha256+postcondition_sha256,fx_framework_migration_plan_step_reference_unique:u:plan_storage_id+step_id+step_sha256",
  "fx_system_framework_migration_plan_step_dependency|fx_framework_migration_step_dependency_identity_check:c:dependency_ordinal+source_step_id+dependency_step_id+dependency_step_sha256,fx_framework_migration_step_dependency_pk:p:plan_storage_id+source_step_id+dependency_ordinal,fx_framework_migration_step_dependency_source_fk:f:plan_storage_id+source_step_id,fx_framework_migration_step_dependency_target_fk:f:plan_storage_id+dependency_step_id+dependency_step_sha256,fx_framework_migration_step_dependency_target_unique:u:plan_storage_id+source_step_id+dependency_step_id",
  "fx_system_framework_migration_step_receipt|fx_framework_migration_receipt_attempt_fk:f:attempt_storage_id+collision_storage_id+plan_storage_id+attempt_id+attempt_fence,fx_framework_migration_receipt_attempt_step_unique:u:attempt_storage_id+step_id,fx_framework_migration_receipt_dependency_unique:u:receipt_storage_id+attempt_storage_id+step_id+step_receipt_sha256,fx_framework_migration_receipt_digest_unique:u:step_receipt_sha256,fx_framework_migration_receipt_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_migration_receipt_identity_check:c:receipt_storage_id+attempt_fence+step_id+step_sha256+precondition_sha256+postcondition_sha256+observed_postcondition_sha256+dependency_count+step_receipt_sha256,fx_framework_migration_receipt_pk:p:receipt_storage_id,fx_framework_migration_receipt_plan_step_fk:f:plan_storage_id+step_id+step_sha256+precondition_sha256+postcondition_sha256,fx_framework_migration_receipt_source_unique:u:receipt_storage_id+attempt_storage_id,fx_framework_migration_receipt_terminal_unique:u:receipt_storage_id+attempt_storage_id+step_receipt_sha256",
  "fx_system_framework_migration_step_receipt_dependency|fx_framework_migration_receipt_dependency_identity_check:c:dependency_ordinal+receipt_storage_id+dependency_receipt_storage_id+dependency_step_id+dependency_step_receipt_sha256,fx_framework_migration_receipt_dependency_pk:p:receipt_storage_id+dependency_ordinal,fx_framework_migration_receipt_dependency_source_fk:f:receipt_storage_id+attempt_storage_id,fx_framework_migration_receipt_dependency_target_fk:f:dependency_receipt_storage_id+attempt_storage_id+dependency_step_id+dependency_step_receipt_sha256,fx_framework_migration_receipt_dependency_target_unique:u:receipt_storage_id+dependency_receipt_storage_id",
  "fx_system_framework_schema_availability_head|fx_framework_availability_head_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_availability_head_history_fk:f:availability_history_storage_id+installation_storage_id+readiness_storage_id+availability_sequence+status+history_sha256,fx_framework_availability_head_identity_check:c:availability_sequence+status+history_sha256+availability_head_sha256,fx_framework_availability_head_pk:p:installation_storage_id,fx_framework_availability_head_readiness_fk:f:readiness_storage_id+installation_storage_id",
  "fx_system_framework_schema_availability_history|fx_framework_availability_history_digest_unique:u:installation_storage_id+history_sha256,fx_framework_availability_history_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_availability_history_identity_check:c:availability_history_storage_id+availability_sequence+status+readiness_sha256+history_sha256+reason_sha256+previous_history_storage_id+previous_availability_sequence+previous_history_sha256+previous_status,fx_framework_availability_history_pk:p:availability_history_storage_id,fx_framework_availability_history_previous_fk:f:previous_history_storage_id+installation_storage_id+readiness_storage_id+previous_availability_sequence+previous_status+previous_history_sha256,fx_framework_availability_history_readiness_fk:f:readiness_storage_id+installation_storage_id+readiness_sha256,fx_framework_availability_history_reference_unique:u:availability_history_storage_id+installation_storage_id+readiness_storage_id+availability_sequence+status+history_sha256,fx_framework_availability_history_sequence_unique:u:installation_storage_id+availability_sequence",
  "fx_system_framework_schema_installation|fx_framework_installation_admission_fk:f:admission_storage_id+collision_storage_id+plan_storage_id+admission_sha256,fx_framework_installation_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_installation_identity_check:c:installation_storage_id+migration_plan_sha256+admission_sha256+terminal_outcome_kind+terminal_sha256+installation_sha256+installation_receipt_sha256+installed_structure_sha256,fx_framework_installation_identity_unique:u:installation_sha256,fx_framework_installation_pk:p:installation_storage_id,fx_framework_installation_plan_fk:f:plan_storage_id+collision_storage_id+migration_plan_sha256,fx_framework_installation_receipt_unique:u:installation_receipt_sha256,fx_framework_installation_reference_unique:u:installation_storage_id+installation_sha256+installation_receipt_sha256,fx_framework_installation_terminal_fk:f:terminal_storage_id+collision_storage_id+plan_storage_id+admission_storage_id+admission_sha256+terminal_outcome_kind+terminal_sha256",
  "fx_system_framework_schema_readiness|fx_framework_readiness_context_unique:u:readiness_storage_id+installation_storage_id,fx_framework_readiness_digest_unique:u:readiness_sha256,fx_framework_readiness_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_readiness_identity_check:c:readiness_storage_id+installation_sha256+installation_receipt_sha256+readiness_sha256+validation_sha256+validated_structure_sha256,fx_framework_readiness_installation_fk:f:installation_storage_id+installation_sha256+installation_receipt_sha256,fx_framework_readiness_installation_unique:u:installation_storage_id,fx_framework_readiness_pk:p:readiness_storage_id,fx_framework_readiness_reference_unique:u:readiness_storage_id+installation_storage_id+readiness_sha256",
  "fx_system_framework_schema_target_namespace|fx_framework_target_namespace_coordinate_unique:u:deployment_id+physical_database_identity+schema_name,fx_framework_target_namespace_digest_unique:u:target_namespace_sha256,fx_framework_target_namespace_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_framework_target_namespace_identity_check:c:target_namespace_storage_id+deployment_id+physical_database_identity+schema_name+target_namespace_sha256,fx_framework_target_namespace_physical_unique:u:target_namespace_storage_id+physical_database_identity+schema_name,fx_framework_target_namespace_pk:p:target_namespace_storage_id",
  "fx_system_relational_physical_name_assignment|fx_relational_name_assignment_collision_fk:f:collision_storage_id+physical_database_identity+schema_name,fx_relational_name_assignment_digest_unique:u:assignment_sha256,fx_relational_name_assignment_frame_check:c:frame_format+frame_version+canonical_byte_length+canonical_bytes,fx_relational_name_assignment_identity_check:c:assignment_storage_id+spelling+name_sha256+assignment_sha256,fx_relational_name_assignment_pk:p:assignment_storage_id,fx_relational_name_assignment_reference_unique:u:assignment_storage_id+collision_storage_id+spelling+assignment_sha256,fx_relational_name_assignment_spelling_unique:u:physical_database_identity+schema_name+spelling",
] as const;

const expectedForeignKeySignatures = [
  "fx_framework_availability_head_history_fk|fx_system_framework_schema_availability_head|availability_history_storage_id,installation_storage_id,readiness_storage_id,availability_sequence,status,history_sha256|fx_system_framework_schema_availability_history|availability_history_storage_id,installation_storage_id,readiness_storage_id,availability_sequence,status,history_sha256",
  "fx_framework_availability_head_readiness_fk|fx_system_framework_schema_availability_head|readiness_storage_id,installation_storage_id|fx_system_framework_schema_readiness|readiness_storage_id,installation_storage_id",
  "fx_framework_availability_history_previous_fk|fx_system_framework_schema_availability_history|previous_history_storage_id,installation_storage_id,readiness_storage_id,previous_availability_sequence,previous_status,previous_history_sha256|fx_system_framework_schema_availability_history|availability_history_storage_id,installation_storage_id,readiness_storage_id,availability_sequence,status,history_sha256",
  "fx_framework_availability_history_readiness_fk|fx_system_framework_schema_availability_history|readiness_storage_id,installation_storage_id,readiness_sha256|fx_system_framework_schema_readiness|readiness_storage_id,installation_storage_id,readiness_sha256",
  "fx_framework_installation_admission_fk|fx_system_framework_schema_installation|admission_storage_id,collision_storage_id,plan_storage_id,admission_sha256|fx_system_framework_migration_plan_admission|admission_storage_id,collision_storage_id,plan_storage_id,admission_sha256",
  "fx_framework_installation_plan_fk|fx_system_framework_schema_installation|plan_storage_id,collision_storage_id,migration_plan_sha256|fx_system_framework_migration_plan|plan_storage_id,collision_storage_id,migration_plan_sha256",
  "fx_framework_installation_terminal_fk|fx_system_framework_schema_installation|terminal_storage_id,collision_storage_id,plan_storage_id,admission_storage_id,admission_sha256,terminal_outcome_kind,terminal_sha256|fx_system_framework_migration_attempt_terminal|terminal_storage_id,collision_storage_id,plan_storage_id,admission_storage_id,admission_sha256,outcome_kind,attempt_terminal_sha256",
  "fx_framework_migration_admission_assignment_parent_fk|fx_system_framework_migration_admission_assignment|admission_storage_id,collision_storage_id|fx_system_framework_migration_plan_admission|admission_storage_id,collision_storage_id",
  "fx_framework_migration_admission_assignment_value_fk|fx_system_framework_migration_admission_assignment|assignment_storage_id,collision_storage_id,spelling,assignment_sha256|fx_system_relational_physical_name_assignment|assignment_storage_id,collision_storage_id,spelling,assignment_sha256",
  "fx_framework_migration_admission_plan_fk|fx_system_framework_migration_plan_admission|plan_storage_id,collision_storage_id,migration_plan_sha256|fx_system_framework_migration_plan|plan_storage_id,collision_storage_id,migration_plan_sha256",
  "fx_framework_migration_admission_previous_plan_fk|fx_system_framework_migration_plan_admission|previous_plan_storage_id,collision_storage_id,previous_plan_sha256|fx_system_framework_migration_plan|plan_storage_id,collision_storage_id,migration_plan_sha256",
  "fx_framework_migration_attempt_admission_fk|fx_system_framework_migration_attempt_start|admission_storage_id,collision_storage_id,plan_storage_id,admission_sha256|fx_system_framework_migration_plan_admission|admission_storage_id,collision_storage_id,plan_storage_id,admission_sha256",
  "fx_framework_migration_attempt_plan_fk|fx_system_framework_migration_attempt_start|plan_storage_id,collision_storage_id,migration_plan_sha256|fx_system_framework_migration_plan|plan_storage_id,collision_storage_id,migration_plan_sha256",
  "fx_framework_migration_attempt_previous_fk|fx_system_framework_migration_attempt_start|previous_attempt_storage_id,collision_storage_id,previous_attempt_id|fx_system_framework_migration_attempt_start|attempt_storage_id,collision_storage_id,attempt_id",
  "fx_framework_migration_collision_head_admission_fk|fx_system_framework_migration_collision_head|current_admission_storage_id,collision_storage_id,current_plan_storage_id,current_admission_sha256|fx_system_framework_migration_plan_admission|admission_storage_id,collision_storage_id,plan_storage_id,admission_sha256",
  "fx_framework_migration_collision_head_attempt_fk|fx_system_framework_migration_collision_head|current_attempt_storage_id,collision_storage_id,current_plan_storage_id,current_admission_storage_id,current_admission_sha256,current_attempt_id,current_attempt_fence|fx_system_framework_migration_attempt_start|attempt_storage_id,collision_storage_id,plan_storage_id,admission_storage_id,admission_sha256,attempt_id,attempt_fence",
  "fx_framework_migration_collision_head_event_fk|fx_system_framework_migration_collision_head|last_event_storage_id,collision_storage_id,last_event_sequence,last_event_sha256|fx_system_framework_migration_event|event_storage_id,collision_storage_id,event_sequence,event_sha256",
  "fx_framework_migration_collision_head_plan_fk|fx_system_framework_migration_collision_head|current_plan_storage_id,collision_storage_id,current_plan_sha256|fx_system_framework_migration_plan|plan_storage_id,collision_storage_id,migration_plan_sha256",
  "fx_framework_migration_collision_target_fk|fx_system_framework_migration_collision_domain|target_namespace_storage_id,physical_database_identity,schema_name|fx_system_framework_schema_target_namespace|target_namespace_storage_id,physical_database_identity,schema_name",
  "fx_framework_migration_event_collision_fk|fx_system_framework_migration_event|collision_storage_id|fx_system_framework_migration_collision_domain|collision_storage_id",
  "fx_framework_migration_event_previous_fk|fx_system_framework_migration_event|previous_event_storage_id,collision_storage_id,previous_event_sequence,previous_event_sha256|fx_system_framework_migration_event|event_storage_id,collision_storage_id,event_sequence,event_sha256",
  "fx_framework_migration_plan_collision_fk|fx_system_framework_migration_plan|collision_storage_id|fx_system_framework_migration_collision_domain|collision_storage_id",
  "fx_framework_migration_plan_step_plan_fk|fx_system_framework_migration_plan_step|plan_storage_id,collision_storage_id|fx_system_framework_migration_plan|plan_storage_id,collision_storage_id",
  "fx_framework_migration_receipt_attempt_fk|fx_system_framework_migration_step_receipt|attempt_storage_id,collision_storage_id,plan_storage_id,attempt_id,attempt_fence|fx_system_framework_migration_attempt_start|attempt_storage_id,collision_storage_id,plan_storage_id,attempt_id,attempt_fence",
  "fx_framework_migration_receipt_dependency_source_fk|fx_system_framework_migration_step_receipt_dependency|receipt_storage_id,attempt_storage_id|fx_system_framework_migration_step_receipt|receipt_storage_id,attempt_storage_id",
  "fx_framework_migration_receipt_dependency_target_fk|fx_system_framework_migration_step_receipt_dependency|dependency_receipt_storage_id,attempt_storage_id,dependency_step_id,dependency_step_receipt_sha256|fx_system_framework_migration_step_receipt|receipt_storage_id,attempt_storage_id,step_id,step_receipt_sha256",
  "fx_framework_migration_receipt_plan_step_fk|fx_system_framework_migration_step_receipt|plan_storage_id,step_id,step_sha256,precondition_sha256,postcondition_sha256|fx_system_framework_migration_plan_step|plan_storage_id,step_id,step_sha256,precondition_sha256,postcondition_sha256",
  "fx_framework_migration_step_dependency_source_fk|fx_system_framework_migration_plan_step_dependency|plan_storage_id,source_step_id|fx_system_framework_migration_plan_step|plan_storage_id,step_id",
  "fx_framework_migration_step_dependency_target_fk|fx_system_framework_migration_plan_step_dependency|plan_storage_id,dependency_step_id,dependency_step_sha256|fx_system_framework_migration_plan_step|plan_storage_id,step_id,step_sha256",
  "fx_framework_migration_terminal_attempt_fk|fx_system_framework_migration_attempt_terminal|attempt_storage_id,collision_storage_id,plan_storage_id,admission_storage_id,admission_sha256,attempt_id,attempt_fence|fx_system_framework_migration_attempt_start|attempt_storage_id,collision_storage_id,plan_storage_id,admission_storage_id,admission_sha256,attempt_id,attempt_fence",
  "fx_framework_migration_terminal_last_receipt_fk|fx_system_framework_migration_attempt_terminal|last_receipt_storage_id,attempt_storage_id,last_step_receipt_sha256|fx_system_framework_migration_step_receipt|receipt_storage_id,attempt_storage_id,step_receipt_sha256",
  "fx_framework_readiness_installation_fk|fx_system_framework_schema_readiness|installation_storage_id,installation_sha256,installation_receipt_sha256|fx_system_framework_schema_installation|installation_storage_id,installation_sha256,installation_receipt_sha256",
  "fx_relational_name_assignment_collision_fk|fx_system_relational_physical_name_assignment|collision_storage_id,physical_database_identity,schema_name|fx_system_framework_migration_collision_domain|collision_storage_id,physical_database_identity,schema_name",
] as const;

type SqlPersistence = Pick<FlarexSqlClient, "query">;

export async function expectFrameworkCoordinatorMetadataStorageCatalog(
  persistence: SqlPersistence,
  expectedSchema: string,
): Promise<void> {
  const columns = await persistence.query<{
    table_name: string;
    signature: string;
  }>(`
    select table_name,
      string_agg(
        column_name || ':' || udt_name || ':' ||
        case when is_nullable = 'YES' then '?' else '!' end || ':' ||
        case when is_identity = 'YES' then 'I' else '-' end || ':' ||
        coalesce(collation_name, '-'),
        ',' order by ordinal_position
      ) as signature
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = any($1::text[])
    group by table_name
    order by table_name
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  expect(columns.rows.map(row => `${row.table_name}|${row.signature}`)).toEqual(
    expectedColumnSignatures,
  );

  const timestampPrecisions = await persistence.query<{
    table_name: string;
    column_name: string;
    datetime_precision: number;
  }>(`
    select table_name, column_name, datetime_precision
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = any($1::text[])
      and data_type = 'timestamp with time zone'
    order by table_name, column_name
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  expect(timestampPrecisions.rows).toEqual([
    {
      table_name: "fx_system_framework_migration_attempt_start",
      column_name: "lease_expires_at",
      datetime_precision: 3,
    },
    {
      table_name: "fx_system_framework_migration_collision_head",
      column_name: "current_lease_expires_at",
      datetime_precision: 3,
    },
    {
      table_name: "fx_system_framework_migration_event",
      column_name: "lease_expires_at",
      datetime_precision: 3,
    },
  ]);

  const defaults = await persistence.query<{
    table_name: string;
    column_name: string;
    column_default: string;
  }>(`
    select table_name, column_name, column_default
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = any($1::text[])
      and column_default is not null
    order by table_name, ordinal_position
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  expect(defaults.rows).toEqual([]);

  const identities = await persistence.query<{
    table_name: string;
    column_name: string;
    identity_generation: string;
    identity_start: string;
    identity_increment: string;
    identity_cycle: string;
    sequence_name: string | null;
  }>(`
    select table_name, column_name, identity_generation, identity_start,
      identity_increment, identity_cycle,
      pg_get_serial_sequence(
        format('%I.%I', table_schema, table_name), column_name
      ) as sequence_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = any($1::text[])
      and is_identity = 'YES'
    order by table_name, column_name
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  expect(identities.rows).toEqual(identitySpecs.map(
    ([tableName, columnName, sequenceName]) => ({
      table_name: tableName,
      column_name: columnName,
      identity_generation: "ALWAYS",
      identity_start: "1",
      identity_increment: "1",
      identity_cycle: "NO",
      sequence_name: `${expectedSchema}.${sequenceName}`,
    }),
  ));

  const sequences = await persistence.query<{
    sequence_name: string;
    start_value: string;
    minimum_value: string;
    maximum_value: string;
    increment: string;
    cache_size: string;
    cycles: boolean;
    dependency_type: string;
    owned_table: string;
    owned_column: string;
  }>(`
    select sequence.relname as sequence_name,
      parameters.seqstart::text as start_value,
      parameters.seqmin::text as minimum_value,
      parameters.seqmax::text as maximum_value,
      parameters.seqincrement::text as increment,
      parameters.seqcache::text as cache_size,
      parameters.seqcycle as cycles,
      dependency.deptype as dependency_type,
      owned_table.relname as owned_table,
      owned_column.attname as owned_column
    from pg_class as sequence
    join pg_namespace as namespace
      on namespace.oid = sequence.relnamespace
    join pg_sequence as parameters on parameters.seqrelid = sequence.oid
    join pg_depend as dependency
      on dependency.classid = 'pg_class'::regclass
      and dependency.objid = sequence.oid
      and dependency.deptype = 'i'
    join pg_class as owned_table on owned_table.oid = dependency.refobjid
    join pg_attribute as owned_column
      on owned_column.attrelid = dependency.refobjid
      and owned_column.attnum = dependency.refobjsubid
    where namespace.nspname = current_schema()
      and sequence.relname = any($1::text[])
    order by sequence.relname
  `, [[...FRAMEWORK_COORDINATOR_METADATA_IDENTITY_SEQUENCE_NAMES]]);
  expect(sequences.rows).toEqual(identitySpecs.map(
    ([tableName, columnName, sequenceName]) => ({
      sequence_name: sequenceName,
      start_value: "1",
      minimum_value: "1",
      maximum_value: "9223372036854775807",
      increment: "1",
      cache_size: "1",
      cycles: false,
      dependency_type: "i",
      owned_table: tableName,
      owned_column: columnName,
    }),
  ).toSorted((left, right) =>
    left.sequence_name.localeCompare(right.sequence_name)
  ));

  const constraints = await persistence.query<{
    table_name: string;
    signature: string;
  }>(`
    select source_table.relname as table_name,
      string_agg(
        constraint_row.conname || ':' || constraint_row.contype::text || ':' ||
        coalesce((
          select string_agg(source_column.attname, '+' order by key.ordinality)
          from unnest(constraint_row.conkey)
            with ordinality as key(attnum, ordinality)
          join pg_attribute as source_column
            on source_column.attrelid = constraint_row.conrelid
            and source_column.attnum = key.attnum
        ), '-'),
        ',' order by constraint_row.conname
      ) as signature
    from pg_constraint as constraint_row
    join pg_class as source_table
      on source_table.oid = constraint_row.conrelid
    join pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    where source_namespace.nspname = current_schema()
      and source_table.relname = any($1::text[])
      -- PostgreSQL 18 also catalogs NOT NULL here; columns prove it above.
      and constraint_row.contype <> 'n'
    group by source_table.relname
    order by source_table.relname
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  expect(constraints.rows.map(row =>
    `${row.table_name}|${row.signature}`
  )).toEqual(expectedConstraintSignatures);

  const foreignKeys = await persistence.query<{
    constraint_name: string;
    source_table: string;
    source_columns: string;
    target_schema: string;
    target_table: string;
    target_columns: string;
    update_action: string;
    delete_action: string;
    deferrable: boolean;
    deferred: boolean;
  }>(`
    select constraint_row.conname as constraint_name,
      source_table.relname as source_table,
      (select string_agg(source_column.attname, ',' order by key.ordinality)
        from unnest(constraint_row.conkey)
          with ordinality as key(attnum, ordinality)
        join pg_attribute as source_column
          on source_column.attrelid = constraint_row.conrelid
          and source_column.attnum = key.attnum) as source_columns,
      target_namespace.nspname as target_schema,
      target_table.relname as target_table,
      (select string_agg(target_column.attname, ',' order by key.ordinality)
        from unnest(constraint_row.confkey)
          with ordinality as key(attnum, ordinality)
        join pg_attribute as target_column
          on target_column.attrelid = constraint_row.confrelid
          and target_column.attnum = key.attnum) as target_columns,
      constraint_row.confupdtype::text as update_action,
      constraint_row.confdeltype::text as delete_action,
      constraint_row.condeferrable as deferrable,
      constraint_row.condeferred as deferred
    from pg_constraint as constraint_row
    join pg_class as source_table
      on source_table.oid = constraint_row.conrelid
    join pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_class as target_table
      on target_table.oid = constraint_row.confrelid
    join pg_namespace as target_namespace
      on target_namespace.oid = target_table.relnamespace
    where source_namespace.nspname = current_schema()
      and source_table.relname = any($1::text[])
      and constraint_row.contype = 'f'
    order by constraint_row.conname
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  expect(foreignKeys.rows.map(row =>
    `${row.constraint_name}|${row.source_table}|${row.source_columns}|` +
      `${row.target_table}|${row.target_columns}`
  )).toEqual(expectedForeignKeySignatures);
  for (const foreignKey of foreignKeys.rows) {
    expect(foreignKey.target_schema).toBe(expectedSchema);
    expect(foreignKey.update_action).toBe("r");
    expect(foreignKey.delete_action).toBe("r");
    expect(foreignKey.deferrable).toBe(false);
    expect(foreignKey.deferred).toBe(false);
  }

  const indexes = await persistence.query<{
    table_name: string;
    index_name: string;
  }>(`
    select tablename as table_name, indexname as index_name
    from pg_indexes
    where schemaname = current_schema()
      and tablename = any($1::text[])
    order by tablename, indexname
  `, [[...FRAMEWORK_COORDINATOR_METADATA_TABLE_NAMES]]);
  const expectedIndexes = expectedConstraintSignatures.flatMap(signature => {
    const [tableName, constraintSignature] = signature.split("|", 2);
    if (tableName === undefined || constraintSignature === undefined) {
      throw new Error("Invalid expected framework metadata constraint signature.");
    }
    return constraintSignature.split(",").flatMap(constraint => {
      const [constraintName, constraintType] = constraint.split(":", 3);
      return constraintType === "p" || constraintType === "u"
        ? [{ table_name: tableName, index_name: constraintName }]
        : [];
    });
  });
  expect(indexes.rows).toEqual(expectedIndexes);
}
