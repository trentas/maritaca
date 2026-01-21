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
  serverName: serviceName,
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
  // #region agent log
  const dbg = (msg: string, d: object, hyp: string) => { fetch('http://127.0.0.1:7244/ingest/e10096f9-1cf5-4b11-9942-8eed4f6588b2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'api/instrumentation.ts:start',message:msg,data:d,timestamp:Date.now(),sessionId:'debug-session',hypothesisId:hyp,runId:'post-fix'})}).catch(()=>{}); };
  dbg('OTLP env', { OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '(vazio)', otelEndpoint, OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? '(vazio)', OTEL_EXPORTER_OTLP_INSECURE: process.env.OTEL_EXPORTER_OTLP_INSECURE }, 'H1');
  if (otelEndpoint) {
    const probeUrl = otelEndpoint.replace(/\/$/, '') + '/v1/traces';
    fetch(probeUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>({status:r.status,ok:r.ok})).catch(e=>({err:String(e?.cause?.code||e?.message||e)})).then(r=>{ dbg('OTLP connectivity probe',{connectivity:r,probeUrl},'H3'); if (r.err) console.warn('[OTLP] connectivity failed', r.err); else console.log('[OTLP] connectivity OK', r.status); });
  }
  // #endregion
  await sdk.start()
}

function shutdown() {
  sdk.shutdown().catch((err) => console.error('OTel SDK shutdown error', err))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await start()
