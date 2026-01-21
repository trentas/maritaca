#!/usr/bin/env tsx
/**
 * Valida configuração OTLP e testa conectividade com o collector (ex.: SigNoz).
 * Uso: pnpm test:otlp  (ou: dotenv -e .env -- pnpm exec tsx scripts/test-otlp.ts)
 *
 * Verifica:
 * - Variáveis OTEL_EXPORTER_OTLP_* (vazia => SDK usa http://localhost:4318)
 * - Conectividade HTTP POST para /v1/traces
 */

const endpointRaw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ''
const logsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? ''
const insecure = process.env.OTEL_EXPORTER_OTLP_INSECURE ?? 'true'

// Quando vazio, o SDK OTLP usa o default http://localhost:4318 (especificação OTEL)
const effectiveBase = endpointRaw && endpointRaw.trim() !== ''
  ? endpointRaw.replace(/\/$/, '')
  : 'http://localhost:4318'

const tracesUrl = `${effectiveBase}/v1/traces`

function log(msg: string, data?: object) {
  const line = data ? `${msg} ${JSON.stringify(data)}` : msg
  console.log(`[test-otlp] ${line}`)
}

log('OTEL_EXPORTER_OTLP_ENDPOINT', { raw: endpointRaw || '(vazio – SDK usará default)', effectiveBase })
log('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', { raw: logsEndpoint || '(não definido)' })
log('OTEL_EXPORTER_OTLP_INSECURE', { value: insecure })

if (!endpointRaw || endpointRaw.trim() === '') {
  console.warn(
    '[test-otlp] AVISO: OTEL_EXPORTER_OTLP_ENDPOINT está vazio. No container, o SDK usará\n' +
    '  http://localhost:4318 (dentro do container localhost ≠ host; SigNoz em outro container não será alcançado).\n' +
    '  Defina no .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318 (Docker) ou\n' +
    '  http://localhost:4318 (app fora do Docker, SigNoz no host).'
  )
}

async function probeOne(url: string): Promise<{ status?: number; ok?: boolean; err?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const ok = res.ok || res.status === 400 || res.status === 415 || res.status === 404
    return { status: res.status, ok }
  } catch (e: any) {
    return { err: String(e?.cause?.code || e?.code || e?.message || e) }
  }
}

async function probe(): Promise<{ status?: number; ok?: boolean; err?: string }> {
  log('Testando conectividade', { url: tracesUrl })
  let r = await probeOne(tracesUrl)
  // host.docker.internal não resolve no host; fallback para localhost ao rodar test no host
  if (r.err === 'ENOTFOUND' && effectiveBase.includes('host.docker.internal')) {
    const localUrl = 'http://localhost:4318/v1/traces'
    log('host.docker.internal não resolve no host; tentando localhost (teste no host)', { url: localUrl })
    r = await probeOne(localUrl)
  }
  if (r.err) {
    log('Erro na sondagem', { err: r.err })
    console.error(
      '[test-otlp] Conectividade: FALHOU –', r.err, '\n' +
      '  Possíveis causas: coletor não está rodando, porta 4318 não exposta no host,\n' +
      '  hostname incorreto (ex.: localhost dentro do container), ou rede/firewall.'
    )
    process.exitCode = 1
    return r
  }
  log('Resposta do coletor', { status: r.status, ok: r.ok })
  if (r.ok) {
    console.log('[test-otlp] Conectividade: OK – o coletor está alcançável.')
  } else {
    console.warn('[test-otlp] Conectividade: respondeu com', r.status, '– verifique se o pipeline OTLP está habilitado.')
  }
  return r
}

;(async () => {
  const connectivity = await probe()
  fetch('http://127.0.0.1:7244/ingest/e10096f9-1cf5-4b11-9942-8eed4f6588b2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'scripts/test-otlp.ts',
      message: 'test-otlp result',
      data: { endpointRaw, effectiveBase, tracesUrl, connectivity },
      timestamp: Date.now(),
      sessionId: 'debug-session',
      hypothesisId: 'H1',
      runId: 'run1',
    }),
  }).catch(() => {})
})()
