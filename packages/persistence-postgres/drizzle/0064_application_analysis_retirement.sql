LOCK TABLE
  "fx_system_application_revision_request_v1",
  "fx_system_application_revision_v1",
  "fx_system_declarative_v2_activation_head",
  "fx_system_declarative_v2_activation_revision",
  "fx_system_declarative_v2_candidate",
  "fx_system_declarative_v2_function_group_entry",
  "fx_system_declarative_v2_function_group_manifest",
  "fx_system_declarative_v2_runtime_projection_module",
  "fx_system_declarative_v2_runtime_projection",
  "fx_system_declarative_v2_verdict",
  "fx_system_declarative_v2_verifier_attempt_v2",
  "fx_system_declarative_v2_verifier_command_authority_v1",
  "fx_system_declarative_v2_verifier_command_v2",
  "fx_system_declarative_v2_verifier_evidence_page_v2"
IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fx_system_application_revision_request_v1" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_application_revision_v1" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_activation_head" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_activation_revision" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_candidate" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_function_group_entry" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_function_group_manifest" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_runtime_projection_module" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_runtime_projection" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verdict" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verifier_attempt_v2" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verifier_command_authority_v1" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verifier_command_v2" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verifier_evidence_page_v2" LIMIT 1)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'AA-R8 retirement refused: displaced analyzer state is not empty';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" DROP CONSTRAINT "fx_action_invocation_v1_revision_fk";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_definition_revision_v1" DROP CONSTRAINT "fx_task_definition_v1_application_revision_fk";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_activation_head";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_activation_revision";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_verdict";--> statement-breakpoint
DROP TABLE "fx_system_application_revision_request_v1";--> statement-breakpoint
DROP TABLE "fx_system_application_revision_v1";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_verifier_command_authority_v1";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_verifier_evidence_page_v2";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_verifier_command_v2";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_verifier_attempt_v2";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_function_group_entry";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_function_group_manifest";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_runtime_projection_module";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_runtime_projection";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_candidate";
