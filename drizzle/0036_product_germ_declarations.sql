CREATE TABLE "product_germ_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_did" text NOT NULL,
	"rkey" text NOT NULL,
	"at_uri" text NOT NULL,
	"record_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_germ_declarations_at_uri_idx" ON "product_germ_declarations" USING btree ("at_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_germ_declarations_repo_did_rkey_idx" ON "product_germ_declarations" USING btree ("repo_did","rkey");
--> statement-breakpoint
CREATE INDEX "product_germ_declarations_repo_did_idx" ON "product_germ_declarations" USING btree ("repo_did");
