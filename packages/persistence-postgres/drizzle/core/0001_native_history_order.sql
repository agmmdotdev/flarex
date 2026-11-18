DROP INDEX "flarex_core"."indexes_by_index_id_key_prefix_key_sha256";
--> statement-breakpoint
CREATE INDEX "indexes_by_index_id_key_prefix_key_sha256_ts" ON "flarex_core"."indexes" USING btree ("instance_name","index_id","key_prefix","key_sha256","ts");
