-- Add index on attempts.message_id for faster lookups
CREATE INDEX IF NOT EXISTS "attempts_message_id_idx" ON "attempts" USING btree ("message_id");
--> statement-breakpoint

-- Add composite index on events (message_id, created_at) for efficient filtering and ordering
CREATE INDEX IF NOT EXISTS "events_message_id_created_at_idx" ON "events" USING btree ("message_id", "created_at");
