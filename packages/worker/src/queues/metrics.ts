/**
 * Publica profundidade e idade da fila como métrica OTLP.
 *
 * Por que isto existe: a maritaca ficou de fora do dead man's switch de
 * telemetria da frota de propósito. As regras dos outros produtos usam "sem
 * span há 1h" como sinal de app muda, o que só funciona com tráfego contínuo.
 * Aqui é fila de email — houve dia de 2 requests em 6h —, então ausência de
 * span não distingue "quebrada" de "ninguém pediu email".
 *
 * A idade do job mais antigo é o sinal que resolve isso: fila funda drenando é
 * normal, job parado há 15 minutos é incidente, e o número existe mesmo sem
 * tráfego nenhum.
 */
import { Queue } from 'bullmq'
import {
  queueDepthGauge,
  queueOldestJobAgeGauge,
  type Logger,
  type RedisConnectionConfig,
} from '@maritaca/core'

/** Estados que valem como profundidade acionável. */
const TRACKED_STATES = ['waiting', 'active', 'delayed', 'failed'] as const

export interface QueueMetricsOptions {
  connection: RedisConnectionConfig
  /** Nomes das filas a observar. */
  queueNames: string[]
  logger: Logger
}

export interface QueueMetricsHandle {
  /** Fecha as conexões Redis abertas para a coleta. */
  close: () => Promise<void>
}

/**
 * Idade, em segundos, do job em espera há mais tempo — 0 se não há nenhum.
 *
 * Pega as duas pontas da lista de espera em vez de assumir a direção da
 * ordenação: o BullMQ empilha com LPUSH e consome pela outra ponta, mas isso é
 * detalhe interno dele. Duas leituras O(1) e o mínimo entre elas dá a resposta
 * certa independentemente da direção.
 */
export async function oldestWaitingAgeSeconds(
  queue: Pick<Queue, 'getWaiting'>,
  now: number = Date.now(),
): Promise<number> {
  const [head, tail] = await Promise.all([queue.getWaiting(0, 0), queue.getWaiting(-1, -1)])
  const timestamps = [...head, ...tail]
    .map((job) => job?.timestamp)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))

  if (timestamps.length === 0) return 0
  const oldest = Math.min(...timestamps)
  return Math.max(0, (now - oldest) / 1000)
}

/**
 * Registra os callbacks de observação. Os gauges são observáveis, então a
 * leitura do Redis acontece no ciclo de export (60s por padrão), não a cada job.
 */
export function startQueueMetrics(options: QueueMetricsOptions): QueueMetricsHandle {
  const { connection, queueNames, logger } = options
  const queues = queueNames.map((name) => new Queue(name, { connection }))

  queueDepthGauge.addCallback(async (result) => {
    for (const queue of queues) {
      try {
        const counts = await queue.getJobCounts(...TRACKED_STATES)
        for (const status of TRACKED_STATES) {
          result.observe(counts[status] ?? 0, { queue: queue.name, status })
        }
      } catch (err) {
        logger.warn({ err, queue: queue.name }, 'Failed to read queue depth for metrics')
      }
    }
  })

  queueOldestJobAgeGauge.addCallback(async (result) => {
    for (const queue of queues) {
      try {
        result.observe(await oldestWaitingAgeSeconds(queue), { queue: queue.name })
      } catch (err) {
        logger.warn({ err, queue: queue.name }, 'Failed to read oldest job age for metrics')
      }
    }
  })

  logger.info({ queues: queueNames }, 'Queue metrics registered')

  return {
    close: async () => {
      await Promise.all(queues.map((queue) => queue.close()))
    },
  }
}
