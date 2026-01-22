-- Add project_id column to messages table
ALTER TABLE "messages" ADD COLUMN "project_id" varchar(255);
--> statement-breakpoint

-- Backfill existing messages with a default project_id (if any exist)
UPDATE "messages" SET "project_id" = 'default' WHERE "project_id" IS NULL;
--> statement-breakpoint

-- Make project_id NOT NULL after backfill
ALTER TABLE "messages" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint

-- Drop the old unique constraint on idempotency_key (it should be unique per project, not globally)
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_idempotency_key_unique";
--> statement-breakpoint

-- Create index on project_id for faster lookups
CREATE INDEX IF NOT EXISTS "messages_project_id_idx" ON "messages" USING btree ("project_id");
--> statement-breakpoint

-- Create composite index for idempotency lookup within a project
CREATE UNIQUE INDEX IF NOT EXISTS "messages_idempotency_idx" ON "messages" USING btree ("project_id", "idempotency_key");
