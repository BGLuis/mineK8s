# Relatório 06 — Evolução para múltiplos jogos (Terraria e futuros)

> Ver [00-indice.md](00-indice.md) para contexto do ambiente.
> **Escopo deliberadamente limitado**: mapear a arquitetura e propor uma abstração, sem
> cronograma de implementação. Não é o próximo passo do roadmap — os relatórios 01-05
> são pré-requisito de qualquer coisa aqui. Nenhum código deste relatório deve ser
> escrito antes de um segundo jogo estar de fato aprovado para construção.

## Por que isto não é "só trocar a imagem Docker"

Hoje **zero** parte do sistema é genérica por jogo — está tudo desenhado especificamente
para o protocolo e o ecossistema do Minecraft, em quatro camadas independentes. Trocar
só a imagem do container não é suficiente; cada uma das quatro camadas abaixo precisa
de uma versão própria para Terraria (ou qualquer outro jogo).

| Camada | Acoplamento a Minecraft hoje | Arquivo |
|---|---|---|
| Roteamento de rede | Parser binário do handshake Minecraft (VarInt + string), roteamento por domínio/SNI | `gateway/minecraft-protocol.util.ts`, `gateway/gateway.service.ts` |
| Provisionamento | Imagem `itzg/minecraft-server`, env vars (`EULA`, `TYPE`, `CF_SLUG`...), probe via `mc-monitor` | `servers/servers.service.ts:63-173` |
| Console/administração | RCON (`rcon-cli`), parsing de saída do comando `list` do Minecraft | `servers/servers.service.ts:400-448` |
| Marketplace | APIs do Modrinth/CurseForge, conceito de "modpack" | `modpacks/` |

As camadas que **já são razoavelmente genéricas** e não precisam de retrabalho grande:

- **Orquestração Kubernetes em si** — PVC por mundo/save, Deployment com label de
  hibernação, scale-to-zero — são conceitos de infraestrutura, não de jogo.
- **Identidade e ACL** (Tailscale + Prisma `User`/`Group`/`Server`, ver relatórios 02 e
  04) — "qual pessoa pode alcançar qual servidor" é uma pergunta válida para qualquer
  jogo, desde que `Server` ganhe um campo `gameType` para o Gateway saber qual parser
  de protocolo usar.
- **File manager** (`listFiles`/`readFile`/`writeFile`/`deleteFile`) — já opera sobre
  `kubectl exec` genérico, só assume o path `/data` (específico da imagem `itzg`, mas
  fácil de parametrizar).

---

## O obstáculo mais sério: Terraria não tem roteamento por domínio

Este é o ponto que mais muda o desenho, então vai primeiro. O `GatewayService`
(relatório 02) depende de um recurso específico do protocolo Minecraft: o pacote de
Handshake carrega o "Server Address" (o hostname que o jogador digitou), permitindo que
**um único IP:porta público roteie para N servidores diferentes** por nome de domínio —
é o mesmo truque do SNI em HTTPS.

**O protocolo do Terraria não carrega hostname nenhum.** Um cliente Terraria conecta
direto em `IP:porta` e o servidor do outro lado é *o* mundo, sem etapa de roteamento por
nome. Multiplayer com N mundos, na prática (inclusive em redes grandes com TShock),
sempre significa **N portas diferentes expostas**, uma por mundo — não uma porta
compartilhada com roteamento inteligente por cima.

Consequência direta para este projeto: os Services `NodePort` órfãos encontrados no
cluster real (`mc-better-mc-forge-bmc4-svc`, `mc-test-modpack-svc` — ver
[relatório 03](03-k8s-terraform-validacao-correcao.md), Parte F) não são só lixo de
teste esquecido — são evidência de que **esse modelo (porta dedicada por servidor) já
foi tentado neste projeto antes** de pivotar para o roteamento por domínio único que
existe hoje. Para Terraria, esse modelo antigo (não o atual) é o caminho certo — vale
resgatar a ideia, não descartá-la como só "lixo a limpar".

Implicação de produto: cada mundo Terraria precisaria de uma porta própria, alocada de
um pool (`Server` no Prisma ganharia um campo `allocatedPort`), exposta via `NodePort`
ou faixa de `hostPort`. Isso não se encaixa na promessa "um domínio bonito por
servidor" que o Minecraft tem hoje — para Terraria, o convite provavelmente precisa
comunicar `IP:porta`, não um subdomínio.

---

## Abstração proposta (para quando houver um segundo jogo de verdade)

Uma interface `GameProvider`, com uma implementação por jogo, concentrando tudo que hoje
está espalhado e hardcoded para Minecraft em `servers.service.ts`/`gateway.service.ts`:

```ts
interface GameProvider {
	readonly gameType: string;              // 'minecraft' | 'terraria' | ...
	readonly routingModel: 'sni-shared-port' | 'dedicated-port';

	buildContainerSpec(dto: CreateServerDto): {
		image: string;
		env: Record<string, string>;
		ports: number[];
		livenessProbe?: k8s.V1Probe;
		readinessProbe?: k8s.V1Probe;
	};

	// só relevante se routingModel === 'sni-shared-port'
	parseConnectionTarget?(firstPacket: Buffer): { identifier: string } | null;

	getOnlinePlayers(podName: string): Promise<{ name: string }[]>;
	sendCommand(podName: string, command: string): Promise<string>;
}
```

- `MinecraftProvider` — implementação atual, extraída sem mudar comportamento:
  `parseConnectionTarget` vira um wrapper fino sobre `MinecraftProtocol` existente;
  `getOnlinePlayers`/`sendCommand` viram wrappers sobre a lógica RCON já existente
  (depois de corrigida a vulnerabilidade de injeção do
  [00-indice.md](00-indice.md), não antes — não vale a pena abstrair código inseguro).
- `TerrariaProvider` — hipotético, ilustrativo: `routingModel: 'dedicated-port'`,
  `parseConnectionTarget` ausente (o Gateway, para esse tipo, faria só forward de porta
  dedicada, sem inspecionar protocolo), `getOnlinePlayers`/`sendCommand` implementados
  contra a **REST API do TShock** (`http://<pod>:7878/v2/...`, autenticação por token
  bearer) em vez de RCON — TShock é o server-side mod de fato padrão da comunidade para
  administrar servidores Terraria com esse tipo de superfície.

`GatewayService.handleConnection` passaria a despachar por `server.gameType` →
`GameProvider` correspondente, escolhendo entre inspecionar o handshake (Minecraft) ou
só encaminhar a conexão da porta dedicada (Terraria) sem abrir o pacote.

`servers.service.ts` `createServer` passaria a chamar
`gameProviders[dto.gameType].buildContainerSpec(dto)` em vez de montar o manifest
Minecraft inline como faz hoje.

## O que **não** generaliza bem, e não deveria ser forçado

- **Marketplace de mods/modpacks** — Modrinth/CurseForge (Minecraft) e Steam Workshop
  (Terraria/tModLoader) são ecossistemas com APIs, formatos de pacote e modelos de
  licenciamento completamente diferentes. Não tente um marketplace genérico "plugável"
  — trate como uma feature opcional por jogo, ausente quando não fizer sentido (Terraria
  vanilla, por exemplo, não tem conceito de modpack instalável via API).
- **Identidade de skin/nickname** ([relatório 05](05-jogadores-piratas-e-premium.md)) —
  é inteiramente um conceito Mojang/Minecraft. Terraria não tem skin server-side (a
  aparência do personagem vive no arquivo `.plr` local do jogador, o servidor nunca vê
  isso). A proteção de nickname via Gateway proposta no relatório 05 (parsear o pacote
  de Login) não existe como conceito equivalente em Terraria — lá, "quem é quem" seria
  resolvido inteiramente pela camada Tailscale/Prisma (que já é genérica), sem
  contrapartida nenhuma dentro do protocolo do jogo.
- **File manager e explorador de mundo** — o layout de arquivos (`/data/world`,
  `server.properties`) é específico da imagem `itzg`. Um `TerrariaProvider` precisaria
  declarar seu próprio `dataPath`/layout esperado; não force um schema único de arquivos
  entre jogos diferentes.

## Recomendação

Não iniciar esta abstração agora. Ela é especulativa até existir um segundo jogo
concreto para validar contra — construir para "jogos genéricos" sem um segundo caso real
tende a acertar a interface errada. Quando o Terraria (ou outro jogo) for de fato
aprovado para entrar no roadmap, os pontos deste relatório — principalmente a diferença
de modelo de roteamento (porta dedicada vs. domínio compartilhado) e a lista do que não
generaliza — são o ponto de partida para desenhar o corte real da interface
`GameProvider`, com as duas implementações concretas (Minecraft + o novo jogo) guiando o
formato, em vez de adivinhar o formato primeiro.
