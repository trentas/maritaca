/**
 * Guarda de regressão da issue #76.
 *
 * Um instrumento criado antes de existir MeterProvider global é no-op para
 * sempre — a API de métrica não religa o delegate depois, ao contrário da de
 * trace. Em produção o tsup empacota cada serviço num arquivo só e iça os
 * imports, então este módulo é avaliado antes do `sdk.start()`. Enquanto os
 * instrumentos eram criados na avaliação do módulo, nenhuma métrica de negócio
 * chegava ao backend, e nada no processo reclamava.
 *
 * Este arquivo importa o módulo de métricas ANTES de registrar o provider, que
 * é a ordem do bundle, e cobra que os valores cheguem mesmo assim.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { metrics as otelApi } from '@opentelemetry/api'
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'

// Import estático, avaliado antes de qualquer provider ser registrado abaixo.
import {
  recordMessageSent,
  recordProviderError,
  queueDepthGauge,
  queueOldestJobAgeGauge,
} from '../../metrics/index.js'

let exporter: InMemoryMetricExporter
let reader: PeriodicExportingMetricReader
let provider: MeterProvider

function nomesExportados(colecoes: ResourceMetrics[]): string[] {
  return colecoes.flatMap((rm) =>
    rm.scopeMetrics.flatMap((sm) => sm.metrics.map((m) => m.descriptor.name)),
  )
}

beforeAll(async () => {
  exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  // Intervalo alto: o flush é manual, para o teste não depender de tempo.
  reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 600_000 })
  provider = new MeterProvider({ readers: [reader] })
  otelApi.setGlobalMeterProvider(provider)
})

afterAll(async () => {
  await provider.shutdown()
  otelApi.disable()
})

describe('metric instruments resolve after the SDK starts', () => {
  it('records counters imported before the MeterProvider existed', async () => {
    recordMessageSent('email', 'success')
    recordProviderError('resend', 'RATE_LIMITED')

    await reader.forceFlush()
    const nomes = nomesExportados(exporter.getMetrics())

    expect(nomes).toContain('maritaca.messages.sent')
    expect(nomes).toContain('maritaca.provider.errors')
  })

  it('collects observable gauges registered before the MeterProvider existed', async () => {
    queueDepthGauge.addCallback((result) => {
      result.observe(3, { queue: 'maritaca-notifications', status: 'waiting' })
    })
    queueOldestJobAgeGauge.addCallback((result) => {
      result.observe(42, { queue: 'maritaca-notifications' })
    })

    await reader.forceFlush()
    const nomes = nomesExportados(exporter.getMetrics())

    expect(nomes).toContain('maritaca.queue.jobs')
    expect(nomes).toContain('maritaca.queue.oldest_job.age')
  })

  it('carries the observed values, not just the instrument names', async () => {
    await reader.forceFlush()
    const todas = exporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics))

    const idade = todas.find((m) => m.descriptor.name === 'maritaca.queue.oldest_job.age')
    expect(idade?.dataPoints.at(-1)?.value).toBe(42)

    const enviadas = todas.find((m) => m.descriptor.name === 'maritaca.messages.sent')
    expect(enviadas?.dataPoints.at(-1)?.value).toBe(1)
  })
})
