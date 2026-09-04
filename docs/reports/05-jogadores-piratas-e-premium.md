# Relatório 05 — Coexistência de jogadores piratas e premium

> Ver [00-indice.md](00-indice.md) para contexto do ambiente. Depende do
> [relatório 02](02-tailscale-roteamento-controle-granular.md) (Gateway como única
> entrada, identidade por Tailscale) — a proteção de nickname proposta aqui só funciona
> com o Gateway já no caminho do tráfego.

## Decisão de produto já tomada

**Suportar os dois** (contas piratas/offline e contas premium/Mojang autenticadas) **no
mesmo servidor, com o nickname reservado por identidade Tailscale** — um jogador só pode
usar, dentro do Minecraft, o nick que está cadastrado para a identidade Tailscale dele no
Prisma. Quem tenta usar o nick de outra pessoa é kickado.

## Estado atual (achado, não é o objetivo final)

`ONLINE_MODE` **não é definido em nenhum lugar do caminho real de provisionamento**
(`dashboard/backend/src/servers/servers.service.ts`, bloco de `env` do
`deploymentManifest`, l.87-118) — só existe no manifest estático órfão
`k8s/mc-vanilla.yaml:27`, que não é usado pela aplicação (ver
[relatório 03](03-k8s-terraform-validacao-correcao.md), Parte D). A imagem
`itzg/minecraft-server` assume `ONLINE_MODE=true` por padrão quando a variável não é
passada. **Resultado prático hoje: todo servidor criado pela dashboard só aceita contas
Mojang autênticas — contas piratas já não conseguem nem completar o login.** Isso
contradiz o objetivo declarado do projeto (o comentário no próprio `mc-vanilla.yaml`,
"Off para permitir testes e controle via Tailscale/Gateway", mostra que a intenção
sempre foi `false`, só nunca foi propagada para o código real).

---

## O que muda ao ligar `ONLINE_MODE=false`

Isto não é só uma flag — muda o modelo de confiança do servidor inteiro. Efeitos diretos:

1. **O Mojang deixa de validar login nenhum** — nem pirata, nem premium. O servidor
   aceita qualquer nome de usuário que o cliente declarar na etapa de Login, sem checar
   posse de conta.
2. **UUIDs deixam de ser os UUIDs reais da Mojang.** Em modo offline, o servidor gera um
   UUID determinístico a partir do hash de `"OfflinePlayer:<username>"`. Isso é
   case-sensitive e depende só do nome digitado — dois clientes diferentes que digitarem
   o mesmo texto de nome recebem o mesmo UUID offline, indistinguíveis para o servidor.
   **É exatamente isso que abre a janela de impersonação** que a decisão de produto
   pede para fechar.
3. **Skins somem para todo mundo, não só para piratas.** Isto é frequentemente mal
   entendido: a textura de skin normal do Minecraft é assinada pela Mojang e enviada
   pelo cliente **apenas durante a etapa de autenticação online** (`hasJoined` da
   Mojang). Em modo offline essa etapa nunca acontece — mesmo um jogador com conta paga
   de verdade aparece com a skin padrão (Steve/Alex) no servidor, a menos que algo
   busque a textura por fora. **A decisão de "preservar a skin dos não-piratas" exige um
   mecanismo adicional, não vem de graça com `ONLINE_MODE=false`.**
4. **Dados existentes ficam órfãos se um mundo já existir com `ONLINE_MODE=true`.**
   Whitelist, `ops.json`, `banned-players.json` e as pastas de `playerdata/` são
   indexadas pelo UUID Mojang real. Ligar `ONLINE_MODE=false` num mundo que já tinha
   jogadores premium conectados troca o UUID de todo mundo — o inventário/progresso
   fica "preso" no UUID antigo. Relevante só para mundos já em produção; servidores
   novos, criados já com a flag certa, não têm esse problema.

---

## Componente 1 — Restaurar skins via SkinsRestorer (para quem tem conta premium)

Solução padrão da comunidade Minecraft para exatamente este cenário (servidor offline
que quer mostrar skins reais): o plugin **SkinsRestorer** busca a textura direto da API
pública da Mojang por nome de usuário, de forma independente do handshake de login, e
injeta a textura assinada no próprio servidor antes de mandar para os outros clientes.
Não depende do jogador estar "autenticado" — só do nome bater com uma conta Mojang real.

**Restrição importante, já visível no código atual**: SkinsRestorer é um plugin — só
roda em servidores com API de plugins (Paper/Spigot/Bukkit), não em Vanilla puro nem
diretamente em Forge sem uma camada de compat. Olhando `createServer`
(`servers.service.ts:87-118`), o `TYPE` enviado à imagem `itzg/minecraft-server` depende
da origem escolhida pelo usuário:

| `dto.source` | `TYPE` enviado hoje | Suporta plugin? |
|---|---|---|
| `'Vanilla'` | `VANILLA` | **Não** — jar puro da Mojang, sem API de plugin |
| `'CurseForge'` | `AUTO_CURSEFORGE` | Depende do modpack (Forge/NeoForge = não; alguns modpacks Bukkit-based = sim) |
| `'Modrinth'` | `MODRINTH` | Depende do modpack, mesma lógica |

**Não force a troca — avise e recomende.** Vanilla puro continua sendo uma opção válida
(alguém pode querer exatamente o jar da Mojang, sem nada por cima). A decisão de usar
Paper ou não é do usuário no momento de criar o servidor; o papel do sistema é deixar a
consequência explícita antes de criar, não decidir por ele.

**Proposta de UX na tela de criação de servidor** (fluxo "Vanilla"):
- Adicionar um campo `serverSoftware: 'vanilla' | 'paper'` ao `CreateServerDto`
  (`dto.source === 'Vanilla'`), com **Paper pré-selecionado como recomendado** — mas o
  usuário pode trocar para Vanilla puro livremente.
- Se o usuário escolher Vanilla puro, mostrar um aviso inline, não um bloqueio:
  *"Servidores Vanilla não suportam plugins — jogadores com conta premium vão aparecer
  sem skin (Steve/Alex padrão) em modo offline. Escolha Paper para preservar skins."*
- `servers.service.ts` mapeia a escolha para o `TYPE` correspondente
  (`serverSoftware === 'paper' ? 'PAPER' : 'VANILLA'`), em vez do `TYPE: 'VANILLA'`
  fixo de hoje.

Para modpacks CurseForge/Modrinth baseados em Forge/NeoForge, o mesmo princípio se
aplica de forma passiva — não há uma "troca" possível ali (o modpack já define seu
próprio server software), então o aviso é só informativo: sinalizar na UI, ao exibir um
modpack Forge/NeoForge, que ele *"não suporta skins premium em modo offline"*, sem
oferecer alternativa nesse caso — a limitação vem do modpack escolhido, não de uma
decisão que o sistema possa tomar por ele.

---

## Componente 2 — Proteção de nickname (o novo trabalho do Gateway)

Hoje o `GatewayService` só inspeciona o **primeiro pacote** da conexão (o Handshake —
`gateway.service.ts:60-113`) e depois faz `clientSocket.pipe(serverSocket)` /
`serverSocket.pipe(clientSocket)` (l.163-164), tornando-se cego a partir daí. O nome de
usuário que o jogador escolhe **não está no Handshake** — vem no pacote seguinte
(`Login Start`, primeiro pacote do estado "Login", contém o username como string, sem
criptografia em modo offline). Para reservar nickname, o Gateway precisa parsear
também esse segundo pacote antes de liberar o pipe cego.

### Desenho da mudança

Em `checkAuthorization` (ou logo depois dela, já com o `user` resolvido pela identidade
Tailscale — reaproveita a resolução dupla de tag/userId da Fase 3 do relatório 02):

1. Se `nextState === 2` (Login, não Status/Ping — pings de servidor não têm login,
   não fazem sentido checar nick neles), **não** liberar o pipe imediatamente após
   autorizar pelo Tailscale. Em vez disso, ler mais um pacote do buffer (reaproveitando
   o padrão já usado para o Handshake: `pause()` → ler → `unshift()` para devolver ao
   stream intacto).
2. Parsear o `Login Start` com `MinecraftProtocol.readString` (já existe, usado para o
   `Server Address` do Handshake) para extrair o `username` declarado.
3. Comparar (case-insensitive) com `user.minecraftNick` do `User` resolvido:
   - **Bate**: libera o pipe normalmente, resto da conexão segue cego como hoje.
   - **Não bate, e o `User` não tem `minecraftNick` cadastrado ainda** (primeira conexão
     de alguém que só forneceu o nome no convite, não no Minecraft): considerar
     **adotar automaticamente** o nome declarado como `minecraftNick` definitivo desse
     `User` (grava no Prisma na primeira conexão) — evita um passo manual de cadastro
     extra, mas "trava" o nick a partir da primeira vez que a pessoa loga.
   - **Não bate, e já existe outro `User` com esse `minecraftNick` cadastrado**: nega,
     manda pacote de disconnect ("Este nickname pertence a outro jogador cadastrado.")
     usando o mesmo `MinecraftProtocol.createDisconnectPacket` já usado para as outras
     negações.
4. Aplicar a mesma regra **independente de qual dos dois caminhos de identidade**
   resolveu o usuário (tag de jogador convidado, ou `tailscaleUserId` do dispositivo
   pessoal do dono) — não deixar o dono "furar" a própria regra sem querer.

Esta é uma extensão de protocolo, não um redesenho — usa exatamente os mesmos utilitários
(`MinecraftProtocol.readVarInt`/`readString`, `pause`/`unshift`) já usados para o
Handshake, só um pacote adiante.

---

## Componente 3 — env vars a adicionar em `createServer`

Resumo do que muda em `servers.service.ts`, bloco de `env` (l.87-118). `ONLINE_MODE`
passa a ser incondicional (é o requisito base de suportar pirata); o resto respeita a
escolha do usuário descrita no Componente 1, sem forçar Paper:

```ts
ONLINE_MODE: 'false',
// só quando o usuário escolheu 'paper' (ou o TYPE final for Paper/Spigot/Bukkit-
// compatível por causa do modpack) — nunca em cima de um Vanilla puro:
...(dto.serverSoftware === 'paper' && {
	MODRINTH_PLUGINS: 'skinsrestorer',
}),
```

E, para o caso `'Vanilla'`, o `TYPE` passa a depender da escolha do usuário em vez de
fixo:
```ts
: dto.source === 'Vanilla'
	? {
			TYPE: dto.serverSoftware === 'paper' ? 'PAPER' : 'VANILLA',
			VERSION: dto.version || 'LATEST',
		}
```
(era `TYPE: 'VANILLA'` fixo). `dto.serverSoftware` é o campo novo do `CreateServerDto`
proposto no Componente 1 — default `'paper'` na UI (recomendado), mas o usuário pode
trocar para `'vanilla'` livremente.

---

## Verificação

1. Criar um servidor Vanilla novo (qualquer `serverSoftware`), confirmar
   `ONLINE_MODE=false` no Deployment gerado e que uma conta pirata consegue completar o
   login (hoje não consegue).
2. Com `serverSoftware: 'paper'` (o padrão recomendado), conectar com uma conta premium
   de teste e confirmar que a skin aparece corretamente (não Steve/Alex padrão) depois
   do SkinsRestorer instalado.
2b. Com `serverSoftware: 'vanilla'` (usuário optou por ignorar a recomendação),
   confirmar que o aviso de "sem suporte a skin" aparece na criação e que o servidor
   sobe normalmente mesmo assim — a escolha do usuário precisa ser respeitada, não
   bloqueada.
3. Tentar conectar digitando o nickname de um `User` já cadastrado, usando uma
   identidade Tailscale diferente da dona daquele nick — confirmar kick com a mensagem
   de nickname ocupado.
4. Primeira conexão de um `User` sem `minecraftNick` prévio — confirmar que o nick
   digitado no cliente é adotado e persiste em conexões futuras.
5. Confirmar que o próprio dono (identidade resolvida por `tailscaleUserId`, não tag)
   também é bloqueado se tentar usar o nick de outro `User` cadastrado.

## Fora de escopo deste relatório

- Migração de mundos **já existentes** que rodavam com `ONLINE_MODE=true` — troca de
  UUID quebra whitelist/permissões/inventário antigos; é uma decisão caso a caso, não
  uma correção de código.
- Suporte a skins customizadas via upload próprio (SkinsRestorer também suporta isso,
  mas é uma feature de produto nova, não parte da correção do bug de identidade).
