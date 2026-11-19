CREATE TYPE "public"."vehicle_source" AS ENUM('ours', 'customer');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "vehicle_source" "vehicle_source";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "description" text;