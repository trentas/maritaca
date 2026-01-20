/**
 * OpenTelemetry instrumentation for maritaca-worker.
 * Must be loaded before any other application code (see index.ts).
 */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis'
import { BullMQInstrumentation } from '@appsignal/opentelemetry-instrumentation-bullmq'

const serviceName = process.env.OTEL_SERVICE_NAME || 'maritaca-worker'

const resource = new Resource({
  'service.name': serviceName,
  'deployment.environment': process.env.NODE_ENV || 'development',
})

const traceExporter = new OTLPTraceExporter()
const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter(),
  exportIntervalMillis: 60_000,
})

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations: [
    new HttpInstrumentation(),
    new IORedisInstrumentation(),
    new BullMQInstrumentation({
      useProducerSpanAsConsumerParent: true,
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
