CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;--> statement-breakpoint
CREATE INDEX "fx_app_search_entry_current_lookup_gin" ON "fx_app_search_entry_current" USING gin ("scope_uuid" public.uuid_ops,"logical_index_id" public.int4_ops,"folded_text" public.gin_trgm_ops);
