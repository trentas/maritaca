/**
 * Centralized business metrics for Maritaca
 *
 * This module provides OpenTelemetry metric instruments for tracking
 * message sending, provider performance, and queue operations.
 *
 * @example
 * ```typescript
 * import { metrics, recordMessageSent, recordProcessingDuration } from '@maritaca/core'
 *
 * // Record a successful message send
 * recordMessageSent('email', 'success')
 *
 * // Record processing duration
 * recordProcessingDuration('email', 'resend', 150)
 *
 * // Record a provider error
 * metrics.providerErrors.add(1, { provider: 'resend', error_code: 'RATE_LIMITED' })
 * ```
 */
import {
  metrics as otelMetrics,
  ValueType,
  type Counter,
  type Histogram,
  type Meter,
  type ObservableGauge,
} from '@opentelemetry/api'

/**
 * Os instrumentos são resolvidos na primeira utilização, nunca na avaliação do
 * módulo. Isso não é preferência de estilo: um instrumento criado antes de
 * existir um MeterProvider global é um no-op PARA SEMPRE — a API de métrica não
 * tem proxy que religue o delegate depois, ao contrário da de trace.
 *
 *   getMeter(...).createCounter(...) antes do provider -> NoopCounterMetric
 *   getMeter(...).createCounter(...) depois            -> CounterInstrument
 *
 * E a avaliação deste módulo acontece cedo demais em produção. O tsup empacota
 * cada serviço num arquivo só e iça todos os imports para o topo, então
 * `@maritaca/core` é avaliado antes de o corpo do bundle chegar no
 * `sdk.start()`. Era essa a causa de nenhuma métrica de negócio aparecer no
 * SigNoz (issue #76) enquanto as métricas do próprio SDK chegavam normalmente —
 * essas são criadas pelas instrumentações, depois do start.
 *
 * Com a resolução preguiçosa, o instrumento nasce no primeiro `.add()` /
 * `.record()` / `.addCallback()`, que sempre parte do corpo do entrypoint ou de
 * um handler — ou seja, depois de o SDK ter subido.
 */
function lazyInstrument<T extends object>(create: (meter: Meter) => T): T {
  let real: T | undefined
  return new Proxy({} as T, {
    get(_target, prop) {
      real ??= create(otelMetrics.getMeter('maritaca', '1.0.0'))
      const value = (real as Record<PropertyKey, unknown>)[prop]
      return typeof value === 'function' ? value.bind(real) : value
    },
  })
}

/**
 * Meter instance for all Maritaca metrics.
 * Resolved on first use — see the note on `lazyInstrument`.
 */
export const meter: Meter = new Proxy({} as Meter, {
  get(_target, prop) {
    const real = otelMetrics.getMeter('maritaca', '1.0.0') as unknown as Record<PropertyKey, unknown>
    const value = real[prop]
    return typeof value === 'function' ? value.bind(real) : value
  },
})

/**
 * Counter for messages sent
 * Labels: channel (email, sms, slack, etc.), status (success, error)
 */
export const messagesSentCounter = lazyInstrument<Counter>((m) => m.createCounter('maritaca.messages.sent', {
  description: 'Total number of messages sent',
  unit: '{message}',
  valueType: ValueType.INT,
}))

/**
 * Histogram for message processing duration
 * Labels: channel, provider
 * Buckets optimized for typical notification latencies
 */
export const processingDurationHistogram = lazyInstrument<Histogram>((m) => m.createHistogram('maritaca.messages.processing.duration', {
  description: 'Message processing duration in milliseconds',
  unit: 'ms',
  valueType: ValueType.DOUBLE,
}))

/**
 * Counter for provider errors
 * Labels: provider, error_code
 */
export const providerErrorsCounter = lazyInstrument<Counter>((m) => m.createCounter('maritaca.provider.errors', {
  description: 'Total number of provider errors',
  unit: '{error}',
  valueType: ValueType.INT,
}))

/**
 * Counter for rate limit events
 * Labels: provider
 */
export const providerRateLimitsCounter = lazyInstrument<Counter>((m) => m.createCounter('maritaca.provider.rate_limits', {
  description: 'Total number of rate limit events from providers',
  unit: '{event}',
  valueType: ValueType.INT,
}))

/**
 * Observable gauge for queue depth
 * Labels: queue, status (waiting, active, delayed, failed, paused)
 *
 * Observable rather than an UpDownCounter on purpose: jobs are enqueued by the
 * API and consumed by the worker, so no single process sees every transition.
 * Polling Redis at collection time is the only way to get a number that is
 * actually true. Register a reader with `queueDepthGauge.addCallback(...)`.
 */
export const queueDepthGauge = lazyInstrument<ObservableGauge>((m) => m.createObservableGauge('maritaca.queue.jobs', {
  description: 'Current number of jobs by queue and status',
  unit: '{job}',
  valueType: ValueType.INT,
}))

/**
 * Observable gauge for the age of the oldest job still waiting
 * Labels: queue
 *
 * This is the alertable signal for a queue with sparse traffic: a deep queue
 * that is draining is normal, a job sitting untouched for 15 minutes is an
 * incident, and it says so without depending on there being traffic at all.
 */
export const queueOldestJobAgeGauge = lazyInstrument<ObservableGauge>((m) => m.createObservableGauge('maritaca.queue.oldest_job.age', {
  description: 'Age in seconds of the oldest job in the waiting state (0 when the queue is empty)',
  unit: 's',
  valueType: ValueType.DOUBLE,
}))

/**
 * Histogram for health check latencies
 * Labels: component (database, redis)
 */
export const healthLatencyHistogram = lazyInstrument<Histogram>((m) => m.createHistogram('maritaca.health.latency', {
  description: 'Health check latency in milliseconds',
  unit: 'ms',
  valueType: ValueType.DOUBLE,
}))

/**
 * Gauge for overall health status
 * Value: 1 = healthy, 0 = degraded
 */
export const healthStatusGauge = lazyInstrument<ObservableGauge>((m) => m.createObservableGauge('maritaca.health.status', {
  description: 'Overall health status (1=healthy, 0=degraded)',
  unit: '{status}',
  valueType: ValueType.INT,
}))

// ============================================================================
// Convenience functions for common metric operations
// ============================================================================

/**
 * Record a message sent event
 */
export function recordMessageSent(
  channel: string,
  status: 'success' | 'error',
): void {
  messagesSentCounter.add(1, { channel, status })
}

/**
 * Record message processing duration
 */
export function recordProcessingDuration(
  channel: string,
  provider: string,
  durationMs: number,
): void {
  processingDurationHistogram.record(durationMs, { channel, provider })
}

/**
 * Record a provider error
 */
export function recordProviderError(
  provider: string,
  errorCode: string,
): void {
  providerErrorsCounter.add(1, { provider, error_code: errorCode })
}

/**
 * Record a rate limit event
 */
export function recordRateLimit(provider: string): void {
  providerRateLimitsCounter.add(1, { provider })
}

/**
 * Record health check latency
 */
export function recordHealthLatency(
  component: 'database' | 'redis',
  latencyMs: number,
): void {
  healthLatencyHistogram.record(latencyMs, { component })
}

// ============================================================================
// Export all metrics as a convenience object
// ============================================================================

export const metrics = {
  meter,
  messagesSent: messagesSentCounter,
  processingDuration: processingDurationHistogram,
  providerErrors: providerErrorsCounter,
  providerRateLimits: providerRateLimitsCounter,
  queueDepth: queueDepthGauge,
  queueOldestJobAge: queueOldestJobAgeGauge,
  healthLatency: healthLatencyHistogram,
  healthStatus: healthStatusGauge,
}
