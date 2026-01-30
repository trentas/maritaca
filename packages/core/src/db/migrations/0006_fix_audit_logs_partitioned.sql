-- Fix: Replace non-partitioned audit_logs with partitioned table
-- Run this if audit_logs was created as a regular table (e.g. by Drizzle) and
-- you need PARTITION BY RANGE for partition maintenance. Drops the table only
-- when it exists and is not partitioned (relkind = 'r'). Data in audit_logs
-- will be lost when the table is dropped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'audit_logs' AND c.relkind = 'r'
  ) THEN
    DROP TABLE audit_logs CASCADE;
  END IF;
END $$;

-- Create partitioned table (no-op if already exists and partitioned)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    action VARCHAR(100) NOT NULL,
    actor_type VARCHAR(50) NOT NULL,
    actor_id TEXT NOT NULL,
    subject_type VARCHAR(50),
    subject_id TEXT,
    resource_type VARCHAR(50) NOT NULL,
    resource_id TEXT NOT NULL,
    project_id VARCHAR(255) NOT NULL,
    request_id TEXT,
    trace_id TEXT,
    pii_data JSONB,
    metadata JSONB,

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions (ignore if already exist)
DO $$
BEGIN
  CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;

-- Indexes (ignore if already exist)
CREATE INDEX IF NOT EXISTS audit_logs_subject_idx ON audit_logs (subject_id, created_at DESC)
    WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_project_idx ON audit_logs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs (resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, created_at DESC);
