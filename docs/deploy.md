# Deploy em produção (GitHub Actions + VPS)

Este documento descreve o deploy do Maritaca em produção usando GitHub Actions: build das imagens (API e Worker), push para o GitHub Container Registry (GHCR) e deploy via SSH em um VPS. O `.env` de produção é **gerado no deploy** a partir do GitHub Environment `production` (variáveis e secrets); não é editado manualmente no VPS.

## Visão geral

- **Workflow:** [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — disparo manual (`workflow_dispatch`) ou em `push` na branch `main`.
- **Imagens:** publicadas em `ghcr.io/<owner>/<repo>/maritaca-api`, `maritaca-worker` e `maritaca-migrate` (tags `latest` e `sha-<commit>`).
- **VPS:** SSH com chave; no servidor são executados pull, `up -d postgres`, **migrações** (`docker compose run --rm migrate`) e depois `up -d` (api e worker).
- **Redis:** não sobe no compose de produção; use o Redis já existente no VPS com **database separado** (ex.: `REDIS_URL=redis://host.docker.internal:6379/1`).
- **Pacote GHCR público (recomendado):** se o pacote do GHCR estiver **público**, o VPS consegue fazer `docker pull` sem autenticação; não é necessário configurar `GHCR_TOKEN`. As imagens não contêm env/secrets (só o código); o `.env` é gerado no deploy e enviado separadamente.

## Pré-requisitos no VPS

1. **Docker** e **Docker Compose** (v2) instalados.
2. **Redis** já rodando na máquina. No GitHub Environment, configure `REDIS_URL` com um database exclusivo do Maritaca (ex.: `redis://host.docker.internal:6379/1`). Containers acessam o host via `host.docker.internal`.
3. **Diretório do app:** clone do repositório no caminho que será usado como `DEPLOY_PATH` (ex.: `/opt/maritaca`), ou pelo menos os arquivos `docker-compose.prod.yml` e `.env` (o workflow gera o `.env` e faz SCP para `$DEPLOY_PATH/.env`; o compose roda em `$DEPLOY_PATH`).
4. **Acesso SSH:** usuário com permissão para escrever em `DEPLOY_PATH` e rodar Docker. Recomenda-se um usuário dedicado (ex.: `deploy`) e chave SSH usada apenas pelo GitHub Actions.

## GitHub Environment `production`

Configure em **Settings → Environments → production** (ou o nome que for usado no workflow). Todas as entradas do [.env.example](../.env.example) podem ser configuradas aqui; o deploy gera o `.env` no VPS a partir dessas variáveis e secrets. Só inclua as que forem necessárias para o seu ambiente (opcionais vazias não precisam ser definidas).

### Deploy (SSH e GHCR)

| Tipo      | Nome              | Obrigatório | Descrição |
| --------- | ----------------- | ----------- | --------- |
| Variable  | `SSH_HOST`        | Sim         | Hostname ou IP do VPS |
| Variable  | `SSH_USER`        | Sim         | Usuário SSH (ex.: `deploy`) |
| Variable  | `DEPLOY_PATH`     | Sim         | Diretório do app no VPS (ex.: `/opt/maritaca`) |
| Secret    | `SSH_PRIVATE_KEY` | Sim         | Conteúdo da chave privada SSH |
| Secret    | `GHCR_TOKEN`      | Não         | Só se o pacote GHCR for **privado**. PAT com `read:packages` para `docker login ghcr.io` no VPS. Se o pacote for **público**, não configure (o pull funciona sem login). |

### Deixar o pacote do GHCR público (recomendado)

Para o VPS fazer `docker pull` sem `GHCR_TOKEN`:

1. No repositório no GitHub: **Packages** (barra lateral direita ou **Code** → link do pacote ao lado de "Packages").
2. Abra cada pacote (**maritaca-api**, **maritaca-worker**, **maritaca-migrate**); repita para todos.
3. Em **Package settings** (menu à direita), em **Danger Zone**, use **Change visibility** → **Public**.
4. Confirme para cada um.

Depois disso, o deploy não precisa do secret `GHCR_TOKEN`.

### App – Environment variables (não sensíveis)

Defina como **Environment variables** no environment `production`. São escritas no `.env` de produção no deploy.

| Variável | Exemplo / Observação |
| -------- | --------------------- |
| `PORT` | 7377 |
| `HOST` | 0.0.0.0 |
| `LOG_LEVEL` | info |
| `NODE_ENV` | production |
| `RATE_LIMIT_MAX` | 100 |
| `RATE_LIMIT_WINDOW_MS` | 60000 |
| `OTEL_SERVICE_NAME` | Opcional |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Opcional |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | Opcional |
| `OTEL_EXPORTER_OTLP_INSECURE` | Opcional |
| `OTEL_TRACES_SAMPLER` | Opcional |
| `OTEL_TRACES_SAMPLER_ARG` | Opcional |
| `EMAIL_PROVIDER` | mock \| resend \| ses |
| `AWS_REGION` | Se usar SES/SNS |
| `AWS_DEFAULT_REGION` | Alternativa a AWS_REGION |
| `SMS_PROVIDER` | sns \| twilio |
| `PUSH_PROVIDER` | sns |
| `SNS_APNS_PLATFORM_ARN` | Opcional |
| `SNS_APNS_SANDBOX_PLATFORM_ARN` | Opcional |
| `SNS_GCM_PLATFORM_ARN` | Opcional |
| `WEB_PROVIDER` | webpush |
| `VAPID_PUBLIC_KEY` | Se usar web push |
| `VAPID_SUBJECT` | mailto: ou https: |
| `TWILIO_SMS_FROM` | E.164 ou SID |
| `TWILIO_WHATSAPP_FROM` | E.164 |
| `AUDIT_HASH_SUBJECT_IDS` | true \| false |
| `AUDIT_RETENTION_MONTHS` | 12 |
| `AUDIT_PARTITION_MONTHS_AHEAD` | 3 |
| `AUDIT_MAINTENANCE_CRON` | 0 3 * * * (cron) |

### App – Environment secrets (sensíveis)

Defina como **Environment secrets** no environment `production`. São escritas no `.env` de produção no deploy.

| Secret | Observação |
| ------ | ---------- |
| `DATABASE_URL` | Connection string PostgreSQL (ex.: `postgresql://user:pass@postgres:5432/maritaca`) |
| `REDIS_URL` | Connection string Redis; em produção use database separado (ex.: `redis://host.docker.internal:6379/1`) |
| `RESEND_API_KEY` | Se EMAIL_PROVIDER=resend |
| `RESEND_WEBHOOK_SECRET` | Opcional, webhooks Resend |
| `AWS_ACCESS_KEY_ID` | Se usar SES/SNS |
| `AWS_SECRET_ACCESS_KEY` | Se usar SES/SNS |
| `SLACK_BOT_TOKEN` | Se usar canal Slack |
| `VAPID_PRIVATE_KEY` | Se usar web push |
| `TELEGRAM_BOT_TOKEN` | Se usar Telegram |
| `TWILIO_ACCOUNT_SID` | Se usar Twilio |
| `TWILIO_AUTH_TOKEN` | Se usar Twilio |
| `AUDIT_ENCRYPTION_KEY` | Produção: `openssl rand -base64 32` |

## Primeiro deploy

1. Crie o environment `production` e configure todas as variáveis e secrets listados acima (pelo menos os obrigatórios e os que sua instalação usa).
2. No VPS: instale Docker e Docker Compose; garanta que o Redis está rodando; clone o repositório em `DEPLOY_PATH` (ou coloque lá o `docker-compose.prod.yml`).
3. Dispare o workflow manualmente (**Actions → Deploy to production → Run workflow**) ou faça push na `main`.
4. **Migrações:** são aplicadas **automaticamente** em cada deploy. O workflow sobe o Postgres, roda o container `migrate` (imagem `maritaca-migrate`) com `drizzle-kit migrate` e só então sobe a API e o Worker. Não é necessário rodar migrações manualmente após o deploy. Para rodar migrações manualmente no VPS (ex.: primeiro deploy antes de automatizar):

```bash
cd "$DEPLOY_PATH"
export MARITACA_MIGRATE_IMAGE=ghcr.io/<owner>/<repo>/maritaca-migrate:latest
docker compose -f docker-compose.prod.yml run --rm migrate
```

## Rollback

As imagens são taggeadas com o SHA do commit (`sha-<commit>`). Para voltar a uma versão anterior, altere no environment (ou no VPS) as variáveis de imagem para o SHA desejado e rode novamente o deploy, ou no VPS:

```bash
cd "$DEPLOY_PATH"
export MARITACA_API_IMAGE=ghcr.io/<owner>/<repo>/maritaca-api:sha-<commit-anterior>
export MARITACA_WORKER_IMAGE=ghcr.io/<owner>/<repo>/maritaca-worker:sha-<commit-anterior>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Arquivos relacionados

- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — definição do workflow
- [docker-compose.prod.yml](../docker-compose.prod.yml) — compose de produção (postgres, api, worker; sem Redis)
- [.env.example](../.env.example) — referência de todas as variáveis do app
