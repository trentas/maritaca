# Especificações da API Maritaca

Documento de referência para integrar aplicações ao Maritaca como cliente de mensageria.

## Visão geral

- **Base URL**: configurável (ex.: `http://localhost:7377` ou URL do seu deployment)
- **Prefixo**: `/v1` para todos os endpoints de mensagens
- **Content-Type**: `application/json`
- **Autenticação**: Bearer token (API key)

## Autenticação

Todas as requisições aos endpoints `/v1/*` devem enviar o header:

```
Authorization: Bearer <API_KEY>
```

- A API key é vinculada a um projeto no Maritaca.
- Sem o header ou com formato inválido: `401 Unauthorized`.
- Respostas de erro de autenticação:
  - `Missing or invalid Authorization header`
  - `API key is required`
  - `Invalid API key`

## Endpoints

### POST /v1/messages

Cria e enfileira uma mensagem para envio em um ou mais canais.

**Headers**

| Header             | Obrigatório | Descrição                    |
|--------------------|-------------|------------------------------|
| `Authorization`    | Sim         | `Bearer <API_KEY>`           |
| `Content-Type`     | Sim         | `application/json`           |

**Body (envelope)**

Objeto JSON validado pelo schema do core (Zod). Campos principais:

| Campo             | Tipo                    | Obrigatório | Descrição |
|-------------------|-------------------------|-------------|-----------|
| `idempotencyKey`  | string (min 1)          | Sim         | Chave de idempotência (por projeto). |
| `sender`          | object                  | Sim         | Remetente (nome, email). |
| `recipient`       | object \| object[]      | Sim         | Um destinatário ou lista de destinatários. |
| `channels`        | string[]                | Sim         | Um ou mais de: `email`, `slack`, `push`, `web`, `sms`, `whatsapp`, `telegram`. |
| `payload`         | object                  | Sim         | Conteúdo: `text` (obrigatório), `title`, `html` opcionais. |
| `metadata`        | object                  | Não         | Metadados opcionais. |
| `overrides`       | object                  | Não         | Overrides por canal. |
| `scheduleAt`      | string (ISO 8601)       | Não         | Agendamento. |
| `priority`        | string                  | Não         | `low`, `normal`, `high`. |

**Sender**

```json
{
  "name": "string (opcional)",
  "email": "string email (opcional)"
}
```

**Recipient** (depende do canal; pelo menos um identificador por canal usado)

- **Email**: `recipient.email` (string, email).
- **Slack**: `recipient.slack` — pelo menos um de: `userId`, `channelId`, `channelName`, `email`.
- **SMS**: `recipient.sms.phoneNumber` (E.164, ex.: `+5511999999999`).
- **WhatsApp**: `recipient.whatsapp.phoneNumber` (E.164).
- **Telegram**: `recipient.telegram.chatId` (string ou número); `username` opcional.
- **Push (mobile)**: `recipient.push` — ou `endpointArn` ou `deviceToken` + `platform` (`APNS`, `APNS_SANDBOX`, `GCM`).
- **Web Push**: `recipient.web` — `endpoint` (URL), `keys.p256dh`, `keys.auth`; `expirationTime` opcional.

**Payload**

```json
{
  "title": "string (opcional)",
  "text": "string (obrigatório)",
  "html": "string (opcional)"
}
```

**Overrides por canal** (todos opcionais)

- **email**: `subject`, `provider` (`resend` \| `ses` \| `mock`).
- **slack**: `blocks` (array).
- **sms**: `provider` (`sns` \| `twilio`), `messageType` (`Transactional` \| `Promotional`), `senderId` (max 11 caracteres).
- **whatsapp**: `contentSid`, `contentVariables`, `mediaUrl`.
- **push**: `badge`, `sound`, `data`, `ttl`.
- **web**: `icon`, `badge`, `image`, `tag`, `renotify`, `requireInteraction`, `vibrate`, `actions`, `data`, `ttl`, `urgency` (`very-low` \| `low` \| `normal` \| `high`).
- **telegram**: `parseMode` (`HTML` \| `MarkdownV2`), `disableNotification`, `replyToMessageId`.

**Resposta de sucesso**: `201 Created`

```json
{
  "messageId": "string (CUID2)",
  "status": "string (ex.: pending)",
  "channels": ["string"]
}
```

**Erros**

- `400`: body inválido — `error: "Validation Error"`, `message: "Invalid envelope format"`, `details` com erros Zod.
- `401`: não autenticado ou projeto não identificado.
- `429`: rate limit (ver seção Rate limiting).
- `500`: erro interno — `error: "Internal Server Error"`, `message: "Failed to create message"`.

**Idempotência**: O par `(projectId, idempotencyKey)` é único. Reenvios com a mesma chave retornam o mesmo `messageId` e status do registro já existente (201 com dados do registro existente).

---

### GET /v1/messages/:id

Retorna uma mensagem e seus eventos (status e histórico).

**Headers**

| Header          | Obrigatório | Descrição             |
|-----------------|-------------|------------------------|
| `Authorization` | Sim         | `Bearer <API_KEY>`    |

**Parâmetros de path**

| Nome | Tipo   | Descrição      |
|------|--------|----------------|
| `id` | string | ID da mensagem (CUID2). |

**Resposta de sucesso**: `200 OK`

```json
{
  "id": "string",
  "status": "string",
  "envelope": { },
  "events": [
    {
      "id": "string",
      "type": "string (ex.: message.accepted, message.queued, message.delivered)",
      "channel": "string (opcional)",
      "provider": "string (opcional)",
      "payload": "object (opcional)",
      "createdAt": "string ISO 8601"
    }
  ]
}
```

**Erros**

- `401`: não autenticado.
- `404`: mensagem não encontrada ou de outro projeto — `error: "Not Found"`, `message: "Message not found"`.
- `500`: erro interno.

---

### GET /health

Health check (sem autenticação). Usado para readiness/liveness.

**Resposta de sucesso**: `200` se saudável, `503` se degradado.

```json
{
  "status": "ok | degraded",
  "timestamp": "string ISO 8601",
  "checks": {
    "database": { "status": "ok | error", "latencyMs": number, "error": "string (opcional)" },
    "redis": { "status": "ok | error", "latencyMs": number, "error": "string (opcional)" }
  }
}
```

## Rate limiting

- Aplicado por `projectId` (requisições autenticadas) ou por IP (quando não autenticado).
- Configurável no servidor (ex.: 100 requisições por minuto).
- Headers de resposta: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`.
- Em excesso: `429 Too Many Requests`:
  - `error: "Too Many Requests"`
  - `message`: indica tempo para retry
  - `retryAfter`: segundos

O endpoint `/health` não é rate limited.

## Canais suportados

| Canal     | Valor no array `channels` |
|-----------|----------------------------|
| Email     | `email`                    |
| Slack     | `slack`                    |
| SMS       | `sms`                      |
| WhatsApp  | `whatsapp`                 |
| Telegram  | `telegram`                 |
| Push (mobile) | `push`                 |
| Web Push  | `web`                      |

## Uso do SDK (opcional)

Se o outro projeto for Node/TypeScript, pode usar o pacote `@maritaca/sdk`:

```ts
import { Maritaca } from '@maritaca/sdk'

const client = new Maritaca({
  apiKey: process.env.MARITACA_API_KEY!,
  baseUrl: 'https://sua-api-maritaca.example.com'
})

// Enviar mensagem
const { messageId, status, channels } = await client.messages.send({
  idempotencyKey: 'uniq-key-123',
  channels: ['email'],
  sender: { name: 'App', email: 'noreply@example.com' },
  recipient: { email: 'user@example.com' },
  payload: { title: 'Olá', text: 'Conteúdo em texto' }
})

// Consultar mensagem
const message = await client.messages.get(messageId)
```

Erros do SDK: `MaritacaAPIError` (respostas 4xx/5xx), `MaritacaNetworkError` (falha de rede), `MaritacaError` (base).

## Exemplo mínimo (cURL)

```bash
curl -X POST "${MARITACA_BASE_URL}/v1/messages" \
  -H "Authorization: Bearer ${MARITACA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "minimal-1",
    "channels": ["email"],
    "sender": { "name": "App", "email": "noreply@example.com" },
    "recipient": { "email": "user@example.com" },
    "payload": { "text": "Mensagem mínima" }
  }'
```

---

*Especificações extraídas do repositório Maritaca (API Fastify, core validation e SDK).*
