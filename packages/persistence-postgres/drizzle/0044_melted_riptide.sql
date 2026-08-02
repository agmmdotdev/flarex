LOCK TABLE
  "fx_system_declarative_v2_module_summary",
  "fx_system_declarative_v2_import_edge",
  "fx_system_declarative_v2_page_manifest",
  "fx_system_declarative_v2_link_node",
  "fx_system_declarative_v2_frontier_entry",
  "fx_system_declarative_v2_registration",
  "fx_system_declarative_v2_diagnostic",
  "fx_system_declarative_v2_verifier_attempt",
  "fx_system_declarative_v2_candidate_projection"
IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_module_summary" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_module_summary';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_import_edge" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_import_edge';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_page_manifest" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_page_manifest';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_link_node" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_link_node';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_frontier_entry" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_frontier_entry';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_registration" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_registration';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_diagnostic" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_diagnostic';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verifier_attempt" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_verifier_attempt';
  END IF;
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_candidate_projection" LIMIT 1) THEN
    RAISE EXCEPTION 'migration 0044 cannot retire non-empty fx_system_declarative_v2_candidate_projection';
  END IF;
END
$$;--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_module_summary";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_import_edge";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_page_manifest";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_link_node";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_frontier_entry";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_registration";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_diagnostic";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_verifier_attempt";--> statement-breakpoint
DROP TABLE "fx_system_declarative_v2_candidate_projection";
