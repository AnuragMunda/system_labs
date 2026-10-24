ALTER TABLE "simulations" ADD COLUMN "saved_at" timestamp;
--> statement-breakpoint
UPDATE "simulations"
SET "saved_at" = COALESCE("completed_at", "created_at")
WHERE "saved_at" IS NULL;
