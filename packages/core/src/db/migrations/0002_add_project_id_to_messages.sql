-- Migration: Add project_id to messages table
-- This migration adds multi-tenancy support by associating messages with projects

-- Step 1: Add project_id column (nullable initially)
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "project_id" varchar(255);
--> statement-breakpoint

-- Step 2: Create a legacy project for existing messages (if any exist)
-- This ensures existing messages remain accessible via a dedicated legacy project
-- The legacy project ID is deterministic so it can be referenced later
DO $$
DECLARE
  legacy_project_id varchar(255) := 'proj_legacy_' || md5('maritaca-legacy-project');
  has_messages boolean;
BEGIN
  -- Check if there are any messages without project_id
  SELECT EXISTS(SELECT 1 FROM "messages" WHERE "project_id" IS NULL) INTO has_messages;
  
  IF has_messages THEN
    -- Update existing messages with the legacy project ID
    UPDATE "messages" SET "project_id" = legacy_project_id WHERE "project_id" IS NULL;
    
    -- Log a notice about the migration
    RAISE NOTICE 'Migrated existing messages to legacy project: %', legacy_project_id;
    RAISE NOTICE 'To access these messages via API, create an API key for project: %', legacy_project_id;
  END IF;
END $$;
--> statement-breakpoint

-- Step 3: Make project_id NOT NULL after backfill
ALTER TABLE "messages" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint

-- Step 4: Drop any existing unique constraint on idempotency_key
-- Use dynamic SQL to find and drop the constraint regardless of its name
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- Find unique constraints on idempotency_key column
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'messages'
    AND att.attname = 'idempotency_key'
    AND con.contype = 'u'  -- unique constraint
    AND array_length(con.conkey, 1) = 1  -- single column constraint only
  LIMIT 1;
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "messages" DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped unique constraint: %', constraint_name;
  END IF;
  
  -- Also check for unique indexes (not constraints)
  SELECT indexname INTO constraint_name
  FROM pg_indexes
  WHERE tablename = 'messages'
    AND indexdef LIKE '%UNIQUE%'
    AND indexdef LIKE '%idempotency_key%'
    AND indexdef NOT LIKE '%project_id%'  -- Don't drop composite indexes
  LIMIT 1;
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('DROP INDEX IF EXISTS %I', constraint_name);
    RAISE NOTICE 'Dropped unique index: %', constraint_name;
  END IF;
END $$;
--> statement-breakpoint

-- Step 5: Create index on project_id for faster lookups
CREATE INDEX IF NOT EXISTS "messages_project_id_idx" ON "messages" USING btree ("project_id");
--> statement-breakpoint

-- Step 6: Create composite unique index for idempotency lookup within a project
-- This replaces the old global unique constraint with a per-project unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_idempotency_idx" ON "messages" USING btree ("project_id", "idempotency_key");
