# Instruções para agentes

## Lint e formatação

- Nunca escreva comentários ou atributos que silenciam o linter, o formatador ou o type checker: `biome-ignore`, `eslint-disable`, `prettier-ignore`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `#[allow(...)]`, `#[rustfmt::skip]` e equivalentes.
- Quando uma regra apontar um problema, corrija o código. Se a regra não serve para o projeto inteiro, desligue-a na configuração da ferramenta (`biome.json`, por exemplo) e explique o motivo na mensagem do commit.

## O que é o projeto

MineKubernetes: um orquestrador de servidores de Minecraft num k3s de um nó. O jogador entra por um **gateway** TCP L7 que identifica quem é pelo Tailscale, decide se pode entrar e acorda o mundo se ele estiver hibernando. Um **control plane** cuida do ciclo de vida, do RCON, dos backups e do painel. A especificação está em `docs/srs/` (índice em `docs/srs/00-INDICE-E-MATRIZ-RASTREAMENTO.md`); os IDs `RF-*` nos comentários e nos testes apontam para ela.

| Pasta | O que é |
| --- | --- |
| `crates/gateway` | Gateway em Rust: handshake, roteamento por host, identidade (WhoIs do `tailscaled` com fallback gRPC), proxy e auto-wake |
| `crates/minecraft-protocol`, `crates/gateway-test-support` | Codec do protocolo e utilitários dos testes do gateway |
| `proto/gateway_control.proto` | Contrato gRPC entre gateway e control plane |
| `services/control-plane` | API NestJS (TypeORM/Postgres), reconciliador, RCON, k8s, WebSockets, serve o painel |
| `services/web` | Painel Angular (Vitest nos testes, Playwright no e2e) |
| `k8s/` | Manifests (kustomize) e scripts `bootstrap.sh` e `update.sh` |
| `docs/` | SRS, relatórios e design |

Quem fala com quem: o gateway abre streams gRPC para o control plane (rotas, eventos de sessão, identidade); o control plane cria Deployment, Service e PVC de cada mundo no k8s e conversa com o servidor pelo RCON; o painel usa a API REST e os namespaces Socket.IO `/ws/servers`, `/terminal` e `/ws/tasks`.

## Comandos

Na raiz: `npm run check` (Biome) e `npm run fix`. Os hooks (lefthook) formatam no commit e rodam os testes no push; não os contorne.

| Onde | Testes | Outros |
| --- | --- | --- |
| `services/control-plane` | `npx jest`; `npm run test:e2e` | `npm run typecheck`, `npm run build` |
| `services/web` | `npm test -- --watch=false` | `npm run build`; `npm run e2e` (Playwright, ver abaixo) |
| raiz (Rust) | `cargo test --locked` | `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings` |

- Os testes `*.int.spec.ts` do control plane só rodam com `TEST_DATABASE_URL` apontando para um Postgres; sem ela ficam pulados.
- O e2e do web usa fakes (`services/web/e2e/fakes`) e precisa da porta `25565` livre; não roda se o k3s estiver no ar. Ele não está no CI.
- O CI (`.github/workflows/ci.yml`) roda só os jobs dos componentes que mudaram e termina em `ci-ok`.

## Convenções

- Commits em inglês, Conventional Commits (`fix(control-plane): ...`, `feat(web): ...`).
- Specs ficam ao lado do código (`*.spec.ts`). Um teste de correção de bug deve falhar sem a correção: confira isso, não suponha.
- No control plane, use os aliases do `tsconfig` (`@config/`, `@database/`, `@k8s/`, `@console/`...). Migrações ficam em `src/database/migrations`, numeradas, e são registradas em `index.ts`. Em produção o boot não as aplica: o init container `migrate` as roda.
- Mudou o `.proto`? Gateway e control plane precisam acompanhar; o control plane carrega com `keepCase: true` e **sem** `defaults`.
- Textos do painel e mensagens ao usuário em português; código, logs técnicos e commits em inglês.

## Armadilhas já pagas

- **Nomes no k8s vêm de `servers.resource_name`, não do subdomínio.** O subdomínio pode mudar (`PATCH /domain`); os recursos (`mc-<resource_name>`, `data-<resource_name>`) não. Use os helpers de `src/k8s/resource-names.ts` e `server-data-volume.ts`.
- **Relação `minecraft_settings` pode vir sem carregar.** Quem monta o `server.properties`, o Deployment ou a conexão RCON a partir de um `Server` carregado sem a relação cai nos padrões (senha RCON incluída) e deixa de autenticar. O `RconConnectionPool` e o `KubernetesService.startServer` já leem do banco quando falta; novos chamadores devem fazer igual.
- **O prost não serializa o zero do proto3.** Um enum em `0` (por exemplo `SessionEventType.CONNECTED`) chega ao Node como `undefined`.
- **O `remove()` do TypeORM limpa a chave primária** da entidade; guarde o `id` antes se for usá-lo depois.
- **`@kubernetes/client-node` 2.x** expõe o status HTTP em `err.code` (não `statusCode`).
- **Todo comando RCON tem timeout, inclusive enquanto espera na fila** (`rcon-client.ts`): um cliente desconectado, como o de uma senha recusada, não pode travar quem o chamou (stop, restart, backup).
- **O servidor de Minecraft roda `online-mode=false` e `white-list=false` atrás do gateway**; quem decide a entrada é o gateway. Mundo publicado na internet exige `online-mode=true`.
- **Configuração editável no painel** (`services/control-plane/src/settings`): o valor efetivo é banco > variável de ambiente > padrão, e `AppConfigService.tailscale/access/cloudflare/healthBot` já o devolvem. Nova configuração entra em `settings.definitions.ts`; leia-a sob demanda (nunca no construtor) para valer sem reiniciar. Segredos são só de escrita (cifrados com chave derivada de `JWT_SECRET`) e nunca vão para log nem resposta.
- **Estado em tempo real:** transições de estado saem de um subscriber do TypeORM; mudanças de jogadores, backups e estatísticas saem pelo `ServerActivityBus` como `serverActivity`. O painel só faz polling enquanto o socket está fora do ar.
- **Rust:** compartilhar `CARGO_TARGET_DIR` entre worktrees gera artefatos velhos "frescos" (o hash e o `CARGO_MANIFEST_DIR` são do primeiro checkout). Use um alvo por worktree ou `cargo clean -p <crate>`.
- **Ao trabalhar em worktrees**, os `node_modules` são por pasta (`/`, `services/control-plane`, `services/web`).

## Ambiente de deploy

`k8s/README.md` descreve tudo. Em resumo: `k8s/bootstrap.sh` para o primeiro deploy e `k8s/update.sh` para atualizar (sem registry, as imagens são importadas no containerd com `sudo`). Control plane e gateway usam `hostNetwork`; as portas do `luisarch` que não estão livres precisam ser trocadas nos manifests (o painel usa `8080` por padrão). A StorageClass `local-nvme` usa `Retain`: apagar um mundo deixa o PV `Released` com os dados em disco, de propósito.
