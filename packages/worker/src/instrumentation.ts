/**
 * OpenTelemetry instrumentation for maritaca-worker.
 * Must be loaded before any other application code (see index.ts).
 *
 * Sampling Configuration:
 * - OTEL_TRACES_SAMPLER: Sampler type (always_on, always_off, traceidratio, parentbased_always_on, parentbased_always_off, parentbased_traceidratio)
 * - OTEL_TRACES_SAMPLER_ARG: Sampler argument (e.g., 0.1 for 10% sampling with traceidratio)
 *
 * @see https://opentelemetry.io/docs/languages/sdk-configuration/general/
 */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis'
import { BullMQInstrumentation } from '@appsignal/opentelemetry-instrumentation-bullmq'
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg'

const serviceName = process.env.OTEL_SERVICE_NAME || 'maritaca-worker'

const resource = new Resource({
  'service.name': serviceName,
  'deployment.environment': process.env.NODE_ENV || 'development',
})

const otelEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim()
const traceExporter = otelEndpoint ? new OTLPTraceExporter() : undefined
const metricReader = otelEndpoint
  ? new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 60_000,
    })
  : undefined

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  // Sampling is configured via environment variables:
  // - OTEL_TRACES_SAMPLER (e.g., "parentbased_traceidratio")
  // - OTEL_TRACES_SAMPLER_ARG (e.g., "0.1" for 10% sampling)
  // The NodeSDK reads these automatically from the environment.
  instrumentations: [
    new HttpInstrumentation(),
    new IORedisInstrumentation(),
    new BullMQInstrumentation({
      useProducerSpanAsConsumerParent: true,
    }),
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
    }),
  ],
})

async function start() {
  await sdk.start()
}

function shutdown() {
  sdk.shutdown().catch((err) => console.error('OTel SDK shutdown error', err))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await start()
