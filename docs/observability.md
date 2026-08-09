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
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | No | **Logs** endpoint — **explicit opt-in**. If unset, logs go to stdout only; setting `OTEL_EXPORTER_OTLP_ENDPOINT` alone does **not** enable log export (it covers traces and metrics). If you set it, use the full URL including `/v1/logs` (e.g. `http://host.docker.internal:4318/v1/logs`). Read the warning below first. |
| `OTEL_EXPORTER_OTLP_INSECURE` | No | `true` for HTTP (no TLS). Default: `true`. |
| `OTEL_METRIC_EXPORT_INTERVAL` | No | Milliseconds between metric export cycles. Default: `60000`. Lower it temporarily (e.g. `5000`) to check whether a collector-side fix took effect without waiting a full minute per attempt. |
| `OTEL_LOG_LEVEL` | No | Diagnostics from the OTel SDK itself: `none`, `error`, `warn` (default), `info`, `debug`, `verbose`. **Export failures are logged at `error`, so they are visible by default** — see the warning below. `debug` adds the stack trace to those lines. |

> **Export failures used to be silent, and no longer are.** The OTel SDK does
> not log a failed export on its own: if the collector refuses the POST — 404
> because that signal has no pipeline, connection refused, wrong port — the
> process keeps running and says nothing. That is how Maritaca went a full month
> without a single span reaching SigNoz (the compose pointed at `:4317`, gRPC,
> while the SDK exports over http/protobuf), and it is the same silence that hid
> the missing metrics.
>
> Both services now install a diagnostics logger before the SDK starts, so a
> refused export shows up in the normal log stream, in the same JSON shape as
> every other line:
>
> ```json
> {"level":"error","time":1786281404520,"service":"maritaca-worker","otel":true,
>  "msg":"PeriodicExportingMetricReader: metrics export failed (error OTLPExporterError: Not Found)"}
> ```
>
> When the collector is healthy this is completely quiet — it costs nothing
> until something is actually wrong.

\* If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, traces and metrics are not exported; the app still runs, just without sending telemetry.

> **Prefer stdout for logs.** When the app runs in a container next to a
> collector that reads the host journal, stdout is the better path and OTLP log
> export is redundant — or worse. Two reasons, both measured against the
> production collector on 2026-08-09:
>
> - `pino-opentelemetry-transport` builds its **own** resource and does not
>   inherit `OTEL_RESOURCE_ATTRIBUTES`. Inside a container its detection resolves
>   `host.name` to the **container ID**, so the service shows up under a host
>   nobody recognizes even when `host.name` is set correctly in compose.
> - Records exported this way arrived with `severity_number: 0` (no level at all)
>   and with `traceId`/`spanId` as plain string attributes, which the backend does
>   not turn into a log↔trace link.
>
> Reading the same logs from stdout via journald gave strictly more: real
> severity, native `trace_id`/`span_id`, and the pino fields flattened into
> filterable attributes. Enabling both also double-ingests every event, with a
> different severity on each path.

### 2.2. Example for Docker Compose (Maritaca + collector on the same host)

In Maritaca's `.env` (or `docker-compose` env):

```bash
# Adjust if your collector has a different host/name
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
# Opt-in only. Leave it commented to keep logs on stdout (recommended when a
# collector already reads the host journal) — see the warning in 2.1.
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
- **Metrics:** HTTP, Redis and PostgreSQL metrics from the instrumentations; Node.js runtime metrics (`nodejs.eventloop.*`, `v8js.*`) from `@opentelemetry/instrumentation-runtime-node`; plus custom business metrics (see below). Container CPU, memory and network are **not** exported by the app — those come from the host collector's `docker_stats`, so the runtime instrumentation covers only what the process itself can see: event loop lag, GC and heap.
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
| `maritaca.queue.jobs` | Observable gauge | `queue`, `status` | Jobs by queue and status (`waiting`, `active`, `delayed`, `failed`) |
| `maritaca.queue.oldest_job.age` | Observable gauge | `queue` | Age in seconds of the oldest job still waiting (`0` when empty) |
| `maritaca.health.latency` | Histogram | `component` | Health check latency (database, redis) |
| `maritaca.health.status` | Gauge | - | Overall health (1=healthy, 0=degraded) |

The two queue metrics are read from Redis by the worker at collection time — an
UpDownCounter would not work here, since jobs are enqueued by the API and
consumed by the worker and no single process sees every transition.

**`maritaca.queue.oldest_job.age` is the alertable one.** A deep queue that is
draining is normal; a job sitting untouched for fifteen minutes is an incident,
and unlike "no spans in the last hour" it says so without depending on there
being traffic. That distinction matters for a sparse email queue, where silence
is the normal state.

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

- `OTEL_EXPORTER_OTLP_ENDPOINT` — stops traces and metrics.
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` — stops the OTLP log transport. Unset is
  already the default; logs stay on stdout.

Logs always go to stdout regardless, so removing these never makes the app silent.

---

## 5. Troubleshooting

### Logs don't appear

If traces and metrics appear but logs don't:

1. **Logs pipeline in collector**  
   Your `otel-collector` needs a `logs` pipeline with `receivers: [otlp]`. See section 1.2. Some collectors don't enable logs by default.

2. **Environment variables in Maritaca**  
   OTLP log export requires `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` with the full URL including `/v1/logs`. `OTEL_EXPORTER_OTLP_ENDPOINT` on its own is **not** enough — it only covers traces and metrics. In Docker these must be in the `environment` section of `docker-compose` (the `.env` is loaded by compose).

   Before adding it, check whether you actually want this path: if a collector already reads the host journal, your logs are arriving via stdout with better fidelity. See the warning in section 2.1.

3. **Where to view logs in your platform**  
   Check the **Logs** section (not Traces or Metrics). Filter by `service.name` = `maritaca-api` or `maritaca-worker`.

4. **Batch delay**  
   Logs are sent in batches (e.g. every ~1 s). Wait a few seconds and generate traffic (requests, jobs) to see new log entries.

### Traces appear but metrics don't (or vice versa)

The three signals fail independently: a collector can have a `traces` pipeline
and no `metrics` one, and then the app exports metrics into a 404 forever. Since
the app's own configuration is a single base URL, "traces work" is **not**
evidence that metrics can work.

Check each path separately, from inside the container so name resolution and
network match what the app sees:

```bash
docker compose -f docker-compose.prod.yml exec worker pnpm test:otlp
```

```
[test-otlp] traces: OK {"url":"http://collector:4318/v1/traces","status":200}
[test-otlp] metrics: ROTA NÃO ATENDE {"url":"http://collector:4318/v1/metrics","status":404}
```

A 404 on one path means the collector has no pipeline for that signal — fix it
on the collector side (section 1.2), not here. Then confirm from the app side by
setting `OTEL_METRIC_EXPORT_INTERVAL=5000` for a few minutes and watching for the
export error lines to stop.

Two things that are **not** symptoms of a broken pipeline:

- **A metric with no data points never appears in the backend.** Counters are
  only exported after they are incremented at least once, so a quiet channel
  publishes nothing. The queue gauges are the exception: they are observable and
  report on every cycle, including `0`.
- **`system.*` metrics are absent by design.** Container CPU, memory and network
  come from the host collector's `docker_stats`, not from the app.

### Testing connectivity

Use the `test:otlp` script to validate your OTLP configuration:

```bash
pnpm test:otlp
```

It prints the resolved environment variables and probes `/v1/traces`,
`/v1/metrics` and `/v1/logs` separately, exiting non-zero if any of them is
refused.

---

## 6. References

- [OpenTelemetry – OTLP](https://opentelemetry.io/docs/specs/otlp/)
- [OpenTelemetry – SDK configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)
- [OpenTelemetry – Collector](https://opentelemetry.io/docs/collector/)
