# Relatório 04 — Fluxo do jogador: do convite até o mundo

> Ver [00-indice.md](00-indice.md) para contexto do ambiente. Depende do
> [relatório 02](02-tailscale-roteamento-controle-granular.md) (identidade por tag,
> Gateway como única entrada) — os problemas aqui descritos assumem que a Fase 3 daquele
> relatório já foi implementada, e adicionam um refinamento a ela (ver Achado 4 abaixo).

## Decisão de produto já tomada

**Tailscale é obrigatório para todo jogador, sem exceção.** Não existe e não deve existir
caminho de conexão sem VPN — mantém a promessa de "acesso ultra-secreto sem passar pelo
proxy público" já documentada no projeto. Este relatório não propõe alternativa a isso;
foca em consertar e completar o único fluxo que deve existir.

---

## O fluxo hoje, passo a passo, com o que quebra em cada etapa

```
1. Admin abre "Controle de Acesso" → aba Tailscale → preenche nome + escopo → cria convite
2. Backend gera tskey + tags, devolve joinUrl
3. Admin copia/compartilha o link manualmente (WhatsApp, Discord, etc.)
4. Amigo abre o link → vê a página /join
5. Amigo instala o Tailscale (se ainda não tem) → clica "Conectar Automaticamente"
6. App Tailscale abre via deep link, entra na tailnet com a authKey
7. Amigo abre o cliente Minecraft → digita o endereço do servidor → conecta
```

### Achado 1 — o link gerado nunca chega no frontend (bug ativo, não é hipotético)

`dashboard/frontend/src/app/features/access-control/access-control.ts:94-97`:
```ts
this.tailscaleService.createInvite(this.inviteModel).subscribe({
	next: (res) => {
		this.generatedInviteUrl.set(res.inviteUrl);   // <- campo que não existe
```
Mas o backend (`dashboard/backend/src/tailscale/tailscale.service.ts:106-113`, interface
`InviteResult`) devolve o campo `joinUrl`, não `inviteUrl`:
```ts
return { playerName: dto.playerName, authKey, joinUrl, expiresAt, tags, scope: dto.scope };
```
`TailscaleService.createInvite` no frontend (`core/services/tailscale.service.ts:20-22`)
declara o retorno como `Observable<any>` — não há tipagem que pegaria esse erro em
tempo de compilação. **Resultado: hoje, todo convite criado pela UI mostra um link
`undefined` para o admin copiar.** Correção de uma linha: `res.joinUrl` em vez de
`res.inviteUrl` (ou, melhor, tipar `createInvite` com a interface `InviteResult` real do
backend, para o TypeScript pegar a próxima divergência de campo automaticamente).

### Achado 2 — a página de convite nunca diz para onde conectar

`join-server/main.ts`, passo 3 da própria página (`buildJoinPage`, l.200-206):
```html
<strong>Entre no Minecraft</strong>
<span>Adicione o endereço do servidor no seu cliente Minecraft.</span>
```
**Nenhum endereço é mostrado.** `buildJoinPage(_host)` recebe um parâmetro `_host` que
nem é usado no corpo da função (prefixo `_` de "não usado" é intencional no código, mas
sintomático do problema: a função foi escrita sem plano para injetar dado nenhum sobre
qual servidor o convite libera). A `authKey` fica só no hash da URL, e por design
correto de segurança (`join-server/main.ts:234-235`) **nunca é enviada ao servidor** —
então o `join-server` não tem, e não pode ter, acesso ao `scope`/`serverIds` do convite
lendo a URL sozinho. A informação precisa vir por outro caminho.

**Consequência prática**: mesmo depois de instalar o Tailscale e conectar, o convidado
não sabe o que digitar no Minecraft. Hoje isso "funciona" por acidente, porque o
`mc-router` aceita qualquer subdomínio que exista (bypass documentado no relatório 02) e
alguém pode ter passado o endereço por fora (WhatsApp). Depois que o Gateway virar a
única entrada (relatório 02), **o endereço precisa estar certo e ser o que o Prisma
espera em `Server.subdomain`** — não dá mais para "chutar".

Correção proposta — dois pedaços, nenhum deles complexo:

1. **Backend**: `createInvite` já sabe os `serverIds`/`scope` no momento da criação
   (`dto.serverIds`, `dto.scope`). Resolver os subdomínios correspondentes
   (`prisma.server.findMany({ where: { id: { in: dto.serverIds } } })`, ou todos os
   servidores existentes se `scope === 'global'`) e devolver essa lista dentro do
   `InviteResult`:
   ```ts
   servers: { name: string; address: string }[]
   ```
2. **join-server**: como a URL não pode carregar esse dado no hash sem também vazar
   informação sensível para quem inspeciona a barra de endereço, a opção mais simples é
   o `join-server` consultar o NestJS principal (rede interna, `minekube-api-svc:3000`)
   por um endpoint público-mas-opaco tipo `GET /api/tailscale/invite-info?key=<hash-do-authKey>`
   — nunca a `authKey` em si, um hash dela, só para não expor o segredo de conexão numa
   chamada de rede adicional. Alternativa mais simples ainda, se o volume de convites for
   baixo: o admin cola o(s) endereço(s) manualmente na mensagem que envia junto do link
   (aceitável como paliativo, mas frágil — depende do admin lembrar toda vez).

### Achado 3 — nenhuma confirmação de que o convite foi usado

O admin não tem como saber, pela UI, se o amigo já instalou o Tailscale, se a chave foi
usada, ou se algo deu errado. `TailscaleService.listMinecraftDevices()`
(`tailscale.service.ts:119-138`, backend) já lista os dispositivos com tag
`tag:minecraft*` — a aba "Tailscale" do `access-control` já busca isso
(`fetchDevices()`, `access-control.ts:61-66`) e exibe a lista. **O que falta é ligar o
convite emitido ao dispositivo que eventualmente aparece nessa lista**, para o admin ver
"convite para João → dispositivo `joao-iphone` conectado há 3 min" em vez de duas listas
soltas (convites de um lado, dispositivos do outro, sem relação visual). Baixa
prioridade — não bloqueia o fluxo, é polish. Vale mais a pena depois que os achados 1 e
2 estiverem corrigidos.

### Achado 4 — convidar a mesma pessoa duas vezes fragmenta a identidade dela

Este é um refinamento necessário à **Fase 3** do relatório 02, descoberto ao pensar no
fluxo completo (não um bug isolado, uma lacuna de design). A Fase 3 propõe:

> `createInvite` gera uma tag única por jogador e **pré-cria o `User` no Prisma** com
> essa tag.

Isso funciona perfeitamente na primeira vez. Mas se o mesmo humano precisar de um novo
convite depois — perdeu o link, trocou de celular, o admin quer adicioná-lo a um novo
grupo e por engano gera um convite novo em vez de usar o admin de usuários — o fluxo
como descrito cria **um segundo `User` no Prisma, com uma tag nova, sem nenhuma relação
com o primeiro**. Essa pessoa passa a ter duas identidades: `User A` (tag antiga,
pertence ao grupo "Amigos") e `User B` (tag nova, sem grupo nenhum) — do ponto de vista
do Gateway, são dois jogadores diferentes, e o `minecraftNick` cadastrado em `User A`
não protege o nick usado por `User B` (relevante para o relatório 05, proteção de nick).

**Correção**: o formulário de convite (`access-control.html`/`access-control.ts`)
precisa diferenciar dois casos:

- **Jogador novo**: fluxo atual do relatório 02, Fase 3 — cria tag + `User` juntos.
- **Jogador existente** (novo convite/dispositivo para alguém que já tem `User`
  cadastrado): o admin escolhe o `User` existente em vez de digitar um nome novo; o
  backend gera uma tag nova, mas **anexa** essa tag ao `User` já existente em vez de
  criar outro. Isso implica o schema permitir múltiplas tags por usuário (um jogador
  pode ter, por exemplo, celular e notebook, cada um com sua própria tag Tailscale) —
  ou seja, `tailscaleTag` deveria ser uma tabela relacionada (`UserDeviceTag`,
  `1:N` com `User`), não um campo único `String? @unique` como o relatório 02 propôs.
  **Ajuste recomendado ao schema da Fase 3**:
  ```prisma
  model UserDeviceTag {
  	id      String @id @default(uuid())
  	tag     String @unique
  	userId  String
  	user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  	createdAt DateTime @default(now())
  }
  ```
  E o Gateway resolve por `prisma.userDeviceTag.findUnique({ where: { tag: playerTag },
  include: { user: { include: { groups: true } } } })` em vez de buscar direto em
  `User`. Pequena mudança em relação ao relatório 02, vale aplicar antes de implementar
  a Fase 3 para não precisar migrar depois.

---

## Fluxo alvo (depois de todos os achados corrigidos)

```
1. Admin escolhe "jogador novo" ou "jogador existente" no formulário de convite
2. Backend gera tag (+ User novo OU UserDeviceTag anexado a User existente)
3. Backend resolve os servidores cobertos pelo escopo do convite e devolve no InviteResult
4. Frontend mostra o link correto (res.joinUrl) e a lista de servidores liberados
5. Admin compartilha o link (a UI pode já sugerir o texto: "endereço: X, Y")
6. Amigo abre /join → página mostra explicitamente quais servidores ele terá acesso e
   os endereços de cada um (dado que agora chega via invite-info, achado 2)
7. Amigo instala Tailscale, conecta via deep link
8. Amigo abre o cliente Minecraft, digita o endereço mostrado no passo 6
9. Gateway resolve a tag → User (via UserDeviceTag) → autoriza pela interseção de grupos
10. Admin vê, na aba Tailscale, o convite já vinculado ao dispositivo conectado
```

## Verificação

1. Criar um convite pela UI e confirmar que o link exibido é clicável e correto (não
   `undefined`).
2. Abrir a página `/join` num navegador e confirmar que ela mostra pelo menos um
   endereço de servidor, não só a instrução genérica.
3. Convidar a "mesma pessoa" duas vezes (dois convites, um `playerName` idêntico
   escolhido como "jogador existente") e confirmar que só existe um `User` no Prisma
   com duas tags associadas.
4. Ponta a ponta com um dispositivo real: instalar Tailscale, conectar pelo link,
   confirmar que o Minecraft conecta usando exatamente o endereço mostrado na página.
