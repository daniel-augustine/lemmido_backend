ALTER TYPE "public"."rate_kind" ADD VALUE 'per_person';--> statement-breakpoint
CREATE TABLE "tour_packages" (
	"service_id" varchar(10) PRIMARY KEY NOT NULL,
	"slug" varchar(60) NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"days" integer NOT NULL,
	"nights" integer NOT NULL,
	"max_people" integer NOT NULL,
	"image" text,
	"itinerary" jsonb NOT NULL,
	"inclusions" jsonb NOT NULL,
	"exclusions" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tour_packages_days_positive" CHECK ("tour_packages"."days" >= 1),
	CONSTRAINT "tour_packages_nights_valid" CHECK ("tour_packages"."nights" >= 0 AND "tour_packages"."nights" < "tour_packages"."days"),
	CONSTRAINT "tour_packages_max_people_positive" CHECK ("tour_packages"."max_people" >= 1)
);
--> statement-breakpoint
ALTER TABLE "tour_packages" ADD CONSTRAINT "tour_packages_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tour_packages_active_slug" ON "tour_packages" USING btree ("slug") WHERE "tour_packages"."active";