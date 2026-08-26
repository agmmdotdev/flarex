CREATE TABLE "fx_system_commit_relation_adjacency_change" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"change_ordinal" integer NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"direction" text NOT NULL,
	"endpoint_row_id" "bytea" NOT NULL,
	CONSTRAINT "fx_system_commit_relation_adjacency_pk" PRIMARY KEY("scope_uuid","commit_seq","change_ordinal"),
	CONSTRAINT "fx_system_commit_relation_adjacency_endpoint_unique" UNIQUE("scope_uuid","commit_seq","edge_definition_id","direction","endpoint_row_id"),
	CONSTRAINT "fx_system_commit_relation_adjacency_ordinal_check" CHECK ("fx_system_commit_relation_adjacency_change"."change_ordinal" between 0 and 8191),
	CONSTRAINT "fx_system_commit_relation_adjacency_edge_id_check" CHECK ("fx_system_commit_relation_adjacency_change"."edge_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_commit_relation_adjacency_direction_check" CHECK ("fx_system_commit_relation_adjacency_change"."direction" in ('incoming', 'outgoing')),
	CONSTRAINT "fx_system_commit_relation_adjacency_row_id_length_check" CHECK (octet_length("fx_system_commit_relation_adjacency_change"."endpoint_row_id") = 16)
);
--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD COLUMN "relation_adjacency_change_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_commit_relation_adjacency_change" ADD CONSTRAINT "fx_system_commit_relation_adjacency_header_fk" FOREIGN KEY ("scope_uuid","epoch_uuid","commit_seq") REFERENCES "fx_system_commit"("scope_uuid","epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD CONSTRAINT "fx_system_commit_relation_adjacency_change_count_check" CHECK ("fx_system_commit"."relation_adjacency_change_count" between 0 and 8192);
