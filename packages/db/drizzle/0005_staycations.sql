ALTER TYPE "public"."rate_kind" ADD VALUE 'per_night';--> statement-breakpoint
CREATE TABLE "staycations" (
	"service_id" varchar(10) PRIMARY KEY NOT NULL,
	"slug" varchar(60) NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"location" text NOT NULL,
	"max_guests" integer NOT NULL,
	"min_nights" integer NOT NULL,
	"image" text,
	"amenities" jsonb NOT NULL,
	"inclusions" jsonb NOT NULL,
	"exclusions" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "staycations_max_guests_positive" CHECK ("staycations"."max_guests" >= 1),
	CONSTRAINT "staycations_min_nights_positive" CHECK ("staycations"."min_nights" >= 1)
);
--> statement-breakpoint
ALTER TABLE "staycations" ADD CONSTRAINT "staycations_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staycations_active_slug" ON "staycations" USING btree ("slug") WHERE "staycations"."active";