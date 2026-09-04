# Relatório 02 — Tailscale, roteamento de rede e controle granular

> Ver [00-indice.md](00-indice.md) para contexto do ambiente antes de executar qualquer coisa aqui.
> Este é o relatório mais crítico dos três: sem o que está descrito aqui, **ninguém além
> do dono consegue conectar de forma controlada**, e o caminho que "funciona" hoje na
> prática ignora toda autorização.

## Por que isso importa

O sistema precisa que outras pessoas (família, amigos) entrem nos servidores de
Minecraft, e que cada uma alcance **apenas** os servidores aos quais tem permissão. Existe
código real e bem pensado para isso — um proxy TCP customizado (`GatewayService`) que
faz parsing do handshake do Minecraft, resolve a identidade do jogador via Tailscale e
autoriza por interseção de grupos no Prisma. **Esse código nunca chegou a rodar de
verdade**: uma cadeia de 8 falhas independentes, cada uma sozinha suficiente para quebrar
o sistema, faz com que ele hoje rejeite 100% das conexões — e a única razão de alguém
conseguir jogar é um caminho paralelo (`mc-router`) que ignora toda autorização.

Tudo abaixo foi confirmado no código real **e** ao vivo no cluster/tailnet deste
ambiente — não é especulação.

---

## As 8 falhas encadeadas (diagnóstico completo)

| # | Falha | Evidência |
|---|---|---|
| 1 | `createServer` grava só no K8s, nunca no Prisma | `servers.service.ts:192-231` — nenhum `prisma.server.create` |
| 2 | Gateway rejeita domínio inexistente no banco | `gateway.service.ts:242-252` → `authorized:false` para 100% das conexões |
| 3 | Dispositivos com tag colapsam na identidade sintética `tagged-devices` | tailnet real: `minekube-dashboard` tem `tag:minecraft-server` e `UserID → tagged-devices` |
| 4 | A página `/join` é HTML estático, nunca vincula ninguém ao Prisma | `join-server/main.ts` importa só `node:http` |
| 5 | Gateway escuta 25565 dentro do pod, sem exposição | `k8s/nestjs-api.yaml` declara só as portas 3000 e 3001 |
| 6 | Annotation `mc-router.itzg.me` cria bypass total do ACL | `servers.service.ts:181-183` — é por isso que "funciona" |
| 7 | ACL da tailnet tem grant curinga `* → * : *` | política real da tailnet (ver Achado 7 abaixo): zero restrição de rede |
| 8 | Banco de produção é efêmero (path errado) | app abre `/usr/src/app/dev.db`, manifest monta `/app/dev.db` |

A falha 7 tem impacto **além do Minecraft**: hoje, convidar um amigo para jogar dá a ele
acesso de rede a todo o homelab do dono — Vaultwarden, AdGuard, `proxy-home`,
`dns-internal`, todos alcançáveis pela tailnet sem restrição nenhuma.

A falha 8 é fatal para qualquer correção das outras sete: sem consertar, todo usuário,
grupo e servidor cadastrado desaparece a cada restart do pod da API.

### Detalhe de cada achado

**Achado 1 — `createServer` não sincroniza com o Prisma.**
`servers.service.ts:192-231` cria PVC, Deployment e Service via `@kubernetes/client-node`
tipado, mas nunca grava um `Server` no Prisma. `deleteServer` (l.310-341) tem o mesmo
problema no sentido inverso — deleta os recursos K8s e deixa a linha órfã no banco.
Prova no banco atual (`sqlite3 dashboard/backend/dev.db`, 3 registros): todos têm
`k8sServiceName` como **IP hardcoded** (`10.43.51.55`), inserções manuais de debug —
nenhum corresponde a um Service real criado pela dashboard.

**Achado 2 — o Gateway nega por padrão quando o domínio não existe no banco.**
`gateway.service.ts:242-252`:
```ts
const server = await this.prisma.server.findUnique({ where: { subdomain: requestedDomain }, ... });
if (!server) return { authorized: false };
```
Consequência direta do achado 1: nenhum servidor criado pela dashboard existe no Prisma,
então **nenhuma conexão é autorizada** — nem a do próprio ADMIN, cujo bypass
(`gateway.service.ts:279`) só é avaliado depois de o `findUnique` ter sucesso.

**Achado 3 — identidade por tag colapsa todo mundo na mesma pessoa.**
Confirmado com `tailscale status --json` real desta tailnet: o dispositivo
`minekube-dashboard` tem `Tags: ['tag:minecraft-server']` e resolve para
`UserID: 7222479181391666`, que no mapa de usuários é `"tagged-devices" | DisplayName:
"Tagged Devices"` — uma identidade sintética que o Tailscale atribui a **todo** dispositivo
tagueado, não uma pessoa. `TailscaleService.getDeviceOwner` (`tailscale.service.ts:167-221`)
devolve `device.user`, que para dispositivos tagueados é sempre esse mesmo ID — ou seja,
mesmo que os achados 1 e 2 fossem corrigidos, **todo jogador convidado por tag resolveria
para o mesmo `User` no Prisma** (ou para nenhum, já que nenhum `User.tailscaleUserId`
seria `"tagged-devices"`).

**Achado 4 — a página `/join` não vincula nada.**
`src/join-server/main.ts` (339 linhas, implementado, não é stub) serve uma página HTML
estática. A `authKey` chega via `window.location.hash` (client-side, nunca toca o
servidor — decisão de segurança correta, documentada nas linhas 234-235 do arquivo). O
único import do arquivo é `node:http` — **não há rota POST, não há import de
`PrismaService` ou `@prisma/client`, não há nenhuma escrita no banco**. O fluxo termina
no navegador do jogador abrindo o app Tailscale; nada volta para registrar quem ele é.

**Achado 5 — o Gateway não está exposto.**
`k8s/nestjs-api.yaml` declara `containerPort: 3000` (API) e `3001` (join-server), nunca
`25565`. `gateway.service.ts:42` faz `this.server.listen(25565, '0.0.0.0', ...)` dentro
do processo Node, mas sem `hostPort`/`hostNetwork`/Service dedicado, essa porta só é
alcançável **de dentro do próprio pod**. Confirmado ao vivo: `kubectl get svc -n default`
mostra `minekube-api-svc` com portas `3000/TCP,3001/TCP` apenas.

**Achado 6 — a annotation do mc-router cria um bypass total.**
`servers.service.ts:181-183`, em todo Service criado:
```ts
annotations: { 'mc-router.itzg.me/externalServerName': `${safeName}.${baseDomain}` },
```
`updateDomain` (l.343-367) permite reescrever essa annotation a qualquer momento via
`PATCH /api/servers/:id/domain`, sem tocar o Prisma. O `mc-router` (rodando via
Terraform, ver relatório 03) descobre Services por essa annotation e rotea **direto para
o pod**, sem consultar o Prisma, sem checar Tailscale, sem passar pelo `GatewayService`.
É por isso que qualquer pessoa na rede consegue conectar hoje — apesar de todo o sistema
de ACL estar quebrado. Confirmado ao vivo: `mc-router-service` (namespace
`teste-terraform`) tem `EXTERNAL-IP 192.168.0.240:25565` via MetalLB, é o único caminho
com IP público hoje, e seus logs mostram `"Monitoring Kubernetes for Minecraft
services"` sem nenhuma menção a autorização.

**Achado 7 — a ACL da tailnet está totalmente aberta.**
Lida ao vivo via `GET /api/v2/tailnet/{tailnet}/acl` com o token real do `.env`:
```json
"grants": [{ "src": ["*"], "dst": ["*"], "ip": ["*"] }]
```
Isso é a política moderna do Tailscale (`grants`) dizendo "qualquer nó alcança qualquer
nó, em qualquer porta". As três regras em `acls` (formato legado) são inofensivas
(`autogroup:admin → *:*`, DNS, uma sub-rede compartilhada) — é o `grants` curinga que
anula qualquer intenção de segmentação. `TailscaleService.ensureTagsInACL`
(`tailscale.service.ts:226-294`) só escreve em `tagOwners` (quem **pode possuir** a tag),
nunca em `grants` (quem **pode alcançar** o quê) — as tags hoje são só rótulos
decorativos, não restringem tráfego nenhum.

**Achado 8 — o banco de produção não persiste.**
`PrismaService` (`prisma.service.ts:10`) faz `appConfig.databaseUrl.replace('file:', '')`
→ caminho relativo resolvido a partir do CWD do processo (`/usr/src/app` dentro do
container, conforme `Dockerfile.prod`). `k8s/nestjs-api.yaml` monta o hostPath do banco em
`/app/dev.db` — **caminho diferente do que a aplicação realmente abre**. Todo dado gravado
em produção (usuários, grupos, servidores) é perdido no primeiro restart do pod. Além
disso, esse hostPath aponta para
`/home/luis/Documents/proxmox/mineKubernetes/dashboard/backend/dev.db` — o disco pessoal
do desenvolvedor, não algo portável para outro nó.

### Achados adicionais de projeto/nomenclatura (menores, mas reais)

- **Tipo de Service divergente da intenção do código**: `servers.service.ts:176-190` cria
  `type: 'ClusterIP'` hardcoded, mas `getServers` (l.258) lê `svc?.spec?.ports?.[0]?.nodePort`
  esperando NodePort — `connectionPort` sempre retorna `null` para servidores criados pela
  dashboard. Os `NodePort` que existem no cluster real (`mc-better-mc-forge-bmc4-svc`,
  `mc-test-modpack-svc`) são resquícios manuais, não produto deste código.
- **`BASE_DOMAIN` vs `MINEKUBE_BASE_DOMAIN`**: `.env.example:61` documenta a variável
  errada (`MINEKUBE_BASE_DOMAIN`); o código lê `BASE_DOMAIN`
  (`app-config.schema.ts:12`, `app-config.service.ts:36-38`). Quem copiar o exemplo cai
  silenciosamente no default do Joi (`mine.luiis.com.br`) sem perceber.
- **`kickPlayerFromWorld` é código morto**: `gateway.service.ts:214-231` implementa o
  "Smart Kick" descrito no `TODO.md`, mas `grep -rn "kickPlayerFromWorld"` só acha a
  própria definição — nenhum chamador em lugar nenhum. `AdminService.removeUserFromGroup`
  (`admin.service.ts:89-98`) tem um comentário admitindo isso: *"por ora vamos deixar o
  Gateway cuidar dos IPs"* — mas ninguém liga um no outro.
- **`AdminService` não tem `removeServerFromGroup`**: dá para adicionar um servidor a um
  grupo (`addServerToGroup`), mas não para tirar. Revogar acesso de um grupo inteiro a um
  servidor não é possível pela API hoje.
- **join-server não roda no cluster**: `Dockerfile.prod` executa só `dist/main.js`
  (`CMD ["node", "--max-old-space-size=3072", "dist/main.js"]`). O script
  `start:join:prod` existe em `package.json` mas nunca é chamado — a porta 3001, apesar
  de exposta via NodePort 30001 em `nestjs-api.yaml`, não tem ninguém escutando no pod real.

---

## Decisões de arquitetura (já tomadas pelo dono do projeto)

Estas três decisões foram discutidas e aprovadas — implemente seguindo-as, não
reabra a discussão sem motivo novo:

1. **Identidade por jogador: tag única por convite** (`tag:player-<id>`), pré-criada no
   Prisma no momento do convite. Rejeitado: usuário Tailscale por jogador (esbarra no
   limite de 3 usuários do plano free) e sidecar Tailscale por servidor (multiplica
   dispositivos, jogadores passariam a usar hostnames `.ts.net` em vez dos subdomínios).
2. **Entrada de rede: só o `GatewayService`.** O `mc-router` é aposentado — é o que causa
   o bypass do achado 6. Rejeitado: manter os dois em portas separadas (dois caminhos
   para auditar, risco de expor servidor privado por engano) e manter o `mc-router` com
   ACL em outra camada (descartaria a peça mais bem construída do sistema).
3. **Terraform aposentado.** Confirmado ao vivo que ele só gerencia 9 recursos, todos
   mortos ou redundantes: `mc-router` (SA, ClusterRole, Binding, Deployment, Service, a
   serem removidos pela decisão 2), um `minecraft-deployment`/`minecraft-service` de
   tutorial em `ErrImageNeverPull`, e um `Ingress` apontando para um Service
   (`dashboard-service`) que nunca existiu. **Os servidores de Minecraft nascem em
   runtime pela API NestJS** (`servers.service.ts`), não pelo Terraform — removê-lo não
   tira nenhuma capacidade de provisionar. Detalhes completos no relatório 03.

---

## Plano de correção, fase a fase

### Fase 1 — Pré-requisito: suíte de testes rodando

Ver [relatório 01, Parte A](01-testes-e-validacoes.md#parte-a--o-que-está-quebrado-agora-bloqueadores).
Sem isso não há rede de segurança para as fases abaixo.

### Fase 2 — Fechar a sincronia Prisma ↔ Kubernetes

Resolve os achados 1 e (parcialmente) 2.

- `src/servers/servers.service.ts`, `createServer` (l.192-231): depois de criar os
  recursos K8s, gravar o `Server` no Prisma via `prisma.server.upsert` (idempotente,
  igual ao tratamento de 409 já usado para os recursos K8s) chaveado por `subdomain`:
  - `subdomain: `${safeName}.${baseDomain}`` (mesma expressão já usada na l.182)
  - `k8sServiceName: `${serverName}-svc``
  - `k8sServicePort: 25565`
  - `name: dto.name`, `memoryAllocated: dto.memoryAllocated || '4G'`
- `deleteServer` (l.310-341): `prisma.server.deleteMany({ where: { k8sServiceName:
  `${name}-svc` } })` — use `deleteMany`, não `delete`, para não lançar se a linha não
  existir (mesmo espírito tolerante dos `try/catch` já existentes no método).
- `updateDomain` (l.343-367): passar a atualizar `Server.subdomain` no Prisma. Nesta fase
  ainda pode manter a escrita da annotation K8s também (só remova de vez na Fase 4,
  junto com a aposentadoria do `mc-router` — trocar os dois de uma vez é mais fácil de
  verificar).
- Limpar as 3 linhas de debug do banco atual (`k8sServiceName` com IP hardcoded).
- `.env.example:61`: corrigir `MINEKUBE_BASE_DOMAIN` → `BASE_DOMAIN`.

### Fase 3 — Identidade por tag e vínculo automático

Resolve os achados 3 e 4.

- `prisma/schema.prisma`: adicionar `tailscaleTag String? @unique` ao model `User`,
  mantendo `tailscaleUserId` (o dispositivo pessoal do dono **não** é tagueado — resolve
  por `tailscaleUserId` como hoje). Gerar migration (`npx prisma migrate dev`).
- `src/tailscale/tailscale.module.ts`: importar `PrismaModule` (`TailscaleService` passa
  a depender de `PrismaService`).
- `src/tailscale/tailscale.service.ts`:
  - `createInvite`: gerar uma tag única por jogador (`tag:player-<hex aleatório>`, use
    `node:crypto randomBytes` — já é dependência nativa, não precisa de pacote novo),
    incluí-la junto às tags de escopo já existentes (`resolveTagsForScope` continua
    servindo para os `grants` da Fase 5), e **pré-criar o `User` no Prisma**:
    ```ts
    await this.prisma.user.create({
    	data: { tailscaleTag: playerTag, minecraftNick: dto.playerName, role: 'PLAYER' },
    });
    ```
    Isso é o que elimina a necessidade de qualquer callback na página `/join` — o
    vínculo já existe antes do jogador nem instalar o Tailscale.
  - Renomear `getDeviceOwner(ip)` → `getDeviceIdentity(ip)`, devolvendo
    `{ userId: string | null; tags: string[] }` em vez de só uma string. Atualizar o
    cache interno (`deviceOwnerCache` → `deviceCache`) para guardar esse objeto por IP.
  - Adicionar `invalidateDeviceCache()` (zera `lastCacheUpdate`), chamado ao fim de
    `createInvite` — barato e evita qualquer janela de cache obsoleto para convites
    reemitidos.
  - Escopo `individual`/`group` de `resolveTagsForScope` continua gerando tags
    `tag:<serverId>`/`tag:group-<id>` para uso nos `grants` da Fase 5 — **não** tente
    ligar isso ao modelo `Group` do Prisma; são dois mecanismos paralelos por design
    (rede via Tailscale grants, autorização de aplicação via Prisma). Vínculo a um
    `Group` do Prisma continua sendo uma ação manual do admin via
    `AdminService.addUserToGroup` (já implementado, não precisa de mudança).
- `src/gateway/gateway.service.ts`, `checkAuthorization` (l.236-316): resolução dupla de
  identidade —
  ```ts
  const identity = await this.tailscaleService.getDeviceIdentity(clientIp);
  const playerTag = identity.tags.find((t) => t.startsWith('tag:player-'));

  const user = playerTag
  	? await this.prisma.user.findFirst({ where: { tailscaleTag: playerTag }, include: { groups: true } })
  	: identity.userId
  		? await this.prisma.user.findFirst({ where: { tailscaleUserId: identity.userId }, include: { groups: true } })
  		: null;

  if (!user) return { authorized: false };
  ```
  O resto do método (bypass de ADMIN, interseção de grupos) permanece como está.

### Fase 4 — Colocar o Gateway no caminho do tráfego

Resolve os achados 5, 6 e 8. **Esta fase inclui uma janela de corte real** — leia a
seção de riscos abaixo antes de aplicar em produção.

- `k8s/nestjs-api.yaml`: adicionar ao container da API:
  ```yaml
  ports:
    - containerPort: 3000
      name: api
    - containerPort: 3001
      name: join
    - containerPort: 25565
      hostPort: 25565
      name: mc-gateway
  ```
  `hostPort` é necessário (não um `Service` comum) porque o `GatewayService` precisa ver
  o IP de origem real (`100.x`) do jogador para consultar o Tailscale — um `Service`
  ClusterIP/NodePort padrão faz SNAT e mascara isso. **Valide isto explicitamente na
  verificação abaixo — é o maior risco técnico da fase.** Se o `hostPort` também mascarar
  o IP (não deveria, mas confirme), o fallback é `hostNetwork: true` no pod, viável só
  depois que o `mc-router` sair da porta 25565 do nó.
- Aposentar o `mc-router`: hoje `svclb-mc-router-service` ocupa a `hostPort 25565` do nó
  via DaemonSet do MetalLB — ele precisa ser removido (Terraform, relatório 03) **antes**
  de o Gateway conseguir assumir a porta, já que é cluster single-node.
- `servers.service.ts:181-183`: remover a annotation `mc-router.itzg.me/externalServerName`
  do manifest de Service — sem o `mc-router` rodando ela não faz nada, mas removê-la
  também fecha o bypass do achado 6 de vez, caso alguém reintroduza o `mc-router` no
  futuro por engano.
- Corrigir o banco efêmero: `DATABASE_URL=file:/data/minekube.db` no Secret
  `minekube-api-secret`, com um PVC `local-path` montado em `/data` no lugar do
  `hostPath` atual (`/home/luis/Documents/.../dev.db`) — torna o dado portável para
  qualquer nó, não só o disco pessoal do dev.
- Rodar o `join-server` de verdade: adicionar um segundo container no pod da API rodando
  `node dist/join-server/main.js` (o `Dockerfile.prod` já builda `dist/join-server/`, só
  falta o `CMD`/container extra usá-lo), e confirmar que o `tailscale funnel --bg 3001`
  do host aponta para a porta certa.
- DNS: `*.mine.luiis.com.br` precisa resolver para o IP Tailscale do nó (visto ao vivo:
  `100.109.250.127`). O domínio que chega no handshake do Minecraft precisa bater
  exatamente com `Server.subdomain` no Prisma — confirme o registro DNS antes de testar
  ponta a ponta.

### Fase 5 — Endurecer a ACL da tailnet e habilitar revogação

Resolve o achado 7 e liga o "Smart Kick".

- `ensureTagsInACL` (`tailscale.service.ts:226-294`): hoje só escreve `tagOwners`.
  Estender para também escrever `grants` reais — algo como (ajustar à sintaxe atual da
  API de grants do Tailscale, que evolui):
  ```json
  { "src": ["tag:player-*"], "dst": ["tag:minecraft-server:25565"], "ip": ["tcp:25565"] }
  ```
- **Substituir o grant curinga `* → * : *` por regras restritivas é uma mudança de alto
  risco — revise manualmente antes de aplicar.** Errar aqui tira o próprio acesso do dono
  à tailnet (Vaultwarden, AdGuard, SSH, etc. ficam inacessíveis se a regra for ampla
  demais na direção errada). Preserve explicitamente `{ "src": ["autogroup:admin"], "dst":
  ["*:*"] }`. Teste a mudança logado como o próprio dono antes de convidar qualquer
  jogador de teste.
- Ligar `kickPlayerFromWorld` (`gateway.service.ts:214`, hoje sem chamador):
  - Em `AdminService.removeUserFromGroup` (`admin.service.ts:89-98`): depois de remover
    o vínculo, buscar os servidores que o grupo removido dava acesso e chamar
    `gateway.kickPlayerFromWorld` para cada domínio, se o usuário estiver conectado.
  - Em `TailscaleService.revokeDevice`: idem, ao remover um dispositivo da tailnet.
- Adicionar `removeServerFromGroup` em `AdminService` (simétrico ao `addServerToGroup`
  já existente) e o endpoint correspondente em `AdminController`/`admin.service.ts` —
  hoje não há como revogar o vínculo de um servidor a um grupo pela API.

### Fase 6 — Testes da lógica de autorização

Escopo: só o que as fases 2-5 mudam, não uma revisão geral da suíte (isso é o
[relatório 01](01-testes-e-validacoes.md)).

- Matriz de autorização do `GatewayService`: domínio desconhecido → nega; dispositivo
  fora da tailnet (`identity.userId` e `tags` vazios) → nega; jogador com tag mas sem
  `User` correspondente no Prisma → nega; jogador com `User` mas sem grupo em comum com
  o servidor → nega; jogador com grupo em comum → autoriza; bypass de `role: 'ADMIN'`
  independente de grupo → autoriza.
- Parsing do handshake do Minecraft (`MinecraftProtocol.readVarInt`/`readString`),
  incluindo a limpeza de sujeira do Forge (`requestedDomain.split('\\0')[0]`).
- Resolução dupla de identidade: dispositivo com `tag:player-*` resolve por
  `tailscaleTag`; dispositivo sem tag resolve por `tailscaleUserId`; dispositivo sem
  nenhum dos dois não resolve usuário.
- Sincronia: `createServer` grava a linha esperada no Prisma (`subdomain`,
  `k8sServiceName`); `deleteServer` remove.
- `createInvite`: pré-cria o `User` com a tag correta, e a tag realmente aparece nas
  tags passadas para a API do Tailscale (`capabilities.devices.create.tags`).

---

## Verificação de ponta a ponta

Cada item é verificável no cluster/tailnet reais deste ambiente:

1. **Sincronia** — criar servidor pela API, conferir a linha no Prisma
   (`subdomain`/`k8sServiceName` corretos); deletar, conferir que sumiu.
2. **IP de origem preservado** (maior risco técnico da Fase 4) — conectar de outro
   dispositivo da tailnet, confirmar no log do `GatewayService` que `clientIp` é `100.x`,
   não o IP do nó.
3. **Autorização real** — com dois usuários e dois grupos, o jogador sem permissão
   recebe o pacote de disconnect (`MinecraftProtocol.createDisconnectPacket`); o
   autorizado entra no mundo.
4. **Bypass fechado** — depois de remover a annotation e o `mc-router`, confirmar que
   não existe mais caminho para conectar num servidor sem passar pelo Gateway.
5. **Persistência** — reiniciar o pod da API, confirmar que usuários/grupos/servidores
   continuam no banco (hoje some tudo).
6. **Revogação** — remover um jogador de um grupo enquanto conectado, confirmar que é
   derrubado com a mensagem de permissão revogada.
7. **Isolamento do homelab** — de um dispositivo com `tag:player-*`, confirmar que
   Vaultwarden e AdGuard deixaram de ser alcançáveis, e que o acesso de admin do dono
   continua intacto.
8. `npm test` verde no backend, cobrindo a matriz de autorização da Fase 6.

## Fora de escopo deste relatório

- **RCE em `sendCommand`** e **zero autenticação na API HTTP** — documentados no
  [00-indice.md](00-indice.md), item transversal aos três relatórios. `getPlayers`
  (usado pelo próprio Gateway/Admin para listar jogadores online) chama `sendCommand`
  internamente, então corrigir a Fase 2-6 acima não elimina esse risco — são problemas
  ortogonais, mas ambos tocam o mesmo arquivo (`servers.service.ts`) e vale corrigir
  juntos na prática, mesmo que planejados separadamente.
- Correção do RBAC do `ServiceAccount` da API e do `chmod 777` do initContainer — ver
  [relatório 03](03-k8s-terraform-validacao-correcao.md).
