# MineKubernetes — inventário de requisitos, pré-requisitos e contradições das SRS

| Campo | Valor |
|-------|-------|
| **Status** | ❌ Não iniciado — o `main` contém só especificação, nenhuma linha de código |
| **Cobertura** | ~0 % (0 de 136 requisitos implementados no `main`) |
| **Esforço [modelado]** | 58–88 dias-dev no escopo completo; 27–40 d no mínimo viável |
| **Depende de** | F0 — resolver as 19 contradições da seção 4 antes de escrever código |
| **Atenção** | ⚠️ 8 premissas das SRS são desmentidas pela documentação oficial (seção 4.1) |

---

## 1. Estado atual — evidências

### O que existe

O `main` (commit `ca48f39`) rastreia três arquivos: `.gitignore`, `README.md` e
`docs/SRS-ARQUITETURA-HYPERVISOR.md`. Há mais quatro SRS não rastreados no diretório de trabalho.
Juntos somam 3.802 linhas:

| Documento | Abreviação neste relatório | Linhas | Runtime declarado |
|---|---|---|---|
| `docs/SRS-ARQUITETURA-HYPERVISOR.md` | ARQ | 691 | agnóstico |
| `docs/SRS-GATEWAY-L7.md` | GW | 655 | Rust 2021 + Tokio (GW:9) |
| `docs/SRS-DRIVER-RCON-PIPELINE-LOGS.md` | RCON | 814 | Node 22 + NestJS + TypeORM (RCON:9-10) |
| `docs/SRS-SUBSISTEMA-TAILSCALE.md` | TS | 683 | agnóstico (TS:9) |
| `docs/SRS-STORAGE-MODPACKS-BACKUPS.md` | STO | 926 | Node 22 + NestJS + Kubernetes Jobs (STO:9-11) |

Fora do versionamento há `.env` com só duas chaves (`FRONTEND_PORT`, `BACKEND_PORT`) e o diretório
`create-minecraft-server/` (200 MB, ignorado em `.gitignore:9`), que é um servidor Paper 1.20.1
legado com `world/`, `world_nether/` e `world_the_end/` separados — evidência do layout que o hot
backup precisa cobrir (seção 4.2).

### O que não existe

Nenhum artefato de implementação — nem manifesto de build, nem contrato `.proto`, nem manifesto
Kubernetes, nem o `.env.example` que o próprio `.gitignore:4` prevê:

```bash
find . -path ./.git -prune -o -path ./create-minecraft-server -prune -o \( -name Cargo.toml \
  -o -name package.json -o -name '*.proto' -o -name '*.yaml' -o -name '*.yml' \
  -o -name .env.example \) -print | wc -l
# → 0
grep -rn "gameType\|game_type" docs/
# → 0 resultados
grep -rn "/api/auth\|login.*token" docs/
# → 0 resultados (nenhum endpoint de autenticação especificado)
```

Sem *lockfile*, nenhuma versão de dependência está fixada; as fontes da seção 8 foram consultadas
na versão atual publicada.

### Precedentes no código

O branch `legacy` guarda a v1 (NestJS 11, Prisma 7, Angular 22, `@kubernetes/client-node` 1.4 —
`legacy:dashboard/backend/package.json`). É o único código do repositório:

- `legacy:dashboard/backend/src/gateway/minecraft-protocol.util.ts:3-23` — `readVarInt` para no
  6º byte com `break` e devolve valor parcial, sem erro. **Divergir**: GW:183 exige rejeição
  `MalformedVarInt` no 5º byte com bit de continuidade.
- `legacy:.../gateway/minecraft-protocol.util.ts:58-75` — `createDisconnectPacket` de estado Login
  com JSON. **Reutilizar** o formato para Login; não serve para Play/Configuration (seção 4.1).
- `legacy:.../gateway/gateway.service.ts:38-60` — `net.createServer` + `once('data')`: assume o
  Handshake inteiro no primeiro segmento TCP. **Divergir**, como GW:72 já pede.
- `legacy:.../servers/servers.service.ts:85,130,404` — imagem `itzg/minecraft-server`, probes
  `mc-monitor`, `kubectl exec ... rcon-cli`. **Divergir** do RCON por shell; a decisão sobre a
  imagem `itzg` está em aberto (armadilha **C-18**).
- `legacy:docs/reports/06-evolucao-multi-jogo.md:67-111` — interface `GameProvider` com
  `routingModel: 'sni-shared-port' | 'dedicated-port'`. **Reutilizar** como base da seção 2.9.
- `legacy:docs/reports/00-indice.md:15-24` — o ambiente real era k3s *single-node* em `luisarch`,
  compartilhado com outro projeto no namespace `default`. As SRS citam Proxmox (STO:37,96) — a
  topologia-alvo precisa ser confirmada (seção 2.7).

### Não-objetivos

- Implementar Terraria, `TerrariaProvider`, driver TShock ou alocador de pool de portas — só os
  pontos de extensão da seção 2.9 entram.
- Health Bot E2E (ARQ:77-79) fora do mínimo viável.
- Reescrever as SRS neste relatório: a seção 4 aponta o que corrigir; a correção é a fase **F0**.
- Frontend SPA: não há SRS de UI; o relatório só lista os contratos que a UI consome.

---

## 2. Análise requisito a requisito

Status de todos os itens abaixo: ❌ (nada implementado). A coluna `Obs.` aponta conflito ou
risco quando existe; ⚠️ remete à seção 4.

### 2.1 Arquitetura e ciclo de vida (ARQ)

| ID | Requisito | Origem | Obs. |
|---|---|---|---|
| **RF-ARQ-01** | Máquina de estados com 8 estados (`Provisioning`…`Crashed`) | ARQ:87-125 | ⚠️ **C-01** enum divergente entre SRS |
| **RF-ARQ-02** | Bootstrap por env `TYPE`/versão/memória; baixa binário se ausente | ARQ:131-135 | ⚠️ **C-18** `TYPE` é convenção da imagem `itzg` |
| **RF-ARQ-03** | Startup probe a cada 10 s, até 15 min | ARQ:144-145 | ⚠️ **C-09** STO:909 diz 10 min |
| **RF-ARQ-04** | Readiness por handshake Status válido | ARQ:146-147 | — |
| **RF-ARQ-05** | Liveness: 3 pings falhos em 15 s = deadlock | ARQ:148-150 | — |
| **RF-ARQ-06** | Auto-restart com backoff, 3 tentativas em 10 min | ARQ:153 | — |
| **RF-ARQ-07** | Hibernação após `hibernateAfterMinutes` com zero jogadores; `never` = *Always On* | ARQ:154-158 | — |
| **RF-ARQ-08** | Graceful shutdown: `save-all flush` → `stop` → 60–90 s → `SIGKILL` | ARQ:160-165 | — |
| **RF-ARQ-09** | `Xms`=`Xmx`; request = heap; limit = heap + 1 Gi (+2 Gi > 8 G); CPU request 1000m, sem CPU limit | ARQ:271-277 | ⚠️ **C-17** margem abaixo do recomendado |
| **RF-ARQ-10** | Aikar's flags como padrão | ARQ:279-290 | Confere com a doc oficial [F10] |
| **RF-ARQ-11** | Layout `/data` canônico | ARQ:296-322 | — |
| **RF-ARQ-12** | `/data` em bloco local; NFS proibido | ARQ:331-333 | — |
| **RF-ARQ-13** | Templating declarativo (Vanilla/Paper e modpacks) | ARQ:334-338 | — |
| **RF-ARQ-14** | Tudo em `/data` pertence a UID/GID 1000 | ARQ:339-340 | — |
| **RF-ARQ-15** | Injeção de `server.properties` e `eula.txt` | ARQ:346-355 | ⚠️ **C-08** `max-tick-time` |
| **RF-ARQ-16** | Nunca escrever no mundo com JVM viva (`session.lock`) | ARQ:356-358 | — |
| **RF-ARQ-17** | API `/api/servers`: 16 rotas (CRUD, logs, comando, arquivos, update, upload, domínio) | ARQ:402-421 | ⚠️ **L-04** zip-slip e symlink |
| **RF-ARQ-18** | API `/api/modpacks`: busca e versões | ARQ:425-430 | — |
| **RF-ARQ-19** | API `/api/tailscale`: convites e dispositivos | ARQ:434-442 | ⚠️ **C-05** DTO de convite |
| **RF-ARQ-20** | API `/api/admin`: usuários, grupos, vínculos, Smart Kick | ARQ:446-456 | — |
| **RF-ARQ-21** | Anti-impersonation no `Login Start` + auto-adoção de nick | ARQ:557-564 | ⚠️ **C-04** |
| **RF-ARQ-22** | Restauração de skins (SkinsRestorer; mods em modpacks) | ARQ:566-569 | ⚠️ **E-05** |
| **RF-ARQ-23** | `enforce-secure-chat=false` | ARQ:571-574 | ⚠️ **C-15** arquivo errado |
| **RF-ARQ-24** | RBAC com tokens assinados em toda a API administrativa | ARQ:600-603 | ⚠️ **L-01** sem emissão de token |
| **RF-ARQ-25** | Loop de reconciliação banco × cluster | ARQ:605-608 | — |
| **RF-ARQ-26** | Tag por jogador e resolução dupla (tag → usuário mestre) | ARQ:610-613 | ⚠️ **E-02** |
| **RF-ARQ-27** | Presença reativa no Gateway; UI pausa em `visibilitychange` | ARQ:615-618 | — |
| **RF-ARQ-28** | Banco fora do código-fonte, com backup | ARQ:620-623 | — |
| **RF-ARQ-29** | Casos de borda: FD leak, zumbi, upload 409, usuário 1:N dispositivos, Smart Kick | ARQ:645-651 | — |
| **RF-ARQ-30** | Health Bot E2E sintético | ARQ:77-79 | Fora do mínimo viável |

### 2.2 Gateway L7 (GW)

| ID | Requisito | Origem | Obs. |
|---|---|---|---|
| **RF-GW-01** | Runtime Tokio multi-thread, uma *task* por conexão | GW:79-82 | — |
| **RNF-GW-02** | < 30 MB em repouso; zero alocação no *hot path* (`BytesMut`) | GW:70-71 | Número sem protocolo de medição |
| **RF-GW-03** | Parser *streaming* tolerante a fragmentação TCP | GW:72 | — |
| **RF-GW-04** | Timeout 5 s até `Login Start`; pacote pré-login ≤ 4 KB; VarInt ≤ 5 bytes | GW:95-96,444-446 | — |
| **RF-GW-05** | Normalização de hostname (`\0`, porta, ponto final, minúsculas, regex) | GW:199-205,425-429 | ⚠️ **E-07** SRV |
| **RF-GW-06** | Detecção de PROXY v2 só de `TRUSTED_PROXY_IPS` | GW:207-212,416-421 | ⚠️ **E-04** Tailcat |
| **RF-GW-07** | `RouteTable` em `DashMap` + servidor padrão | GW:218-243 | Ponto de extensão, ver 2.9 |
| **RF-GW-08** | WhoIs via LocalAPI + cache 60 s | GW:245-252 | ⚠️ **C-10** 60 s × 300 s |
| **RF-GW-09** | Server List Ping com MOTD sintético por estado + cache 3 s | GW:256-327 | — |
| **RF-GW-10** | *Hold connection* 25 s + `TriggerServerWake` | GW:331-382 | — |
| **RF-GW-11** | Replay de Handshake + Login Start; PROXY v2 opcional para a JVM | GW:384-398 | — |
| **RF-GW-12** | Nick `^[a-zA-Z0-9_]{2,16}$` | GW:430-432 | ⚠️ **C-06** |
| **RF-GW-13** | Despejo da sessão anterior com o mesmo nick | GW:436-438 | — |
| **RF-GW-14** | Rate limit *token bucket* (`governor`), ~10 conexões/s por IP | GW:447 | — |
| **RF-GW-15** | Smart Kick via `oneshot` + `tokio::select!` | GW:159-172 | ⚠️ **E-06** compressão |
| **RF-GW-16** | IPC gRPC: 4 RPCs, 3 mensagens | GW:452-519 | ⚠️ **C-01** enum `status` |
| **RF-GW-17** | `:9090/metrics` e `/healthz` | GW:523-552 | — |
| **RF-GW-18** | Workspace Cargo com crate `minecraft-protocol` puro | GW:556-614 | — |
| **RF-GW-19** | 4 testes unitários + 3 de integração nomeados | GW:634-644 | — |

### 2.3 Driver RCON, logs e persistência (RCON)

| ID | Requisito | Origem | Obs. |
|---|---|---|---|
| **RF-RCON-01** | Codec Source RCON *little-endian* com acumulador | RCON:109-150,206-281 | ⚠️ **E-01** limite 4096 |
| **RF-RCON-02** | Rejeitar `\0` no payload | RCON:223-225 | — |
| **RF-RCON-03** | Uma conexão persistente autenticada por servidor `READY` | RCON:285-332 | — |
| **RF-RCON-04** | Fila FIFO *single-flight* por conexão | RCON:335-336 | — |
| **RF-RCON-05** | Timeout 5 s por comando → `destroy()` e reconexão | RCON:337-338 | ⚠️ **L-08** `save-all flush` |
| **RF-RCON-06** | Backoff 1–15 s com *jitter* | RCON:339-342 | — |
| **RF-RCON-07** | Stream de logs `follow=true&tailLines=500` | RCON:348-381 | ⚠️ **C-11** namespace |
| **RF-RCON-08** | Buffer circular de 500 linhas por instância | RCON:383-426 | — |
| **RF-RCON-09** | Filtro de ruído RCON + remoção de ANSI no backend | RCON:428-451 | — |
| **RF-RCON-10** | TypeORM, SQLite em dev e PostgreSQL em produção | RCON:10,455-457 | ⚠️ **C-02** Prisma |
| **RF-RCON-11** | Entidades `Server`, `User`, `Group`, associativas e `ServerAuditLog` | RCON:459-663 | ⚠️ **C-03**, **C-16** |
| **RF-RCON-12** | `POST /api/servers/:id/command` com auditoria | RCON:683-711 | — |
| **RF-RCON-13** | WebSocket: `join_terminal`, `log_history`, `log_delta`, `send_command`, `command_output` | RCON:714-784 | — |
| **RF-RCON-14** | WebSocket só para nó autenticado com `ADMIN` ou grupo | RCON:675 | ⚠️ **L-01** |
| **RF-RCON-15** | 8 testes nomeados (codec, logs, reconexão) | RCON:788-803 | — |

### 2.4 Tailscale, identidade e acesso (TS)

| ID | Requisito | Origem | Obs. |
|---|---|---|---|
| **RF-TS-01** | Zero-Trust; convidado só alcança `tcp:25565`; chaves `reusable: false` | TS:78-83 | — |
| **RF-TS-02** | Políticas `PUBLIC`, `GROUP`, `INDIVIDUAL`, `MAINTENANCE` + bypass de `ADMIN` | TS:91-132 | ⚠️ **C-01** `MAINTENANCE` |
| **RF-TS-03** | Convite pré-vincula grupos e servidores | TS:134-137 | — |
| **RF-TS-04** | Modo Tailcat sem conta e sem root | TS:141-173 | ⚠️ **E-04** |
| **RF-TS-05** | Interfaces `NetworkIdentityProvider` e drivers Local/Cloud/Tailcat | TS:177-235 | — |
| **RF-TS-06** | Ciclo de vida do convite (Active/Depleted/Expired/Revoked) | TS:241-261 | — |
| **RF-TS-07** | Ciclo de vida do dispositivo | TS:263-280 | — |
| **RF-TS-08** | Resgate no `/join` com checagem de nick e cota atômica | TS:305-344 | ⚠️ **L-03** compensação |
| **RF-TS-09** | Revogação em dois níveis (Smart Kick × ban de rede) | TS:386-416 | — |
| **RF-TS-10** | Esquema SQL de 9 tabelas | TS:422-510 | ⚠️ **C-03**, **L-02** |
| **RF-TS-11** | DTOs em JSON Schema | TS:512-565 | ⚠️ **C-05**, **C-06** |
| **RF-TS-12** | Política ACL com `grants` e `tests` | TS:569-609 | ⚠️ **E-02** curinga |
| **RF-TS-13** | Auditoria de ACL no boot, sem sobrescrever | TS:611-617 | ⚠️ **E-02** |
| **RF-TS-14** | Fallback LocalAPI → Cloud API | TS:653,680 | — |
| **RF-TS-15** | `DeviceGarbageCollector` para nós inativos > 30 dias | TS:682 | ⚠️ **E-03** limite real |
| **RF-TS-16** | Atualização do DNS *wildcard* via API de DNS | TS:683 | Reusado em 2.8 |
| **RF-TS-17** | Testes unitários, integração, E2E e *red team* | TS:635-672 | ⚠️ **C-12** SEC-01 |

### 2.5 Storage, backups e modpacks (STO)

| ID | Requisito | Origem | Obs. |
|---|---|---|---|
| **RF-STO-01** | Trabalho pesado em Jobs `batch/v1` fora do cgroup da JVM | STO:82 | — |
| **RF-STO-02** | Volume secundário `/backups` | STO:83 | — |
| **RF-STO-03** | Hot backup por hardlink com *freeze* < 2 s | STO:84,207-251 | ⚠️ **D-01**…**D-04** |
| **RF-STO-04** | Restauração transacional em 5 fases | STO:277-325 | ⚠️ **D-05** |
| **RF-STO-05** | Cache CAS por SHA-1/SHA-512 + LRU a 85 % | STO:86,467-491 | ⚠️ **L-07** RWX |
| **RF-STO-06** | PVC `local-nvme` com *node pinning* | STO:94-116 | ⚠️ **E-08** quota |
| **RF-STO-07** | `securityContext` 1000 com `fsGroupChangePolicy: OnRootMismatch` | STO:118-135 | — |
| **RF-STO-08** | Jobs com `runAsUser: 1000` e `umask 0022` | STO:137-144 | — |
| **RF-STO-09** | Nunca apagar `session.lock`; `fuser` no *entrypoint* | STO:146-187 | ⚠️ **L-05** |
| **RF-STO-10** | Exclusões do `tar` e nome padronizado | STO:255-273 | ⚠️ **L-06** |
| **RF-STO-11** | Resolver Modrinth: descarta `env.server == unsupported`; aplica `overrides/` | STO:366-417 | — |
| **RF-STO-12** | Resolver CurseForge: *server pack*, *blacklist* client-only, `download-url` | STO:421-463 | ⚠️ **R-06** ToS |
| **RF-STO-13** | Update com backup `pre-update`, purga de `mods/` e rollback | STO:495-536 | — |
| **RF-STO-14** | Matriz de injeção de configuração | STO:544-554 | ⚠️ **C-08** |
| **RF-STO-15** | Retenção: N=5; `pre-update` protegido 14 d; `pre-restore` 48 h | STO:569-581 | ⚠️ **D-05** |
| **RF-STO-16** | Entidades `ServerBackup` e `ModpackTask` | STO:585-713 | — |
| **RF-STO-17** | API de backups (5 rotas) | STO:719-727 | — |
| **RF-STO-18** | WebSocket `/ws/tasks` com progresso | STO:729-748 | — |
| **RF-STO-19** | Watchdog de `save-on` em 15 s; 507 sem espaço; 409 se ocupado | STO:902-910 | — |
| **RF-STO-20** | Testes unitários, integração e E2E em testbed | STO:914-926 | — |

### 2.6 Leitura consolidada

São **101 requisitos** nas SRS mais **35** derivados nesta análise (2.7: 20, 2.8: 8, 2.9: 7) —
136 no total. Os roadmaps internos (GW:647-655, RCON:806-814) cobrem só dois dos cinco
subsistemas; ARQ, TS e STO não têm fases nem critérios de aceite por fase — a seção 3 preenche.

### 2.7 Pré-requisitos de ambiente

| ID | Item | Exigido por | Obs. |
|---|---|---|---|
| **PR-01** | Host com SSD/NVMe dedicado | STO:96 | ⚠️ Proxmox nas SRS × k3s em `luisarch` no legado |
| **PR-02** | Cluster k3s/k8s com cgroups v2 | STO:37, ARQ:674 | Definir se é *single-node* (muda afinidade e RWX) |
| **PR-03** | StorageClass `local-nvme` (local-path) | STO:112 | Capacidade ignorada [F8] — ⚠️ **E-08** |
| **PR-04** | PVC `/backups` em segundo disco | STO:83,824 | — |
| **PR-05** | PVC `/cache` compartilhado | STO:469 | RWX só com `sharedFileSystemPath` [F8] |
| **PR-06** | Namespace `minekubernetes` | STO:105 | ⚠️ **C-11** |
| **PR-07** | Registry de imagens (Gateway, Control Plane, Jobs, JVM) | implícito | Legado importava com `sudo k3s ctr` (`legacy:docs/reports/00-indice.md:18-21`) |
| **PR-08** | Imagem da JVM definida | ARQ:133 | ⚠️ **C-18** `itzg` × instalador próprio |
| **PR-09** | Tailscale no host com `tag:minecraft-server` e LocalAPI | GW:41, TS:577 | — |
| **PR-10** | Funnel: HTTPS, MagicDNS e atributo `funnel` na policy [F4] | TS:22 | ⚠️ **E-03** porta |
| **PR-11** | Credencial Tailscale com permissão de criar chaves com tag | TS:196,339 | Cada tag precisa existir na policy [F2] |
| **PR-12** | Chave CurseForge (`x-api-key`) do console de desenvolvedor [F9] | STO:463 | — |
| **PR-13** | Domínio + token de API de DNS (Cloudflare) | TS:683 | Reusado em 2.8 |
| **PR-14** | Segredo RCON por servidor (Secret k8s) | ARQ:350, RCON:304 | — |
| **PR-15** | Chave de assinatura de tokens da API | ARQ:603 | ⚠️ **L-01** |
| **PR-16** | PostgreSQL de produção + credenciais | RCON:10 | — |
| **PR-17** | `TRUSTED_PROXY_IPS` | GW:420 | — |
| **PR-18** | Toolchain Rust 2021 + `protoc`; crates `tokio`, `bytes`, `dashmap`, `arc-swap`, `governor` | GW:9,71,226,447,456 | Versões não fixadas |
| **PR-19** | Node 22 LTS, NestJS, TypeORM, `@kubernetes/client-node` | RCON:9-10, STO:9 | Legado usava NestJS 11 |
| **PR-20** | Prometheus (opcional) | GW:525 | — |

A decisão estrutural por trás de PR-18 × PR-19: dois runtimes para um homelab. É o que a SRS
pede; o custo aparece em **R-05**.

### 2.8 Exposição pública de mundos via Cloudflare

O modelo das SRS é fechado: todo jogador está na Tailnet. Expor um mundo à internet aberta pede
um caminho de rede e muda o modelo de identidade.

| Opção | O que é | Custo | Base | Veredito |
|---|---|---|---|---|
| **A** DNS-only via API | A/AAAA não proxiado + SRV `_minecraft._tcp.<mundo>` → IP público + *port forward* ao Gateway | Zero; expõe IP residencial, sem DDoS, falha sob CGNAT | [F11] [F12] | **Recomendada** para começar |
| **B** Spectrum Minecraft | Proxy TCP da Cloudflare; Pro/Business permitem **um** app Minecraft [F13]; franquia 5 GB/mês (Pro) ou 10 GB (Business), depois por GB [F14] | Plano pago + excedente | [F13] [F14] [F16] | Alternativa se o IP precisar ficar oculto e um mundo bastar |
| **C** Cloudflare Tunnel (TCP) | `cloudflared` na origem | Cliente precisa de `cloudflared` ou WARP [F17] | [F17] | Rejeitada: mesma fricção do Tailscale |
| **D** Tailscale Funnel | Exposição pública da Tailnet | Só TLS, portas 443/8443/10000 [F4] | [F4] | Rejeitada: Minecraft não é TLS |

Sobre **B**: sem PROXY Protocol, o Gateway só vê IPs da Cloudflare — o rate limit por IP
(**RF-GW-14**) vira um balde global. O suporte a PROXY Protocol para apps Minecraft **não** foi
confirmado em doc oficial (só apareceu em resumo de busca) → `[modelado]` até testar. Com
Tunnel como origem, PROXY Protocol é impossível [F15]. Há limite de 10 hostnames Spectrum IPv4
por conta [F16]. A franquia de [F14] vem de um post de 2021 — o preço atual precisa ser conferido.

Requisitos derivados:

| ID | Requisito |
|---|---|
| **RF-CF-01** | Nova política `INTERNET`, fora do Zero-Trust e explícita no `servers` |
| **RF-CF-02** | Mundo `INTERNET` obriga `online-mode=true`: sem Tailscale não há identidade, e `online-mode=false` na internet deixa qualquer um usar qualquer nick. Funciona atrás do Gateway transparente porque Handshake e `Login Start` trafegam em claro antes da criptografia |
| **RF-CF-03** | Com criptografia ativa, Smart Kick formatado e Disconnect injetado são impossíveis → só fechar o socket ou `kick` via RCON |
| **RF-CF-04** | Listener público separado (porta/interface) com rate limit e teto de conexões próprios; SEC-01 (TS:670) passa a valer por listener |
| **RF-CF-05** | Com SRV, o hostname do Handshake é o **alvo** do SRV [F12] → cada mundo precisa de alvo distinto para o *virtual hosting* |
| **RF-CF-06** | Segredo `CLOUDFLARE_API_TOKEN` (Zone:DNS:Edit) + `zone_id`; mesmo driver de DNS de **RF-TS-16** |
| **RF-CF-07** | Rotas de API para publicar/despublicar um mundo (cria/remove registros) |
| **RF-CF-08** | Auto-Wake só depois de `Login Start` válido — senão qualquer *scanner* acorda a JVM |

### 2.9 Preparação para outros jogos (Terraria) — pontos de extensão, sem implementar

ARQ:263 e ARQ:688-689 já pedem um `GameProvider` e portas dedicadas, sem detalhar. O legado
(`legacy:docs/reports/06-evolucao-multi-jogo.md:134-141`) recomenda **não** escrever o segundo
provider antes de o jogo ser aprovado — a recomendação vale. O que entra agora são costuras de
custo quase zero que evitam migração de esquema e de contrato depois:

| Camada | Acoplamento a Minecraft na SRS | Ponto de extensão agora | Fica para depois |
|---|---|---|---|
| Modelo de dados | `ServerEntity` só com campos Minecraft (RCON:550-595) | `servers.game_type` (default `minecraft`), `routing_model`, `allocated_port` anulável; campos Minecraft em tabela 1:1 `minecraft_server_settings` | Tabela `terraria_server_settings` |
| DTO de criação | `CreateServerDTO` (ARQ:463-475) | Discriminador `gameType` | Variante Terraria |
| Gateway | `RouteTable` só por hostname (GW:222-242) | Chave listener + hostname; rota `dedicated-port` = *forward* L4 sem parser; `minecraft-protocol` já é crate separado (GW:562) | Listener por porta do pool |
| IPC | `RouteUpdateEvent` (GW:474-489) | Campos `game_type`, `routing_model`, `listen_port` — campos proto3 novos são compatíveis | — |
| Administração | `RconConnectionPool` direto | Interface `ConsoleDriver` (`sendCommand`, `listPlayers`, `saveOff`/`saveFlush`/`saveOn`) | Driver da REST do TShock, porta 7878 com token [F19] |
| Probes | Status Ping (ARQ:146-150) | Probe por provider; a máquina de estados ARQ:87-125 já é agnóstica | Probe TCP/REST |
| Backup | Checa `level.dat` (STO:873) | *Hook* `validateRestoredData` por provider | Implementação Terraria |
| Rede/ACL | `grants` só `tcp:25565` (TS:593) | Reservar faixa (ex. `tcp:7777-7799`) na policy; Terraria usa TCP 7777 [F18] | Pool configurável (ARQ:263) |
| Exposição | Spectrum Pro/Business só cobre Minecraft [F13] | Opção **A** da 2.8 serve a qualquer jogo | — |
| Catálogo | Modrinth/CurseForge | Módulo opcional por jogo (`legacy:docs/reports/06-evolucao-multi-jogo.md:115-119`) | — |

**RF-MG-01…07** = as sete primeiras linhas da tabela, com status "preparação". Anti-impersonation,
Rich MOTD e skins continuam só Minecraft; Terraria dependeria só da identidade Tailscale. Que o
cliente Terraria não envia hostname vem do legado (`06-evolucao-multi-jogo.md:45-49`); a doc
oficial consultada não diz [F18] → `[modelado]`.

---

## 3. Plano de implementação

| Fase | Conteúdo | Esforço [modelado] |
|---|---|---|
| **F0** | Corrigir as SRS: resolver C-01…C-19 e E-01…E-08; decidir `itzg` × instalador, topologia (PR-01/02), modelo de auth (L-01) | 2–3 d |
| **F1** | Crate `minecraft-protocol`: VarInt, String, Handshake (Intents 1–3), Status, Ping, Login Start por versão, Disconnect Login; PROXY v2 (GW:651) | 4–6 d |
| **F2** | Gateway: listener, Status/MOTD, proxy duplex, replay, `RouteTable` com chave listener + hostname (RF-MG), métricas (GW:652-653) | 6–9 d |
| **F3** | Control Plane: TypeORM + migrações com `game_type`, auth/RBAC, `/api/servers`, provisionamento k8s, reconciliador | 9–13 d |
| **F4** | RCON (`ConsoleDriver`), logs, WebSocket de terminal, auditoria (RCON:810-814) | 4–6 d |
| **F5** | Identidade: WhoIs, ACL, convites, `/join`, IPC gRPC, Smart Kick, anti-impersonation (GW:654-655) | 8–12 d |
| **F6** | Ciclo de vida: probes, auto-restart, hibernação, Auto-Wake, update/rollback | 6–9 d |
| **F7** | Storage: backups (algoritmo corrigido — D-01…D-04), restore, CAS, modpacks, retenção | 10–15 d |
| **F8** | Cloudflare opção A: driver DNS, listener público, `online-mode=true` | 3–5 d |
| **F9** | Tailcat (só se E-04 tiver solução) e Health Bot | 6–10 d |

**Mínimo viável** (um mundo Paper jogável pela Tailnet com console): F0–F4 + WhoIs/ACL básico
de F5 ≈ 27–40 d.
**Escopo completo:** F0–F9 ≈ 58–88 d.

Ordem importa: F0 antes de tudo, porque o enum de estado (C-01) e o esquema de usuário (C-03)
atravessam Gateway, IPC, banco e UI — errar ali custa uma migração em cada camada. F1 antes de
F2 deixa o parser testável sem I/O, como GW:562 pede.

---

## 4. Armadilhas da spec × situação real

### 4.1 Premissas desmentidas pela documentação oficial

| ID | Armadilha | Mitigação |
|---|---|---|
| **E-01** | Decoder RCON rejeita `packetLength > 4096` (RCON:217,255), mas resposta S→C tem até 4096 de payload — 4110 no total [F1]; respostas legítimas grandes derrubam a conexão. C→S aceita no máximo 1446 de payload [F1], e o encoder aceita ~4086 | Limites separados: encode ≤ 1446, decode ≤ 4110; montar respostas fragmentadas |
| **E-02** | `tag:player-*` em `tagOwners` e `grants` (TS:577-593): tags precisam existir uma a uma na policy [F2]; não há curinga documentado. Cada convite exige editar a ACL — e TS:617 proíbe sobrescrevê-la | Tag por **grupo** de jogadores (`tag:mc-player`) + identidade pelo nó (`node_id`/IP no banco), ou edição da ACL via API com aprovação explícita |
| **E-03** | Dispositivos *tagged* contam como recursos: 50 no plano Personal [F3], não "100 dispositivos" (TS:682). Funnel só escuta 443/8443/10000 [F4] × "Porta 3001" (ARQ:21, TS:22) | Dimensionar convidados pelo limite real; Funnel público em 443 com *backend* local na 3001 |
| **E-04** | Tailcat: sintaxe real `tailcat serve <porta>` e `tailcat <endereço> <porta>` [F5] × `tailcat forward` (TS:169). O servidor não vê o IP do cliente [F5] → WhoIs impossível; o cliente digita `localhost` (TS:172) → roteamento por subdomínio falha. Sem estabilidade de CLI [F5] | Um listener Tailcat por mundo roteado por porta; identidade só pelo nick → anti-impersonation perde a base. Recomendação: adiar (F9) |
| **E-05** | `CustomSkinLoader` é só *client-side* [F7] (ARQ:569, STO:563) | Remover da injeção de servidor |
| **E-06** | Handshake tem Intent 3 (*Transfer*) [F6] e as SRS só preveem 1 e 2 (ARQ:255, GW:193-197). Smart Kick em `ActiveProxy` exige conhecer o estado (Configuration/Play) e a compressão ativada por *Set Compression* [F6] | Tratar 3 como Login; Smart Kick via `kick` RCON + fechar socket |
| **E-07** | Com SRV, o hostname do Handshake é o alvo do SRV [F12] | Registrar o alvo como rota; ver **RF-CF-05** |
| **E-08** | local-path ignora capacidade [F8] → "quota de disco" (ARQ:406, STO:115) não é aplicada | Quota por *project quota* do FS ou checagem de uso no Control Plane |

### 4.2 Algoritmos quebrados na própria SRS

| ID | Armadilha | Mitigação |
|---|---|---|
| **D-01** | O Job cria o snapshot em `/data/.snapshot_tmp`, mas o `tar -C /data .` **exclui** `.snapshot_tmp*` (STO:799-805) → comprime o `/data` vivo, não o snapshot | `tar -C /data/.snapshot_tmp .` |
| **D-02** | `cp -al /data/world` (STO:795) ignora `world_nether/` e `world_the_end/` do Paper (visto em `create-minecraft-server/`) | Clonar todas as pastas de mundo, ou `/data` inteiro menos exclusões |
| **D-03** | Hardlink compartilha o inode; se a JVM escrever `.mca` *in place* depois do `save-on`, o "snapshot" muda junto `[modelado]` | Testar com `stat -c %i` + checksum; se confirmado, `cp --reflink` (Btrfs/XFS) ou `tar` com `save-off` durante a leitura |
| **D-04** | `touch /data/.snapshot_ready` (STO:796) não é observável pelo Control Plane; o *freeze* < 2 s ignora agendamento do Pod e *pull* de imagem `[modelado]` | Job pré-aquecido ou o próprio Job enviar `save-on`; medir antes de prometer 2 s |
| **D-05** | Restore sem `nodeAffinity` (STO:829-896 × STO:97); não confere SHA-256 (STO:309); rollback `rm -rf /data/*` apaga `lost+found` e `mv .../*` perde *dotfiles*; `PRE_RESTORE` (STO:580,598) nunca é gerado | Reescrever o script; staging vira backup `PRE_RESTORE` |

### 4.3 Contradições entre SRS

| ID | Contradição | Mitigação |
|---|---|---|
| **C-01** | Estados: 8 em ARQ:116-125 × `OFFLINE/STARTING/READY/MAINTENANCE` (RCON:543-548) × `Stopped/Starting/Ready/Crashed` (GW:234) × `STOPPED…MAINTENANCE` (GW:484); `MAINTENANCE` é política em TS:132 | Um enum de estado (ARQ) + política separada |
| **C-02** | Prisma (ARQ:530, TS:46) × TypeORM "desacoplado do Prisma" (RCON:457) | TypeORM, a decisão mais recente |
| **C-03** | `users`: `tailscale_user_id`, `email` (RCON:470-478) × `real_name`, nick `NOT NULL` (TS:426-433) | Esquema único |
| **C-04** | Auto-adoção de nick no 1º login (ARQ:563) × nick obrigatório no claim e `NOT NULL` (TS:325,429) | Nick no claim; auto-adoção só para admin |
| **C-05** | `CreateInviteDTO` com `playerName`/`scope` e `authKey` imediato (ARQ:493-515) × `name`/`maxUses` e chave só no claim (TS:515-528); `joinUrl` `#tskey` (ARQ:506) × `?token` (TS:301) | Modelo de TS (multi-uso) |
| **C-06** | Nick `{2,16}` (GW:431) × `{3,16}` (TS:538) | Uma regex compartilhada |
| **C-07** | Cache WhoIs 60 s (GW:252) × 300 s (TS:653) | Um valor |
| **C-08** | `max-tick-time=60000` obrigatório para watchdog (ARQ:353) × `-1` em modpacks (STO:552) | Watchdog do Hypervisor (RF-ARQ-05) cobre o caso `-1` |
| **C-09** | Startup até 15 min (ARQ:145) × 10 min (STO:909); ARQ:141 critica o mesmo `failureThreshold: 60` que STO:909 adota | Um valor por perfil de servidor |
| **C-10** | Socket `/run/tailscale/…` (GW:41) × `/var/run/tailscale/…` (TS:653) | Configurável |
| **C-11** | Namespace `default` (RCON:361) × `minekubernetes` (STO:105) | `minekubernetes` — o legado mostra outro projeto no `default` |
| **C-12** | SEC-01 aceita só `100.64.0.0/10` (TS:670) × listener *dual-stack* (GW:29) e Tailcat via localhost | Faixas por listener |
| **C-13** | Nova sessão despeja a antiga (GW:438) × "o protocolo rejeita a segunda" (TS:681) | Manter GW:438 |
| **C-14** | Probe via Status Ping (ARQ:146) × Readiness via "TCP Ping / Query" (ARQ:95) | Status Ping |
| **C-15** | `enforce-secure-chat` também em `paper-global.yml` (ARQ:573) × só `server.properties` (STO:551) | Só `server.properties` `[modelado]` — conferir doc Paper |
| **C-16** | `execution_source` `API`/`SLEEP_MODE` (RCON:520) × `REST_API`/`SLEEP_MODE_AUTOMATION`/`BACKUP_ROUTINE` (RCON:613-617) | Enum do código TypeORM |
| **C-17** | Limite = heap + 1 Gi (ARQ:275) × Paper recomenda 1000–1500 MB de folga [F10] | +1,5 Gi como piso |
| **C-18** | `TYPE=AUTO_CURSEFORGE/MODRINTH` (ARQ:133) é convenção da imagem `itzg` × `InstallerJob` + CAS próprios (STO:42,467) | Decidir em F0: dois instaladores não |
| **C-19** | ARQ "agnóstica de linguagem" (ARQ:8) × GW Rust e RCON/STO NestJS | Aceitar os dois runtimes ou unificar (R-05) |

### 4.4 Lacunas

| ID | Lacuna | Mitigação |
|---|---|---|
| **L-01** | RBAC com tokens (ARQ:603) sem rota de login, emissão, expiração nem bootstrap do 1º admin; RCON:686 admite "identidade Tailscale injetada" | Decidir: identidade Tailscale como auth do painel (sem senha) ou JWT |
| **L-02** | `server_groups.server_id` e `user_server_access.server_id` sem FK (TS:484,492) → linhas órfãs ao excluir servidor | FK com `ON DELETE CASCADE` |
| **L-03** | Claim incrementa a cota antes da Cloud API (TS:327-341); falha nela consome cota sem chave | Compensação ou chave antes do commit |
| **L-04** | Upload `.zip` e API de arquivos (ARQ:414-420) sem *zip-slip* nem symlink | Normalizar caminho e recusar links |
| **L-05** | `fuser` dentro do container não enxerga processos de outros Pods do host (STO:179-185) `[modelado]` | Garantia vem do RWO + réplica 0 confirmada |
| **L-06** | Nome com `sha256Prefix` (STO:272) antes de o hash existir; o manifesto usa nome sem ele (STO:804) | Nome sem hash; hash no banco |
| **L-07** | `/cache` RWX com `lru_index.db` SQLite (STO:484) escrito por Jobs concorrentes | Índice no PostgreSQL |
| **L-08** | Timeout RCON de 5 s (RCON:337) × `save-all flush` em mundo grande `[modelado]` | Timeout por comando |
| **L-09** | Sem SRS para a UI SPA | SRS mínima de telas antes de F3 |

---

## 5. Verificação

Nada abaixo foi executado. Automatizável em CI/host: parser, codec, decisão de acesso, esquema.
O resto exige cluster, Tailnet ou conta Cloudflare reais.

**Automatizável (`cargo test`):**
- [ ] VarInt com bit de continuidade no 5º byte → erro, sem alocação — guarda RF-GW-04.
- [ ] Handshake com Intent 3 roteado como Login — guarda E-06 [F6].
- [ ] `"SURVIVAL.mine.lan\0FML3\0:25565"` → `survival.mine.lan` — guarda RF-GW-05.
- [ ] PROXY v2 de IP fora de `TRUSTED_PROXY_IPS` é ignorado — guarda RF-GW-06.
- [ ] Rota `dedicated-port` faz *forward* sem invocar o parser — guarda RF-MG.

**Automatizável (`jest` no Control Plane):**
- [ ] Decoder aceita resposta RCON de 4110 bytes; encoder recusa payload > 1446 — guarda E-01 [F1].
- [ ] Buffer circular com 700 entradas devolve as últimas 500 em ordem — guarda RF-RCON-08.
- [ ] 10 claims simultâneos em convite `maxUses=1` → exatamente 1 sucesso — guarda RF-TS-08.
- [ ] Criar servidor sem `gameType` persiste `minecraft` — guarda RF-MG.
- [ ] Um único enum de estado usado por API, banco e `.proto` (teste de contrato) — guarda C-01.

**Só no cluster k3s:**
- [ ] Hot backup: inode e SHA-256 de um `.mca` no snapshot inalterados após `save-on` e 5 min
      de jogo — decide D-03.
- [ ] O `.tar.gz` contém `world_nether/` e `world_the_end/` — guarda D-02.
- [ ] *Freeze* entre `save-off` e `save-on`: 10 execuções, mediana e p95 medidas; aprova se
      p95 ≤ 2 s — sustenta ou derruba RF-STO-03.
- [ ] Restore com `.tar.gz` corrompido deixa `/data` idêntico ao anterior (hash da árvore) — D-05.

**Só na Tailnet real (cuidado: ACL afeta a rede do usuário):**
- [ ] Criar chave com tag não declarada falha; com tag declarada funciona — confirma E-02 [F2].
- [ ] Nó *tagged* aparece como recurso na cobrança — confirma E-03 [F3].

**Só com conta Cloudflare:**
- [ ] Registro SRV criado via API resolve, e o Handshake chega com o alvo do SRV — RF-CF-05 [F12].
- [ ] Mundo `INTERNET` com `online-mode=true` rejeita cliente pirata — RF-CF-02.
- [ ] Atrás do Spectrum, `peer_addr` é IP da Cloudflare; checar se há PROXY Protocol — **B** [F13].

---

## 6. Riscos

1. **O modelo de identidade por tag não escala como descrito.** Com tags declaradas uma a uma
   [F2] e limite de recursos *tagged* [F3], o desenho "uma tag por jogador" esbarra em dezenas de
   convidados. Se F0 não trocar o modelo, F5 é refeita.
2. **Mundo público quebra a premissa Zero-Trust.** Com a 2.8, pirata e premium convivem só em
   mundos privados; o público fica `online-mode=true`, e o painel precisa deixar isso explícito.
3. **Opção A expõe o IP residencial** e não tem mitigação de DDoS; a opção B tem franquia de
   dados que alguns jogadores ativos podem estourar `[modelado]`.
4. **Tailcat é experimental** [F5] e não resolve identidade; construir o onboarding em cima dele
   é apostar numa CLI sem estabilidade.
5. **Dois runtimes num homelab single-node.** Rust + Node dobram toolchain, imagem e CI. O ganho
   de memória do Gateway em Rust (< 30 MB, GW:70) não tem medição de base.
6. **Termos da CurseForge.** O "espelho de borda seguro" para mods com `allowModDistribution:
   false` (STO:463) redistribui arquivos que o autor bloqueou; o campo existe na API [F9], e os
   termos precisam ser lidos antes de implementar.

---

## 7. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `docs/SRS-*.md` (5) | Correções de F0 (C-*, E-*, D-*) |
| `docs/SRS-EXPOSICAO-PUBLICA.md` | **novo** — formaliza a 2.8 |
| `docs/SRS-FRONTEND.md` | **novo** — L-09 |
| `crates/minecraft-protocol/`, `crates/gateway/` | **novos** (GW:556-614) |
| `proto/gateway/v1/gateway.proto` | **novo**, com campos de RF-MG |
| `control-plane/` (NestJS) | **novo** — entidades, migrações, módulos de 2.1–2.5 |
| `k8s/` | **novo** — namespace, StorageClass, PVCs, RBAC, Jobs corrigidos |
| `.env.example` | **novo** — PR-11…PR-17 e `CLOUDFLARE_API_TOKEN` |
| `docs/reports/INVENTARIO-REQUISITOS-HYPERVISOR.md` | este relatório |

---

## 8. Fontes consultadas

| # | Fonte | Tipo | Versão | Consultada em | Sustenta |
|---|---|---|---|---|---|
| F1 | [Minecraft Wiki — RCON](https://minecraft.wiki/w/RCON) | Doc da comunidade | atual | 2026-09-28 | E-01 |
| F2 | [Tailscale — Tags](https://tailscale.com/kb/1068/tags) | Doc oficial | atual | 2026-09-28 | E-02, PR-11, risco 1 |
| F3 | [Tailscale — Pricing](https://tailscale.com/pricing) | Doc oficial | atual | 2026-09-28 | E-03, risco 1 |
| F4 | [Tailscale — Funnel](https://tailscale.com/kb/1223/funnel) | Doc oficial | atual | 2026-09-28 | E-03, PR-10, 2.8 D |
| F5 | [`tailscale/tailcat`](https://github.com/tailscale/tailcat) | Doc oficial | atual | 2026-09-28 | E-04, risco 4 |
| F6 | [Minecraft Wiki — Java Edition protocol/Packets](https://minecraft.wiki/w/Java_Edition_protocol/Packets) | Doc da comunidade | protocolo 777 | 2026-09-28 | E-06 |
| F7 | [Modrinth — CustomSkinLoader](https://modrinth.com/mod/customskinloader) | Página do projeto | atual | 2026-09-28 | E-05 |
| F8 | [`rancher/local-path-provisioner`](https://github.com/rancher/local-path-provisioner) | Doc oficial | atual | 2026-09-28 | E-08, PR-03, PR-05 |
| F9 | [CurseForge REST API](https://docs.curseforge.com/rest-api/) | Doc oficial | v1 | 2026-09-28 | PR-12, risco 6 |
| F10 | [PaperMC — Aikar's flags](https://docs.papermc.io/paper/aikars-flags) | Doc oficial | atual | 2026-09-28 | RF-ARQ-10, C-17 |
| F11 | [Cloudflare API — Create DNS record](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/) | Doc oficial | v4 | 2026-09-28 | 2.8 A |
| F12 | [Minecraft Wiki — Java Edition 1.17.1](https://minecraft.wiki/w/Java_Edition_1.17.1) | Doc da comunidade | 1.17.1+ | 2026-09-28 | E-07, RF-CF-05 |
| F13 | [Cloudflare Spectrum — Protocols per plan](https://developers.cloudflare.com/spectrum/protocols-per-plan/) | Doc oficial | atual | 2026-09-28 | 2.8 B, 2.9 |
| F14 | [Cloudflare Blog — SSH, RDP and Minecraft](https://blog.cloudflare.com/cloudflare-for-ssh-rdp-and-minecraft/) | Artigo do fornecedor | 2021 | 2026-09-28 | 2.8 B (franquia) |
| F15 | [Cloudflare Spectrum — Configuration options](https://developers.cloudflare.com/spectrum/reference/configuration-options/) | Doc oficial | atual | 2026-09-28 | 2.8 B |
| F16 | [Cloudflare Spectrum — Limitations](https://developers.cloudflare.com/spectrum/reference/limitations/) | Doc oficial | atual | 2026-09-28 | 2.8 B |
| F17 | [Cloudflare Tunnel — SSH](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/) | Doc oficial | atual | 2026-09-28 | 2.8 C |
| F18 | [Terraria Wiki — Server](https://terraria.wiki.gg/wiki/Server) | Doc da comunidade | atual | 2026-09-28 | 2.9 |
| F19 | [TShock — REST API endpoints](https://tshock.readme.io/reference/rest-api-endpoints) | Doc oficial | 5.x | 2026-09-28 | 2.9 |

Não consultados e por isso `[modelado]`: a doc do Paper sobre onde vive `enforce-secure-chat`
(C-15); o comportamento de escrita *in place* das regiões `.mca` (D-03); o suporte a PROXY
Protocol para apps Minecraft no Spectrum (2.8 B); os termos de distribuição da CurseForge
(risco 6). F12 foi lido por resumo de busca, não pela página inteira.

---

> Nenhum item deste relatório foi executado em cluster, Tailnet ou conta Cloudflare. Toda a
> análise vem da leitura das 5 SRS no `main` (commit `ca48f39` + 4 arquivos não rastreados), do
> branch `legacy` e das fontes da seção 8; a validação está listada na seção 5 como pendente.
