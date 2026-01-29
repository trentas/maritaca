import pino from 'pino'
import { context, trace } from '@opentelemetry/api'

/**
 * Logger configuration options
 */
export interface LoggerOptions {
  /**
   * Log level (trace, debug, info, warn, error, fatal)
   * @default 'info'
   */
  level?: string

  /**
   * Service name
   * @default 'maritaca'
   */
  serviceName?: string

  /**
   * Service version
   * @default '0.1.0'
   */
  serviceVersion?: string

  /**
   * Enable pretty printing (for development)
   * @default false in production, true in development
   */
  pretty?: boolean
}

const defaultPinoFormatters: pino.LoggerOptions['formatters'] = {
  level: (label) => ({ level: label }),
  log: (object) => {
    const activeContext = context.active()
    const span = trace.getSpan(activeContext)
    if (span) {
      const spanContext = span.spanContext()
      return {
        ...object,
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        traceFlags: spanContext.traceFlags,
      }
    }
    return object
  },
}

/**
 * Serialize error for logging without stack trace (avoids noisy/sensitive stack in logs).
 * When LOG_LEVEL=debug, the stack is emitted in a separate debug line via the logger wrapper.
 */
function errSerializer(err: unknown): Record<string, unknown> | null {
  if (err == null) return null
  if (!(err instanceof Error)) return { type: 'Unknown', message: String(err) }
  const out: Record<string, unknown> = {
    type: err.name ?? 'Error',
    message: err.message ?? String(err),
  }
  if ('code' in err && err.code != null) out.code = err.code
  if (err.cause != null) {
    out.cause =
      err.cause instanceof Error
        ? { type: err.cause.name, message: err.cause.message }
        : String(err.cause)
  }
  return out
}

const defaultSerializers: pino.LoggerOptions['serializers'] = {
  err: errSerializer,
}

const ERROR_STACK_MSG = 'Error stack trace'

/**
 * Wraps a Pino logger so that when .error() is called with an object containing `err`,
 * and the logger level allows debug, a separate debug log line is emitted with the stack trace.
 * Child loggers inherit the overridden .error, so no call-site changes are needed.
 */
function wrapLoggerWithErrorStackDebug(log: pino.Logger): pino.Logger {
  const originalError = log.error
  log.error = function (this: pino.Logger, ...args: unknown[]) {
    const first = args[0]
    const hasErr =
      typeof first === 'object' &&
      first !== null &&
      'err' in first &&
      (first as { err: unknown }).err instanceof Error
    const err = hasErr ? (first as { err: Error }).err : null

    const result = (
      originalError as (this: pino.Logger, ...a: unknown[]) => unknown
    ).apply(this, args)

    if (err?.stack && this.isLevelEnabled('debug')) {
      this.debug({ stack: err.stack }, ERROR_STACK_MSG)
    }

    return result
  }
  return log
}

/**
 * Create a Pino logger instance with OpenTelemetry trace context integration.
 * Injects traceId and spanId when a span is active. If OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
 * is set, logs are also sent to that OTLP endpoint via pino-opentelemetry-transport.
 */
export async function createLogger(options: LoggerOptions = {}): Promise<pino.Logger> {
  const rawLevel = options.level ?? process.env.LOG_LEVEL ?? 'info'
  const level = typeof rawLevel === 'string' ? rawLevel.toLowerCase() : 'info'
  const serviceName = options.serviceName ?? 'maritaca'
  const serviceVersion = options.serviceVersion ?? '0.1.0'
  const pretty = options.pretty ?? process.env.NODE_ENV !== 'production'

  const baseOpts: pino.LoggerOptions = {
    level,
    base: { service: serviceName, version: serviceVersion },
    formatters: defaultPinoFormatters,
    serializers: defaultSerializers,
  }

  const logsEndpoint =
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '')}/v1/logs`
      : undefined)

  if (logsEndpoint) {
    const levelOpt = level as pino.Level
    // stdout primeiro: process.stdout no processo principal para docker logs; sync para reduzir buffer.
    const stdoutStream = pretty
      ? await pino.transport({
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
        })
      : pino.destination({ dest: 1, sync: true, minLength: 1 })

    const streams: pino.StreamEntry[] = [{ stream: stdoutStream, level: levelOpt }]

    try {
      const otelStream = await pino.transport({
        target: 'pino-opentelemetry-transport',
        options: {
          serviceVersion,
          resourceAttributes: { 'service.name': serviceName },
        },
      })
      streams.push({ stream: otelStream, level: levelOpt })
    } catch (_) {
      // OTLP transport falhou; segue só com stdout
    }

    return wrapLoggerWithErrorStackDebug(pino(baseOpts, pino.multistream(streams)))
  }

  if (pretty) {
    return wrapLoggerWithErrorStackDebug(
      pino({
        ...baseOpts,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
        },
      }),
    )
  }

  return wrapLoggerWithErrorStackDebug(pino(baseOpts))
}

/**
 * Create a synchronous Pino logger (no OTLP, no async transport).
 * Use when createLogger's async API is not suitable (e.g. in constructors).
 * Still injects traceId/spanId when a span is active.
 */
export function createSyncLogger(options: LoggerOptions = {}): pino.Logger {
  const rawLevel = options.level ?? process.env.LOG_LEVEL ?? 'info'
  const level = typeof rawLevel === 'string' ? rawLevel.toLowerCase() : 'info'
  const serviceName = options.serviceName ?? 'maritaca'
  const serviceVersion = options.serviceVersion ?? '0.1.0'
  return wrapLoggerWithErrorStackDebug(
    pino({
      level,
      base: { service: serviceName, version: serviceVersion },
      formatters: defaultPinoFormatters,
      serializers: defaultSerializers,
    }),
  )
}

/**
 * Create a child logger with additional context
 * 
 * Child loggers inherit the parent's configuration and add additional context fields
 * to all log entries. Useful for adding request IDs, message IDs, etc.
 */
export function createChildLogger(
  parent: pino.Logger,
  context: Record<string, unknown>,
): pino.Logger {
  return parent.child(context)
}

/**
 * Export Pino logger type
 */
export type Logger = pino.Logger
