-- Add provider external id and last event to attempts (for Resend webhook status and on-demand fetch)
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS provider_last_event VARCHAR(50);
CREATE INDEX IF NOT EXISTS attempts_external_id_idx ON attempts (external_id) WHERE external_id IS NOT NULL;
