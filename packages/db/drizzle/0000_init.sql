CREATE TYPE "public"."alert_kind" AS ENUM('running_over', 'break_due', 'next_at_risk');--> statement-breakpoint
CREATE TYPE "public"."alert_resolution" AS ENUM('new_helper', 'cancelled', 'job_finished', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."approval_mode" AS ENUM('auto', 'admin');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('awaiting_payment', 'pending_approval', 'quoted', 'accepted', 'confirmed', 'denied', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dashboard_section" AS ENUM('approved', 'pending', 'denied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."helper_source" AS ENUM('auto', 'admin');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('scheduled', 'in_progress', 'running_over', 'completed');--> statement-breakpoint
CREATE TYPE "public"."overrun_status" AS ENUM('none', 'due', 'paid', 'waived');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'paid', 'late');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('customer', 'admin', 'employee');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_number" varchar(20),
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "role" DEFAULT 'customer' NOT NULL,
	"country" char(2),
	"timezone" varchar(64),
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone_number" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "users_employee_phone" CHECK ("users"."role" <> 'employee' OR "users"."phone_number" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"service_id" varchar(10) PRIMARY KEY NOT NULL,
	"service_type" varchar(30) NOT NULL,
	"service_hrs" numeric(4, 1),
	"description" text NOT NULL,
	"auto_priced" boolean NOT NULL,
	"overrun_rate" integer
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"booking_id" varchar(20) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"service_id" varchar(10) NOT NULL,
	"pickup" text,
	"destination" text NOT NULL,
	"date_time" timestamp with time zone NOT NULL,
	"service_hrs" numeric(4, 1),
	"job_starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"effort_hrs" numeric(4, 1) NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"job_status" "job_status" DEFAULT 'scheduled' NOT NULL,
	"expected_end_at" timestamp with time zone,
	"planned_ends_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"overrun_rate" integer NOT NULL,
	"overrun_hrs" numeric(4, 1),
	"overrun_amount" integer,
	"overrun_status" "overrun_status" DEFAULT 'none' NOT NULL,
	"overrun_payment_ref" varchar(100),
	"approval_status" "booking_status" NOT NULL,
	"approval_mode" "approval_mode" NOT NULL,
	"quote_amount" integer,
	"currency" char(3) NOT NULL,
	"quoted_by" text,
	"confirm_by" timestamp with time zone NOT NULL,
	"pay_by" timestamp with time zone,
	"payment_status" "payment_status" NOT NULL,
	"payment_ref" varchar(100),
	"helper_id" text,
	"helper_source" "helper_source",
	"denial_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_overrun_payment_ref_unique" UNIQUE("overrun_payment_ref"),
	CONSTRAINT "bookings_payment_ref_unique" UNIQUE("payment_ref")
);
--> statement-breakpoint
CREATE TABLE "dashboard" (
	"dash_id" varchar(25) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"booking_id" varchar(20) NOT NULL,
	"book_accept" boolean NOT NULL,
	"helper_accept" boolean NOT NULL,
	"section" "dashboard_section" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"alert_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"booking_id" varchar(20) NOT NULL,
	"next_booking_id" varchar(20),
	"helper_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution" "alert_resolution"
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("service_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quoted_by_users_id_fk" FOREIGN KEY ("quoted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_helper_id_users_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_booking_id_bookings_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("booking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_booking_id_bookings_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("booking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_next_booking_id_bookings_booking_id_fk" FOREIGN KEY ("next_booking_id") REFERENCES "public"."bookings"("booking_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_helper_id_users_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_active_employees" ON "users" USING btree ("id") WHERE "users"."role" = 'employee' AND "users"."deactivated_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "bookings_helper_id_job_starts_at_idx" ON "bookings" USING btree ("helper_id","job_starts_at");--> statement-breakpoint
CREATE INDEX "bookings_user_id_idx" ON "bookings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_approval_status_idx" ON "bookings" USING btree ("approval_status");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_alerts_open_unique_idx" ON "admin_alerts" USING btree ("kind","booking_id","next_booking_id") WHERE "admin_alerts"."resolved_at" IS NULL;