import { describe, it, expect } from 'vitest'
import { oldestWaitingAgeSeconds } from '../../queues/metrics.js'

/** Fila falsa: só o que `oldestWaitingAgeSeconds` consome. */
function fakeQueue(byIndex: Record<string, Array<{ timestamp: number }>>) {
  return {
    getWaiting: async (start: number, end: number) => byIndex[`${start}:${end}`] ?? [],
  } as unknown as Parameters<typeof oldestWaitingAgeSeconds>[0]
}

describe('oldestWaitingAgeSeconds', () => {
  const now = 1_700_000_000_000

  it('returns 0 for an empty queue', async () => {
    expect(await oldestWaitingAgeSeconds(fakeQueue({}), now)).toBe(0)
  })

  it('reports the age of the only waiting job', async () => {
    const queue = fakeQueue({
      '0:0': [{ timestamp: now - 90_000 }],
      '-1:-1': [{ timestamp: now - 90_000 }],
    })
    expect(await oldestWaitingAgeSeconds(queue, now)).toBe(90)
  })

  it('takes the oldest of both ends regardless of list direction', async () => {
    // O BullMQ empilha com LPUSH, então o mais antigo cai na cauda — mas o teste
    // cobre as duas direções de propósito: a ordenação é detalhe interno dele.
    const maisNovoNaCabeca = fakeQueue({
      '0:0': [{ timestamp: now - 10_000 }],
      '-1:-1': [{ timestamp: now - 600_000 }],
    })
    const maisNovoNaCauda = fakeQueue({
      '0:0': [{ timestamp: now - 600_000 }],
      '-1:-1': [{ timestamp: now - 10_000 }],
    })
    expect(await oldestWaitingAgeSeconds(maisNovoNaCabeca, now)).toBe(600)
    expect(await oldestWaitingAgeSeconds(maisNovoNaCauda, now)).toBe(600)
  })

  it('never reports a negative age when a job timestamp is in the future', async () => {
    const queue = fakeQueue({
      '0:0': [{ timestamp: now + 5_000 }],
      '-1:-1': [{ timestamp: now + 5_000 }],
    })
    expect(await oldestWaitingAgeSeconds(queue, now)).toBe(0)
  })

  it('ignores jobs with a missing or non-numeric timestamp', async () => {
    const queue = fakeQueue({
      '0:0': [{ timestamp: undefined as unknown as number }],
      '-1:-1': [{ timestamp: now - 30_000 }],
    })
    expect(await oldestWaitingAgeSeconds(queue, now)).toBe(30)
  })
})
