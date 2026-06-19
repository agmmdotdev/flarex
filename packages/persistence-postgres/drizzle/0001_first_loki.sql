CREATE TABLE "deployment_packages" (
	"deployment_id" text NOT NULL,
	"package_id" text NOT NULL,
	"source_package_hash" text NOT NULL,
	"execution_module" text NOT NULL,
	"source_package_json" jsonb NOT NULL,
	"analysis_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_packages_deployment_id_package_id_pk" PRIMARY KEY("deployment_id","package_id")
);
