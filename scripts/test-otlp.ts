#!/usr/bin/env tsx
/**
 * Validates OTLP configuration and tests connectivity with an OTLP collector.
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

log('OTEL_EXPORTER_OTLP_ENDPOINT', { raw: endpointRaw || '(empty – SDK will use default)', effectiveBase })
log('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', { raw: logsEndpoint || '(not set)' })
log('OTEL_EXPORTER_OTLP_INSECURE', { value: insecure })

if (!endpointRaw || endpointRaw.trim() === '') {
  console.warn(
    '[test-otlp] WARNING: OTEL_EXPORTER_OTLP_ENDPOINT is empty. In the container, the SDK will use\n' +
    '  http://localhost:4318 (inside the container localhost ≠ host; a collector in another container won\'t be reachable).\n' +
    '  Set in .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:4318 (Docker) or\n' +
    '  http://localhost:4318 (app outside Docker, collector on host).'
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
  log('Testing connectivity', { url: tracesUrl })
  let r = await probeOne(tracesUrl)
  // host.docker.internal doesn't resolve on host; fallback to localhost when running test on host
  if (r.err === 'ENOTFOUND' && effectiveBase.includes('host.docker.internal')) {
    const localUrl = 'http://localhost:4318/v1/traces'
    log('host.docker.internal doesn\'t resolve on host; trying localhost (host-side test)', { url: localUrl })
    r = await probeOne(localUrl)
  }
  if (r.err) {
    log('Probe error', { err: r.err })
    console.error(
      '[test-otlp] Connectivity: FAILED –', r.err, '\n' +
      '  Possible causes: collector not running, port 4318 not exposed on host,\n' +
      '  incorrect hostname (e.g. localhost inside container), or network/firewall.'
    )
    process.exitCode = 1
    return r
  }
  log('Collector response', { status: r.status, ok: r.ok })
  if (r.ok) {
    console.log('[test-otlp] Connectivity: OK – collector is reachable.')
  } else {
    console.warn('[test-otlp] Connectivity: responded with', r.status, '– verify OTLP pipeline is enabled.')
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
