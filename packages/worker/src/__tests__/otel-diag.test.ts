import { describe, it, expect } from 'vitest'
import { DiagLogLevel } from '@opentelemetry/api'
import { resolveDiagLogLevel, metricExportIntervalMillis } from '../otel-diag.js'

describe('resolveDiagLogLevel', () => {
  it('defaults to WARN so export failures surface without extra config', () => {
    expect(resolveDiagLogLevel(undefined)).toBe(DiagLogLevel.WARN)
    expect(resolveDiagLogLevel('')).toBe(DiagLogLevel.WARN)
    expect(resolveDiagLogLevel('nao-existe')).toBe(DiagLogLevel.WARN)
  })

  it('accepts the documented levels, case and whitespace insensitive', () => {
    expect(resolveDiagLogLevel('debug')).toBe(DiagLogLevel.DEBUG)
    expect(resolveDiagLogLevel('  DEBUG ')).toBe(DiagLogLevel.DEBUG)
    expect(resolveDiagLogLevel('error')).toBe(DiagLogLevel.ERROR)
    expect(resolveDiagLogLevel('none')).toBe(DiagLogLevel.NONE)
    expect(resolveDiagLogLevel('all')).toBe(DiagLogLevel.ALL)
  })
})

describe('metricExportIntervalMillis', () => {
  it('defaults to 60s', () => {
    expect(metricExportIntervalMillis(undefined)).toBe(60_000)
    expect(metricExportIntervalMillis('')).toBe(60_000)
  })

  it('honours OTEL_METRIC_EXPORT_INTERVAL when it is a positive integer', () => {
    expect(metricExportIntervalMillis('5000')).toBe(5_000)
    expect(metricExportIntervalMillis(' 15000 ')).toBe(15_000)
  })

  it('falls back to the default on garbage, zero or negative values', () => {
    expect(metricExportIntervalMillis('abc')).toBe(60_000)
    expect(metricExportIntervalMillis('0')).toBe(60_000)
    expect(metricExportIntervalMillis('-1000')).toBe(60_000)
  })
})
