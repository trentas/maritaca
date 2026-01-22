-- Audit logs table with partitioning for GDPR/LGPD compliance
-- Partitioned by month on created_at for efficient sharding and retention management

CREATE TABLE audit_logs (
    id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Event classification
    action VARCHAR(100) NOT NULL,  -- 'email.sent', 'slack.delivered', etc.
    
    -- Actor (who performed the action)
    actor_type VARCHAR(50) NOT NULL,  -- 'system', 'user', 'api_key'
    actor_id TEXT NOT NULL,
    
    -- Subject (who is affected - for DSAR queries)
    subject_type VARCHAR(50),  -- 'user', 'recipient'
    subject_id TEXT,           -- hashed identifier for privacy
    
    -- Resource (what was acted upon)
    resource_type VARCHAR(50) NOT NULL,  -- 'message', 'notification'
    resource_id TEXT NOT NULL,
    
    -- Context
    project_id VARCHAR(255) NOT NULL,
    request_id TEXT,
    trace_id TEXT,
    
    -- PII data (encrypted JSON) - only decrypted for authorized access
    pii_data JSONB,
    
    -- Non-PII metadata
    metadata JSONB,
    
    -- Composite primary key required for partitioning
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for 2026 (adjust based on current date)
CREATE TABLE audit_logs_2026_01 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE audit_logs_2026_02 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE audit_logs_2026_04 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE audit_logs_2026_05 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE audit_logs_2026_06 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Indexes for common query patterns
-- Subject lookup for DSAR (Data Subject Access Requests)
CREATE INDEX audit_logs_subject_idx ON audit_logs (subject_id, created_at DESC)
    WHERE subject_id IS NOT NULL;

-- Project-scoped queries
CREATE INDEX audit_logs_project_idx ON audit_logs (project_id, created_at DESC);

-- Resource lookup (find all events for a message)
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_id, created_at DESC);

-- Action type filtering
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
