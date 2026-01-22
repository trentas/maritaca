/**
 * OpenTelemetry instrumentation for maritaca-api.
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
import FastifyOtel from '@fastify/otel'

const serviceName = process.env.OTEL_SERVICE_NAME || 'maritaca-api'

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

const fastifyOtel = new FastifyOtel({
  registerOnInitialization: true,
  ignorePaths: (opts) => (opts.url ? opts.url.startsWith('/health') : false),
})

const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations: [
    fastifyOtel as any,
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
