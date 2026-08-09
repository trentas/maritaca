#!/usr/bin/env tsx
/**
 * Valida a configuração OTLP e testa a conectividade com o coletor, por sinal.
 * Uso: pnpm test:otlp  (ou: dotenv -e .env -- pnpm exec tsx scripts/test-otlp.ts)
 *
 * Testa os três caminhos separadamente — /v1/traces, /v1/metrics e /v1/logs —
 * porque eles falham de forma independente: o coletor pode ter pipeline de
 * trace e não ter de métrica, e o sdk-node não loga falha de export, então do
 * lado da app o sintoma é silêncio. Foi exatamente esse o caso da issue #76
 * (trace chegando, métrica nenhuma) e do bug da porta 4317 antes dele.
 *
 * Isto aqui é ferramenta de desenvolvimento: a imagem de produção carrega só o
 * `dist/`, sem `scripts/` nem `tsx`. Para rodar a mesma sonda em produção, use
 * o node que já está no container — o comando está em docs/observability.md,
 * seção "Traces appear but metrics don't".
 */

const endpointRaw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? ''
const logsEndpointRaw = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? ''
const insecure = process.env.OTEL_EXPORTER_OTLP_INSECURE ?? 'true'

// Vazio => o SDK OTLP usa http://localhost:4318 (spec do OTEL)
const effectiveBase =
  endpointRaw && endpointRaw.trim() !== ''
    ? endpointRaw.trim().replace(/\/$/, '')
    : 'http://localhost:4318'

interface Signal {
  nome: string
  url: string
  observacao?: string
}

const signals: Signal[] = [
  { nome: 'traces', url: `${effectiveBase}/v1/traces` },
  { nome: 'metrics', url: `${effectiveBase}/v1/metrics` },
  {
    nome: 'logs',
    url: logsEndpointRaw.trim() || `${effectiveBase}/v1/logs`,
    observacao: logsEndpointRaw.trim()
      ? 'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT definida — export OTLP de log está ligado'
      : 'opt-in desligado (o padrão): a app manda log só para o stdout',
  },
]

function log(msg: string, data?: object) {
  console.log(`[test-otlp] ${data ? `${msg} ${JSON.stringify(data)}` : msg}`)
}

interface ProbeResult {
  status?: number
  aceita?: boolean
  err?: string
}

/**
 * Manda um POST vazio em protobuf. Um coletor com o pipeline daquele sinal
 * ligado responde 200 ou 400 (payload inválido) — os dois provam que a rota
 * existe e está atendendo. 404 é o sinal de que o pipeline não existe ali, que
 * é o modo de falha que interessa detectar.
 */
async function probe(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array(0),
      signal: AbortSignal.timeout(5000),
    })
    return { status: res.status, aceita: res.status === 200 || res.status === 400 }
  } catch (e: any) {
    return { err: String(e?.cause?.code || e?.code || e?.message || e) }
  }
}

log('OTEL_EXPORTER_OTLP_ENDPOINT', {
  raw: endpointRaw || '(vazia – o SDK usará o default)',
  effectiveBase,
})
log('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', { raw: logsEndpointRaw || '(não definida)' })
log('OTEL_EXPORTER_OTLP_INSECURE', { value: insecure })
log('OTEL_METRIC_EXPORT_INTERVAL', { value: process.env.OTEL_METRIC_EXPORT_INTERVAL || '(default 60000)' })

if (!endpointRaw.trim()) {
  console.warn(
    '[test-otlp] AVISO: OTEL_EXPORTER_OTLP_ENDPOINT está vazia. Dentro do container o SDK usa\n' +
      '  http://localhost:4318, e ali localhost é o próprio container — um coletor em outro\n' +
      '  container não é alcançável assim.',
  )
}

let falhou = false

for (const signal of signals) {
  const r = await probe(signal.url)
  if (r.err) {
    falhou = true
    log(`${signal.nome}: FALHOU`, { url: signal.url, err: r.err })
  } else if (r.aceita) {
    log(`${signal.nome}: OK`, { url: signal.url, status: r.status })
  } else {
    falhou = true
    log(`${signal.nome}: ROTA NÃO ATENDE`, { url: signal.url, status: r.status })
    if (r.status === 404) {
      console.warn(
        `[test-otlp]   404 em /v1/${signal.nome} normalmente quer dizer que o coletor não tem\n` +
          `  pipeline de ${signal.nome} configurado (receivers: [otlp]). A app vai exportar e\n` +
          `  apanhar em silêncio — ligue OTEL_LOG_LEVEL=debug para ver o erro do SDK.`,
      )
    }
  }
  if (signal.observacao) log(`  nota (${signal.nome}): ${signal.observacao}`)
}

if (falhou) {
  process.exitCode = 1
  console.error('[test-otlp] Pelo menos um sinal não está sendo aceito pelo coletor.')
} else {
  console.log('[test-otlp] Todos os sinais aceitos pelo coletor.')
}
