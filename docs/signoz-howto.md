# Howto: Integrating Maritaca with SigNoz

This guide describes how to configure **SigNoz** and **Maritaca** to send logs, traces and metrics via OpenTelemetry (OTLP).

## Overview

Maritaca sends OTLP telemetry to SigNoz's OpenTelemetry Collector. The Collector exposes:

- **OTLP/gRPC**: port `4317`
- **OTLP/HTTP**: port `4318`

Maritaca uses OTLP/HTTP by default (traces, metrics and logs).

---

## 1. SigNoz configuration

### 1.1. OTEL Collector network and ports

The SigNoz OpenTelemetry Collector must expose ports **4317** (gRPC) and **4318** (HTTP) to receive OTLP.

In the SigNoz `docker-compose` or deployment, the collector service (e.g. `otel-collector` or `signoz-otel-collector`) should have:

```yaml
ports:
  - "4317:4317"   # OTLP gRPC
  - "4318:4318"   # OTLP HTTP
```

If SigNoz was installed with the [official script](https://signoz.io/docs/install/docker/), this is usually already set.

### 1.2. Collector pipelines (traces, metrics, logs)

The SigNoz collector comes with pipelines for **traces**, **metrics** and **logs**. Ensure the `otlp` receiver is enabled for all three.

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

In standard SigNoz installs this is already defined; just confirm the **logs** pipeline exists and uses the `otlp` receiver.

**Se os logs não aparecerem no SigNoz:** alguns instaladores ou versões do SigNoz não habilitam o pipeline de **logs** por padrão. Verifique o `otel-collector` config (em geral em `deploy/docker/otel-collector-config.yaml` ou no `docker-compose` do SigNoz). Deve existir um bloco como:

```yaml
service:
  pipelines:
    # ... traces, metrics ...
    logs:
      receivers: [otlp]
      processors: [batch]   # ou o que o SigNoz usar (batch, memory_limiter, etc.)
      exporters: [otlp]     # ou o exporter que aponta para o backend do SigNoz
```

Se `logs` não existir, adicione-o. O receiver `otlp` já expõe HTTP em `0.0.0.0:4318`; o path `/v1/logs` é usado pelo cliente. Reinicie o `otel-collector` após alterar o config. Na UI do SigNoz, os logs costumam ficar na aba **Logs** (e não em Traces/Metrics).

### 1.3. Connectivity: Maritaca → Collector

- **Maritaca and SigNoz on the same host (Docker):**
  - If they are in the **same `docker-compose`** (or same network): use the collector **service name**, e.g.  
    `http://otel-collector:4318` or `http://signoz-otel-collector:4318` (according to your SigNoz `docker-compose`).
  - If **SigNoz** runs in another `docker-compose` on the same host:
    - **Linux:** use `http://host.docker.internal:4318` and add to Maritaca’s `docker-compose`:
      ```yaml
      extra_hosts:
        - "host.docker.internal:host-gateway"
      ```
    - **Docker Desktop (Mac/Windows):** `http://host.docker.internal:4318` usually works without `extra_hosts`.

- **Maritaca outside Docker, SigNoz on the same host:**  
  Use `http://localhost:4318` (or `http://127.0.0.1:4318`).

---

## 2. Maritaca configuration

### 2.1. Environment variables

Set these in `.env` (or in the container environment) when you want to send telemetry to SigNoz.

| Variable | Required | Description |
|----------|----------|-------------|
| `OTEL_SERVICE_NAME` | No | Service name in SigNoz. If unset, the API uses `maritaca-api` and the worker `maritaca-worker` (from Dockerfiles/compose). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Yes* | OTLP base endpoint, e.g. `http://<collector>:4318`. Used for **traces** and **metrics**. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | No | **Logs** endpoint. If unset, uses `OTEL_EXPORTER_OTLP_ENDPOINT` + `/v1/logs`. If you set it, use the full URL including `/v1/logs` (e.g. `http://host.docker.internal:4318/v1/logs`). |
| `OTEL_EXPORTER_OTLP_INSECURE` | No | `true` for HTTP (no TLS). Default: `true`. |

\* If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, traces and metrics are not exported; the app still runs, just without sending to SigNoz.

### 2.2. Example for Docker Compose (Maritaca + SigNoz on the same host)

In Maritaca’s `.env` (or `docker-compose` env):

```bash
# Adjust if your collector has a different host/name
OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318
# Optional; logs use /v1/logs on top of ENDPOINT if not set
# OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://host.docker.internal:4318/v1/logs
OTEL_EXPORTER_OTLP_INSECURE=true
```

In Maritaca’s `docker-compose.yml`, if you need `host.docker.internal` on Linux:

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

### 2.3. Example with Maritaca and SigNoz on the same Docker network

If both are on the same network (e.g. you attached Maritaca’s `docker-compose` to SigNoz’s network):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://<otlp-collector-service-name>:4318
OTEL_EXPORTER_OTLP_INSECURE=true
```

Replace `<otlp-collector-service-name>` with the OTEL Collector service name from SigNoz’s `docker-compose` (e.g. `otel-collector` or `signoz-otel-collector`).

---

## 3. What shows up in SigNoz

- **Traces:** API HTTP requests, BullMQ jobs (enqueue and process), Redis, and outbound HTTP (e.g. Slack). Services: `maritaca-api`, `maritaca-worker`.
- **Metrics:** HTTP, Redis, and Node/OTel metrics (from the instrumentations).
- **Logs:** Pino logs (API and worker) with `traceId`/`spanId` when a span is active, so you can link logs to traces in SigNoz.

---

## 4. Disabling export to SigNoz

Remove or leave empty in the environment:

- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` (if set)

Then traces and metrics are not exported and logs do not use the OTLP transport (they stay on stdout only).

---

## 5. Logs não aparecem no SigNoz

Sim, o Maritaca envia logs via OTLP quando `OTEL_EXPORTER_OTLP_ENDPOINT` (ou `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`) está definido. Se traces e métricas aparecem mas os logs não:

1. **Pipeline de logs no collector**  
   O `otel-collector` do SigNoz precisa de um pipeline `logs` com `receivers: [otlp]`. Veja a seção 1.2 e o bloco “Se os logs não aparecerem” em 1.2.

2. **Variáveis no Maritaca**  
   Confirme que `OTEL_EXPORTER_OTLP_ENDPOINT` está definido (ou `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` com URL completa, incluindo `/v1/logs`). O `pino-opentelemetry-transport` usa essas variáveis; no Docker, elas precisam estar no `environment` do `docker-compose` (o `.env` é carregado pelo compose).

3. **Onde ver os logs na UI**  
   Use a aba **Logs** do SigNoz, não Traces ou Metrics. Filtre por `service.name` = `maritaca-api` ou `maritaca-worker`.

4. **Atraso de batch**  
   Os logs são enviados em lotes (ex.: a cada ~1 s). Dê alguns segundos e gere tráfego (requests, jobs) para haver linhas novas.

---

## 6. References

- [SigNoz – OTLP ingestion (self‑hosted)](https://signoz.io/docs/ingestion/self-hosted/overview/)
- [SigNoz – Logs](https://signoz.io/docs/userguide/logs/)
- [OpenTelemetry – OTLP](https://opentelemetry.io/docs/specs/otlp/)
