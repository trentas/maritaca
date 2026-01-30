/**
 * OpenTelemetry instrumentation for maintenance scripts.
 * Exports init and shutdown so trigger-maintenance and run-maintenance can
 * export traces to the same OTEL endpoint as the worker.
 *
 * Requires OTEL_EXPORTER_OTLP_ENDPOINT to be set for traces to be exported.
 */

import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const serviceName = process.env.OTEL_SERVICE_NAME || 'maritaca-scripts'

const resource = new Resource({
  'service.name': serviceName,
  'deployment.environment': process.env.NODE_ENV || 'development',
})

const otelEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim()
const traceExporter = otelEndpoint ? new OTLPTraceExporter() : undefined

const sdk = new NodeSDK({
  resource,
  traceExporter,
})

let started = false

export async function initOtel(): Promise<void> {
  if (started) return
  await sdk.start()
  started = true
}

export async function shutdownOtel(): Promise<void> {
  if (!started) return
  try {
    await sdk.shutdown()
  } catch (err) {
    console.error('OTel shutdown error:', err)
  }
  started = false
}
