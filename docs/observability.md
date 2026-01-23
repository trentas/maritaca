# Observability with OpenTelemetry

This guide describes how to configure **Maritaca** to send logs, traces and metrics via OpenTelemetry (OTLP) to any OTLP-compatible observability backend.

## Overview

Maritaca exports telemetry using the OpenTelemetry Protocol (OTLP) over HTTP. The telemetry includes:

- **Traces**: API HTTP requests, BullMQ jobs (enqueue and process), Redis operations, and outbound HTTP calls
- **Metrics**: HTTP, Redis, and Node.js/OpenTelemetry metrics from the instrumentations
- **Logs**: Pino logs (API and worker) with `traceId`/`spanId` when a span is active, enabling log-to-trace correlation

Maritaca uses **OTLP/HTTP** by default (traces, metrics and logs).

---

## 1. OTLP Collector configuration

### 1.1. Collector network and ports

Your OpenTelemetry Collector (or observability platform's collector) must expose ports to receive OTLP:

- **OTLP/gRPC**: port `4317`
- **OTLP/HTTP**: port `4318`

Maritaca uses OTLP/HTTP (port `4318`) by default.

In your collector's `docker-compose` or deployment, the collector service should have:

```yaml
ports:
  - "4317:4317"   # OTLP gRPC (optional, if you want gRPC support)
  - "4318:4318"   # OTLP HTTP (required)
```

### 1.2. Collector pipelines (traces, metrics, logs)

Your collector must have pipelines for **traces**, **metrics** and **logs** with the `otlp` receiver enabled.

Typical collector config:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

service:
  pipelines:
    traces:
      receivers: [otlp]
      # ... processors and exporters
    metrics:
      receivers: [otlp]
      # ...
    logs:
      receivers: [otlp]
      # ...
```

**Note on logs pipeline:** Some collectors don't enable the **logs** pipeline by default. If logs don't appear in your observability platform, verify that the `logs` pipeline exists and uses the `otlp` receiver. The receiver should expose HTTP at `0.0.0.0:4318`; the path `/v1/logs` is used by the client. Restart the collector after changing the config.

### 1.3. Connectivity: Maritaca → Collector

- **Maritaca and collector on the same host (Docker):**
  - If they are in the **same `docker-compose`** (or same network): use the collector **service name**, e.g.  
    `http://otel-collector:4318` or `http://<your-collector-service>:4318`.
  - If the **collector** runs in another `docker-compose` on the same host:
    - **Linux:** use `http://host.docker.internal:4318` and add to Maritaca's `docker-compose`:
      ```yaml
      extra_hosts:
        - "host.docker.internal:host-gateway"
      ```
    - **Docker Desktop (Mac/Windows):** `http://host.docker.internal:4318` usually works without `extra_hosts`.

- **Maritaca outside Docker, collector on the same host:**  
  Use `http://localhost:4318` (or `http://127.0.0.1:4318`).

---

## 2. Maritaca configuration

### 2.1. Environment variables

Set these in `.env` (or in the container environment) when you want to send telemetry to an OTLP collector.

| Variable | Required | Description |
|----------|----------|-------------|
| `OTEL_SERVICE_NAME` | No | Service name in your observability platform. If unset, the API uses `maritaca-api` and the worker `maritaca-worker` (from Dockerfiles/compose). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Yes* | OTLP base endpoint, e.g. `http://<collector>:4318`. Used for **traces** and **metrics**. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | No | **Logs** endpoint. If unset, uses `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/logs`. If you set it, use the full URL including `/v1/logs` (e.g. `http://host.docker.internal:4318/v1/logs`). |
| `OTEL_EXPORTER_OTLP_INSECURE` | No | `true` for HTTP (no TLS). Default: `true`. |

\* If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, traces and metrics are not exported; the app still runs, just without sending telemetry.

### 2.2. Example for Docker Compose (Maritaca + collector on the same host)

In Maritaca's `.env` (or `docker-compose` env):

```bash
# Adjust if your collector has a different host/name
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
# Optional; logs use /v1/logs on top of ENDPOINT if not set
# OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://host.docker.internal:4318/v1/logs
OTEL_EXPORTER_OTLP_INSECURE=true
```

In Maritaca's `docker-compose.yml`, if you need `host.docker.internal` on Linux:

```yaml
api:
  extra_hosts:
    - "host.docker.internal:host-gateway"
  # ... rest of the service

worker:
  extra_hosts:
    - "host.docker.internal:host-gateway"
  # ...
```

### 2.3. Example with Maritaca and collector on the same Docker network

If both are on the same network (e.g. you attached Maritaca's `docker-compose` to the collector's network):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://<otlp-collector-service-name>:4318
OTEL_EXPORTER_OTLP_INSECURE=true
```

Replace `<otlp-collector-service-name>` with the OTEL Collector service name from your collector's `docker-compose` (e.g. `otel-collector` or `<your-platform>-otel-collector`).

---

## 3. What gets exported

- **Traces:** API HTTP requests, BullMQ jobs (enqueue and process), Redis operations, PostgreSQL queries, and outbound HTTP (e.g. Slack). Services: `maritaca-api`, `maritaca-worker`.
- **Metrics:** HTTP, Redis, PostgreSQL, Node/OTel metrics (from the instrumentations), plus custom business metrics (see below).
- **Logs:** Pino logs (API and worker) with `traceId`/`spanId` when a span is active, so you can link logs to traces in your observability platform.

---

## 3.1. Custom Business Metrics

Maritaca exports custom metrics for monitoring notification delivery performance and health:

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `maritaca.messages.sent` | Counter | `channel`, `status` | Total messages sent (status: success/error) |
| `maritaca.messages.processing.duration` | Histogram | `channel`, `provider` | Message processing duration in ms |
| `maritaca.provider.errors` | Counter | `provider`, `error_code` | Provider errors by type |
| `maritaca.provider.rate_limits` | Counter | `provider` | Rate limit events from providers |
| `maritaca.queue.jobs` | UpDownCounter | `queue`, `status` | Jobs by queue and status |
| `maritaca.health.latency` | Histogram | `component` | Health check latency (database, redis) |
| `maritaca.health.status` | Gauge | - | Overall health (1=healthy, 0=degraded) |

### Label Values

**Channels:** `email`, `sms`, `slack`, `telegram`, `push`, `web`, `whatsapp`

**Providers:** `resend`, `ses`, `mock-email`, `sns-sms`, `sns-push`, `twilio-sms`, `twilio-whatsapp`, `slack`, `telegram`, `web-push`

**Status:** `success`, `error`

---

## 3.2. Trace Sampling

For high-volume production environments, you can configure trace sampling to reduce telemetry costs while maintaining visibility.

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OTEL_TRACES_SAMPLER` | Sampler type | `parentbased_traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | Sampler argument | `0.1` (10% sampling) |

### Sampler Types

- `always_on` - Sample all traces (default)
- `always_off` - Sample no traces
- `traceidratio` - Sample based on trace ID ratio
- `parentbased_always_on` - Follow parent, default to always on
- `parentbased_always_off` - Follow parent, default to always off
- `parentbased_traceidratio` - Follow parent, default to ratio (recommended)

### Example Configuration

```bash
# Sample 10% of traces in production
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

---

## 3.3. Example Prometheus Alerts

```yaml
groups:
  - name: maritaca
    rules:
      # High error rate alert
      - alert: MaritacaHighErrorRate
        expr: |
          sum(rate(maritaca_messages_sent_total{status="error"}[5m])) 
          / sum(rate(maritaca_messages_sent_total[5m])) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High message error rate (> 10%)"
          description: "Error rate is {{ $value | humanizePercentage }}"

      # Provider rate limiting alert
      - alert: MaritacaProviderRateLimited
        expr: sum(rate(maritaca_provider_rate_limits_total[5m])) by (provider) > 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Provider {{ $labels.provider }} is being rate limited"

      # High processing latency alert
      - alert: MaritacaHighLatency
        expr: |
          histogram_quantile(0.95, 
            sum(rate(maritaca_messages_processing_duration_bucket[5m])) by (le, channel)
          ) > 5000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High processing latency for {{ $labels.channel }}"
          description: "P95 latency is {{ $value }}ms"

      # Health check failures
      - alert: MaritacaUnhealthy
        expr: maritaca_health_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Maritaca service is unhealthy"
          description: "Health check is failing"

      # Database latency alert
      - alert: MaritacaDatabaseSlow
        expr: |
          histogram_quantile(0.95, 
            sum(rate(maritaca_health_latency_bucket{component="database"}[5m])) by (le)
          ) > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database health check latency is high"
          description: "P95 latency is {{ $value }}ms"
```

---

## 3.4. Example Grafana Dashboard

Import this JSON into Grafana to create a Maritaca monitoring dashboard:

```json
{
  "title": "Maritaca Notifications",
  "uid": "maritaca-main",
  "panels": [
    {
      "title": "Messages Sent (per second)",
      "type": "timeseries",
      "gridPos": { "x": 0, "y": 0, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "sum(rate(maritaca_messages_sent_total[5m])) by (channel, status)",
          "legendFormat": "{{ channel }} - {{ status }}"
        }
      ]
    },
    {
      "title": "Error Rate by Channel",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 0, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "sum(rate(maritaca_messages_sent_total{status=\"error\"}[5m])) by (channel) / sum(rate(maritaca_messages_sent_total[5m])) by (channel) * 100",
          "legendFormat": "{{ channel }}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "percent"
        }
      }
    },
    {
      "title": "Processing Latency (P95)",
      "type": "timeseries",
      "gridPos": { "x": 0, "y": 8, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(maritaca_messages_processing_duration_bucket[5m])) by (le, channel))",
          "legendFormat": "{{ channel }}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "ms"
        }
      }
    },
    {
      "title": "Provider Errors",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 8, "w": 12, "h": 8 },
      "targets": [
        {
          "expr": "sum(rate(maritaca_provider_errors_total[5m])) by (provider, error_code)",
          "legendFormat": "{{ provider }} - {{ error_code }}"
        }
      ]
    },
    {
      "title": "Rate Limits",
      "type": "stat",
      "gridPos": { "x": 0, "y": 16, "w": 6, "h": 4 },
      "targets": [
        {
          "expr": "sum(increase(maritaca_provider_rate_limits_total[1h])) by (provider)",
          "legendFormat": "{{ provider }}"
        }
      ]
    },
    {
      "title": "Health Status",
      "type": "stat",
      "gridPos": { "x": 6, "y": 16, "w": 6, "h": 4 },
      "targets": [
        {
          "expr": "maritaca_health_status",
          "legendFormat": "Health"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "mappings": [
            { "type": "value", "options": { "0": { "text": "Degraded", "color": "red" } } },
            { "type": "value", "options": { "1": { "text": "Healthy", "color": "green" } } }
          ]
        }
      }
    },
    {
      "title": "Health Check Latency",
      "type": "timeseries",
      "gridPos": { "x": 12, "y": 16, "w": 12, "h": 4 },
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(maritaca_health_latency_bucket[5m])) by (le, component))",
          "legendFormat": "{{ component }}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "ms"
        }
      }
    }
  ]
}
```

---

## 4. Disabling telemetry export

Remove or leave empty in the environment:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (if set)

Then traces and metrics are not exported and logs do not use the OTLP transport (they stay on stdout only).

---

## 5. Troubleshooting

### Logs don't appear

If traces and metrics appear but logs don't:

1. **Logs pipeline in collector**  
   Your `otel-collector` needs a `logs` pipeline with `receivers: [otlp]`. See section 1.2. Some collectors don't enable logs by default.

2. **Environment variables in Maritaca**  
   Confirm that `OTEL_EXPORTER_OTLP_ENDPOINT` is set (or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` with full URL, including `/v1/logs`). The `pino-opentelemetry-transport` uses these variables; in Docker, they must be in the `environment` section of `docker-compose` (the `.env` is loaded by compose).

3. **Where to view logs in your platform**  
   Check the **Logs** section (not Traces or Metrics). Filter by `service.name` = `maritaca-api` or `maritaca-worker`.

4. **Batch delay**  
   Logs are sent in batches (e.g. every ~1 s). Wait a few seconds and generate traffic (requests, jobs) to see new log entries.

### Testing connectivity

Use the `test:otlp` script to validate your OTLP configuration:

```bash
pnpm test:otlp
```

This checks environment variables and tests connectivity to the `/v1/traces` endpoint.

---

## 6. References

- [OpenTelemetry – OTLP](https://opentelemetry.io/docs/specs/otlp/)
- [OpenTelemetry – SDK configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)
- [OpenTelemetry – Collector](https://opentelemetry.io/docs/collector/)
