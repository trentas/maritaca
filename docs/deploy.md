# Deploy em produção (produtos-01)

A maritaca roda na **produtos-01**, e a stack dela é declarada em outro repositório: [`sunnysystems/infra`](https://github.com/sunnysystems/infra), em `compose/produtos-01/maritaca/docker-compose.yaml`, rsyncado para `/opt/maritaca` no host.

A divisão é essa, e vale entendê-la antes de mexer:

| | quem é dono | onde |
|---|---|---|
| Imagens (api, worker, migrate) | este repo | GHCR, via `.github/workflows/deploy.yml` |
| `docker-compose.yaml` da stack | `sunnysystems/infra` | `compose/produtos-01/maritaca/` → `/opt/maritaca` |
| `.env` de produção | `sunnysystems/infra` (Infisical) | `/opt/maritaca/.env` no host |
| Trocar a versão em execução | este repo | workflow, alterando só a linha `TAG=` |

> **O `.env` de produção não é gerado por este repo.** Ele carrega `POSTGRES_PASSWORD`, `AUDIT_ENCRYPTION_KEY` e `INTEGRATION_ENCRYPTION_KEY`, e essas duas últimas cifram colunas do banco: sem as **mesmas** chaves, o dado existente fica ilegível. O workflow altera exatamente uma linha daquele arquivo, a do `TAG`.

## Como o deploy funciona

Disparo por push de tag `v*` ou manual (**Actions → Deploy to production → Run workflow**).

1. **build-and-push** — constrói as três imagens e publica no GHCR com as tags `latest` e `sha-<commit>`.
2. **deploy** — entra na tailnet, conecta por SSH na produtos-01 e, em `/opt/maritaca`:
   - troca a linha `TAG=` do `.env` para `sha-<commit>`;
   - `docker compose pull`;
   - `docker compose up -d postgres` e `docker compose run --rm migrate` — **migrations antes de subir a app**, para nenhum processo novo encostar em schema velho;
   - `docker compose up -d --remove-orphans`;
   - `docker image prune -af --filter until=24h` (as tags são imutáveis, então versão velha nunca vira dangling; sem o `-a` o disco enche);
   - health check chamando `/health` de dentro do container, já que a stack não publica porta no host.

## GitHub Environment `production`

| Tipo | Nome | Obrigatório | Descrição |
|---|---|---|---|
| Variable | `DEPLOY_HOST` | Sim | Nome da produtos-01 na tailnet (MagicDNS) |
| Variable | `DEPLOY_PATH` | Sim | Diretório da stack no host — `/opt/maritaca` |
| Variable | `DEPLOY_USER` | Não | Usuário SSH. Default: `deploy` |
| Secret | `TS_CI_AUTHKEY` | Sim | Auth key da Tailscale para o runner entrar na tailnet |
| Secret | `DEPLOY_SSH_KEY` | Sim | Chave privada SSH do usuário de deploy na produtos-01 |

Não há mais variáveis de aplicação aqui: `DATABASE_URL`, `REDIS_URL`, chaves de provedor e afins vivem no `.env` do host, gerenciado pelo infra. O login no GHCR no host é transitório, feito com o `GITHUB_TOKEN` do próprio run e desfeito no fim — não é preciso PAT no servidor nem deixar o pacote público.

## Rollback

As imagens são taggeadas com o SHA do commit, então voltar é trocar o `TAG`:

```bash
ssh <produtos-01>
cd /opt/maritaca
sed -i 's|^TAG=.*|TAG=sha-<commit-anterior>|' .env
docker compose pull -q && docker compose up -d
```

O `prune` do deploy preserva imagens das últimas 24h, então o release anterior normalmente ainda está em disco; se não estiver, o pull traz do GHCR.

Rollback que envolva **reverter migration** não é coberto por isso — o `migrate` só avança.

## Verificar depois do deploy

```bash
ssh <produtos-01>
cd /opt/maritaca
docker compose ps
grep '^TAG=' .env
docker compose exec -T api node -e "fetch('http://127.0.0.1:7377/health').then(r=>r.text()).then(console.log)"
docker compose logs --tail 50 worker
```

Para conferir a versão em execução, `/version` responde com `APP_VERSION` e `COMMIT_SHA`, injetados no build a partir da tag.

## Histórico: o deploy que ia para a máquina errada

Até 2026-08-09 este workflow gerava o `.env` inteiro a partir do GitHub Environment e fazia SCP de um `docker-compose.prod.yml` deste repo para `vars.SSH_HOST` — que continuou apontando para a **sunshine-prod** depois que a maritaca migrou para a produtos-01, em julho de 2026. Todo deploy a partir daí atualizou a máquina antiga, sem ninguém notar: o workflow terminava verde.

Duas lições ficaram no formato atual. A primeira é que este repo não escreve mais o `.env` do destino — o formato antigo fazia `rm -rf $DEPLOY_PATH/.env` antes do SCP, o que na produtos-01 destruiria as chaves de cifragem. A segunda é que o `docker-compose.prod.yml` deste repo foi removido: ele descrevia uma produção que não existia mais, e era justamente essa a fonte da confusão. O compose real está no infra.

## Arquivos relacionados

- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — build, push e deploy
- [docker-compose.yml](../docker-compose.yml) — stack local de desenvolvimento
- [.env.example](../.env.example) — referência das variáveis do app
- `sunnysystems/infra`, `compose/produtos-01/maritaca/` — compose e `.env.example` do que roda em produção
