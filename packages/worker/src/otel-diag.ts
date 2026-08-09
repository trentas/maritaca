/**
 * Diagnóstico do SDK OpenTelemetry e configuração do ciclo de export de métrica.
 *
 * Existe por causa de um modo de falha específico: o sdk-node NÃO loga falha de
 * export. Se o coletor recusar o POST — 404 porque o pipeline daquele sinal não
 * existe, conexão recusada, porta errada —, o processo segue rodando e não diz
 * nada. Foi assim que a maritaca ficou um mês sem span nenhum no SigNoz (o
 * compose apontava para :4317, gRPC, e o SDK exporta em http/protobuf), e é o
 * mesmo silêncio que aparece hoje nas métricas.
 *
 * Este módulo é importado pelo `instrumentation.ts`, que roda antes de qualquer
 * código de aplicação. Por isso ele não importa `@maritaca/core`: puxar o
 * barrel do core aqui faria o módulo de métricas ser avaliado antes do
 * `sdk.start()`. Daí o logger mínimo abaixo em vez do pino.
 */
import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api'

const LEVELS: Record<string, DiagLogLevel> = {
  none: DiagLogLevel.NONE,
  error: DiagLogLevel.ERROR,
  warn: DiagLogLevel.WARN,
  info: DiagLogLevel.INFO,
  debug: DiagLogLevel.DEBUG,
  verbose: DiagLogLevel.VERBOSE,
  all: DiagLogLevel.ALL,
}

/** Default: warn. Falha de export chega como ERROR, então aparece. */
export function resolveDiagLogLevel(raw = process.env.OTEL_LOG_LEVEL): DiagLogLevel {
  const key = (raw ?? '').trim().toLowerCase()
  return LEVELS[key] ?? DiagLogLevel.WARN
}

/**
 * Falha de export não chega aqui como Error: o `loggingErrorHandler` do
 * @opentelemetry/core faz `diag.error(stringifyException(ex))`, e o
 * `stringifyException` serializa o Error com `Object.getOwnPropertyNames`. O
 * que aparece é uma string JSON com message e stack dentro. Sem desembrulhar,
 * a linha vira um blob escapado — e essa é justamente a linha que alguém vai
 * ler às 3 da manhã.
 */
function unwrapStringifiedError(s: string): { text: string; stack?: string } | undefined {
  if (!s.startsWith('{') || !s.includes('"message"')) return undefined
  try {
    const parsed = JSON.parse(s) as { message?: unknown; stack?: unknown }
    if (typeof parsed.message !== 'string') return undefined
    return {
      text: parsed.message,
      stack: typeof parsed.stack === 'string' ? parsed.stack : undefined,
    }
  } catch {
    return undefined
  }
}

/** O SDK passa tanto Error quanto objetos soltos com message/stack. */
function describe(arg: unknown): { text: string; stack?: string } {
  if (typeof arg === 'string') return unwrapStringifiedError(arg) ?? { text: arg }
  if (arg instanceof Error) return { text: `${arg.name}: ${arg.message}`, stack: arg.stack }
  if (arg && typeof arg === 'object' && 'message' in arg) {
    const o = arg as { message?: unknown; stack?: unknown }
    return {
      text: String(o.message),
      stack: typeof o.stack === 'string' ? o.stack : undefined,
    }
  }
  return { text: safeStringify(arg) }
}

/**
 * Mesmo formato do pino (level como label, time em epoch ms, service, msg) para
 * o journald e o coletor tratarem essas linhas como qualquer outro log da app.
 *
 * O stack fica de fora da linha normal e só entra em nível debug, como faz o
 * errSerializer do logger da app.
 */
function write(level: string, serviceName: string, args: unknown[], comStack: boolean): void {
  const described = args.map(describe)
  const stack = described.find((d) => d.stack)?.stack
  const line = JSON.stringify({
    level,
    time: Date.now(),
    service: serviceName,
    otel: true,
    msg: described.map((d) => d.text).join(' '),
    ...(comStack && stack ? { stack } : {}),
  })
  process.stdout.write(`${line}\n`)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Liga o logger de diagnóstico do OTel.
 *
 * Chame antes do `sdk.start()`, para pegar falha de inicialização, e de novo
 * depois: quando `OTEL_LOG_LEVEL` está definida, o NodeSDK instala o
 * `DiagConsoleLogger` dele por cima (sdk.js, na inicialização) e a saída deixa
 * de ser JSON estruturado. Chamar duas vezes é inofensivo e devolve o formato
 * que o journald consegue parsear.
 */
export function setupOtelDiagLogging(serviceName: string): void {
  const level = resolveDiagLogLevel()
  const comStack = level >= DiagLogLevel.DEBUG
  const logger: DiagLogger = {
    error: (...args) => write('error', serviceName, args, comStack),
    warn: (...args) => write('warn', serviceName, args, comStack),
    info: (...args) => write('info', serviceName, args, comStack),
    debug: (...args) => write('debug', serviceName, args, comStack),
    verbose: (...args) => write('debug', serviceName, args, comStack),
  }
  // suppressOverrideMessage: sem isto a segunda chamada rende dois avisos de
  // "current logger will be overwritten" em todo boot, que é ruído puro.
  diag.setLogger(logger, { logLevel: level, suppressOverrideMessage: true })
}

/**
 * Intervalo do PeriodicExportingMetricReader, em ms.
 *
 * Honra a env padrão do OTel (`OTEL_METRIC_EXPORT_INTERVAL`) em vez do 60s
 * cravado que estava aqui: dá para baixar o intervalo em produção por alguns
 * minutos e conferir se uma correção no coletor pegou, sem rebuild.
 */
export function metricExportIntervalMillis(raw = process.env.OTEL_METRIC_EXPORT_INTERVAL): number {
  const parsed = Number.parseInt((raw ?? '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000
}
