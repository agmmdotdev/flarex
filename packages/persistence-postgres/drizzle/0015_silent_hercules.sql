ALTER TABLE "invoke_sessions" ADD COLUMN "identity_json" jsonb DEFAULT '{"kind":"anonymous"}'::jsonb NOT NULL;
