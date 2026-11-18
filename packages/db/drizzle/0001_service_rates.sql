CREATE TYPE "public"."rate_kind" AS ENUM('per_km', 'drive_hour', 'waiting_hour', 'service_hour');--> statement-breakpoint
CREATE TABLE "service_rates" (
	"service_id" varchar(10) NOT NULL,
	"kind" "rate_kind" NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "service_rates_service_id_kind_currency_pk" PRIMARY KEY("service_id","kind","currency"),
	CONSTRAINT "service_rates_amount_positive" CHECK ("service_rates"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_rates" ADD CONSTRAINT "service_rates_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE no action ON UPDATE no action;