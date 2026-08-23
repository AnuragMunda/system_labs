ALTER TABLE "metrics" ADD COLUMN "node_id" varchar;--> statement-breakpoint
ALTER TABLE "metrics" ADD COLUMN "active_connections" integer;--> statement-breakpoint
ALTER TABLE "simulations" ADD COLUMN "seed" integer;--> statement-breakpoint
ALTER TABLE "simulations" ADD COLUMN "current_time_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulations" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "simulations" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "simulations" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "simulation_status";--> statement-breakpoint
CREATE TYPE "simulation_status" AS ENUM('created', 'running', 'paused', 'completed', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "simulations" ALTER COLUMN "status" SET DATA TYPE "simulation_status" USING "status"::"simulation_status";--> statement-breakpoint
ALTER TABLE "simulations" ALTER COLUMN "status" SET DEFAULT 'created'::"simulation_status";--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "requests_per_sec" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "avg_latency_ms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "error_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "queue_depth" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "metrics" ALTER COLUMN "cache_hit_rate" DROP NOT NULL;