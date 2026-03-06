-- Create integrations table for per-project OAuth credentials
CREATE TABLE IF NOT EXISTS "integrations" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" varchar(255) NOT NULL,
  "channel" varchar(50) NOT NULL,
  "provider" varchar(100) NOT NULL,
  "credentials" jsonb NOT NULL,
  "metadata" jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "installed_at" timestamp,
  "installed_by" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Unique constraint: one integration per project+channel+provider
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_project_channel_idx"
  ON "integrations" ("project_id", "channel", "provider");

-- Fast lookup by project
CREATE INDEX IF NOT EXISTS "integrations_project_id_idx"
  ON "integrations" ("project_id");
