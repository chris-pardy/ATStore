CREATE TABLE "fund_actor_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_did" text NOT NULL,
	"rkey" text NOT NULL,
	"at_uri" text NOT NULL,
	"entity_type" text,
	"role" text,
	"record_created_at" timestamp with time zone,
	"record_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_actor_declarations_at_uri_idx" ON "fund_actor_declarations" USING btree ("at_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_actor_declarations_repo_did_idx" ON "fund_actor_declarations" USING btree ("repo_did");
--> statement-breakpoint
CREATE TABLE "fund_funding_contributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_did" text NOT NULL,
	"rkey" text NOT NULL,
	"at_uri" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"record_created_at" timestamp with time zone,
	"record_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_funding_contributes_at_uri_idx" ON "fund_funding_contributes" USING btree ("at_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_funding_contributes_repo_did_idx" ON "fund_funding_contributes" USING btree ("repo_did");
--> statement-breakpoint
CREATE TABLE "fund_funding_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_did" text NOT NULL,
	"rkey" text NOT NULL,
	"at_uri" text NOT NULL,
	"channel_type" text NOT NULL,
	"channel_uri" text,
	"description" text,
	"record_created_at" timestamp with time zone,
	"record_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_funding_channels_at_uri_idx" ON "fund_funding_channels" USING btree ("at_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_funding_channels_repo_did_rkey_idx" ON "fund_funding_channels" USING btree ("repo_did","rkey");
--> statement-breakpoint
CREATE INDEX "fund_funding_channels_repo_did_idx" ON "fund_funding_channels" USING btree ("repo_did");
--> statement-breakpoint
CREATE INDEX "fund_funding_channels_channel_type_idx" ON "fund_funding_channels" USING btree ("channel_type");
--> statement-breakpoint
CREATE TABLE "fund_funding_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_did" text NOT NULL,
	"rkey" text NOT NULL,
	"at_uri" text NOT NULL,
	"status" text,
	"name" text NOT NULL,
	"description" text,
	"amount" bigint,
	"currency" text,
	"frequency" text,
	"channel_at_uris" text[],
	"record_created_at" timestamp with time zone,
	"record_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_funding_plans_at_uri_idx" ON "fund_funding_plans" USING btree ("at_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_funding_plans_repo_did_rkey_idx" ON "fund_funding_plans" USING btree ("repo_did","rkey");
--> statement-breakpoint
CREATE INDEX "fund_funding_plans_repo_did_idx" ON "fund_funding_plans" USING btree ("repo_did");
--> statement-breakpoint
CREATE INDEX "fund_funding_plans_status_idx" ON "fund_funding_plans" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "fund_graph_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_did" text NOT NULL,
	"rkey" text NOT NULL,
	"at_uri" text NOT NULL,
	"subject_did" text NOT NULL,
	"label" text,
	"record_created_at" timestamp with time zone,
	"record_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_graph_dependencies_at_uri_idx" ON "fund_graph_dependencies" USING btree ("at_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "fund_graph_dependencies_repo_did_rkey_idx" ON "fund_graph_dependencies" USING btree ("repo_did","rkey");
--> statement-breakpoint
CREATE INDEX "fund_graph_dependencies_repo_did_idx" ON "fund_graph_dependencies" USING btree ("repo_did");
--> statement-breakpoint
CREATE INDEX "fund_graph_dependencies_subject_did_idx" ON "fund_graph_dependencies" USING btree ("subject_did");
