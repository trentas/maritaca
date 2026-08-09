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
import { metrics as otelMetrics, ValueType } from '@opentelemetry/api'

/**
 * Meter instance for all Maritaca metrics
 */
export const meter = otelMetrics.getMeter('maritaca', '1.0.0')

/**
 * Counter for messages sent
 * Labels: channel (email, sms, slack, etc.), status (success, error)
 */
export const messagesSentCounter = meter.createCounter('maritaca.messages.sent', {
  description: 'Total number of messages sent',
  unit: '{message}',
  valueType: ValueType.INT,
})

/**
 * Histogram for message processing duration
 * Labels: channel, provider
 * Buckets optimized for typical notification latencies
 */
export const processingDurationHistogram = meter.createHistogram('maritaca.messages.processing.duration', {
  description: 'Message processing duration in milliseconds',
  unit: 'ms',
  valueType: ValueType.DOUBLE,
})

/**
 * Counter for provider errors
 * Labels: provider, error_code
 */
export const providerErrorsCounter = meter.createCounter('maritaca.provider.errors', {
  description: 'Total number of provider errors',
  unit: '{error}',
  valueType: ValueType.INT,
})

/**
 * Counter for rate limit events
 * Labels: provider
 */
export const providerRateLimitsCounter = meter.createCounter('maritaca.provider.rate_limits', {
  description: 'Total number of rate limit events from providers',
  unit: '{event}',
  valueType: ValueType.INT,
})

/**
 * Observable gauge for queue depth
 * Labels: queue, status (waiting, active, delayed, failed, paused)
 *
 * Observable rather than an UpDownCounter on purpose: jobs are enqueued by the
 * API and consumed by the worker, so no single process sees every transition.
 * Polling Redis at collection time is the only way to get a number that is
 * actually true. Register a reader with `queueDepthGauge.addCallback(...)`.
 */
export const queueDepthGauge = meter.createObservableGauge('maritaca.queue.jobs', {
  description: 'Current number of jobs by queue and status',
  unit: '{job}',
  valueType: ValueType.INT,
})

/**
 * Observable gauge for the age of the oldest job still waiting
 * Labels: queue
 *
 * This is the alertable signal for a queue with sparse traffic: a deep queue
 * that is draining is normal, a job sitting untouched for 15 minutes is an
 * incident, and it says so without depending on there being traffic at all.
 */
export const queueOldestJobAgeGauge = meter.createObservableGauge('maritaca.queue.oldest_job.age', {
  description: 'Age in seconds of the oldest job in the waiting state (0 when the queue is empty)',
  unit: 's',
  valueType: ValueType.DOUBLE,
})

/**
 * Histogram for health check latencies
 * Labels: component (database, redis)
 */
export const healthLatencyHistogram = meter.createHistogram('maritaca.health.latency', {
  description: 'Health check latency in milliseconds',
  unit: 'ms',
  valueType: ValueType.DOUBLE,
})

/**
 * Gauge for overall health status
 * Value: 1 = healthy, 0 = degraded
 */
export const healthStatusGauge = meter.createObservableGauge('maritaca.health.status', {
  description: 'Overall health status (1=healthy, 0=degraded)',
  unit: '{status}',
  valueType: ValueType.INT,
})

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
