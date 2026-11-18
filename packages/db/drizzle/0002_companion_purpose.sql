CREATE TYPE "public"."companion_purpose" AS ENUM('hospital', 'bank', 'office', 'other');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "companion_purpose" "companion_purpose";