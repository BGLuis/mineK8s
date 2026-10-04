# Pesquisa de Design da UI — linguagem voxel para o painel e o portal `/join`

| Campo | Valor |
|-------|-------|
| **Status** | 🟡 Parcial — pesquisa, design system e 15 telas no Figma concluídos; validação com usuários e implementação pendentes |
| **Cobertura** | ~0% do frontend (nenhuma linha de SPA existe); 7 de 7 telas da SRS mapeadas para a API |
| **Esforço** | 4–6 dias-dev de design no escopo completo (11 telas + design system); 1,5–2 d no mínimo viável (Design System + Dashboard + Detalhes) |
| **Depende de** | Nada para o design; a implementação depende das lacunas de API da seção 2.6 |
| **Fecha requisito** | Insumo para L-09 / #43 (`docs/srs/06-CONTROL-PLANE-WEB-SPA.md:92`) |
| **Atenção** | ⚠️ Pesquisa **somente de mesa**: as dores de usuário da seção 2.1 são hipóteses não validadas com jogadores reais |

---

## 1. Estado atual — evidências

### O que existe

O backend da SPA é o *control plane* NestJS em `services/control-plane`, não o workspace Rust. A
API REST é toda prefixada por `api/` e protegida por papel `ADMIN`; os dois canais em tempo real
são namespaces Socket.IO.

| Área | Rotas | Onde |
|---|---|---|
| Servidores | CRUD, `start`, `stop`, `update-version`, `domain`, `logs`, `command` | `servers/servers.controller.ts:40,48-131` |
| Arquivos | `files`, `file` (GET/PUT/DELETE), `world/upload` | `servers/servers.controller.ts:147-185` |
| Backups | criar, listar, apagar, restaurar, baixar | `servers/servers.controller.ts:199-246` |
| Internet | `publish` (POST/DELETE) | `servers/servers.controller.ts:268,277` |
| Modpacks | `search`, `versions`, `install` | `modpacks/modpacks.controller.ts:24,91,120` |
| Grupos e kick | `groups`, `users`, `servers`, `smart-kick` | `admin/admin.controller.ts:30-100` |
| Tailscale | `posture-audit`, `invites`, `claim`, `devices`, `devices/gc` | `tailscale/tailscale.controller.ts:43-171` |
| Saúde | `health-bot/overview`, `reports`, `probe`; `reconciler/trigger`, `status` | `probes/health-bot.controller.ts:23-42` + `reconciler/reconciler.controller.ts:16,24` |
| Auth | `bootstrap`, `token`, `me` | `auth/auth.controller.ts:15,27,35` |

Caminhos relativos a `services/control-plane/src/`. Os canais em tempo real:

- `/terminal` — `join_terminal` → `log_history`; `send_command` → `command_output`; difusão de
  `log_delta` por sala (`terminal/terminal.gateway.ts:102,139,147,200,234`).
- `/ws/tasks` — `subscribeToTask` → `taskProgress` (`tasks/tasks.gateway.ts:47,73`).

O domínio que a UI precisa representar visualmente:

```ts
// services/control-plane/src/database/entities/server.entity.ts:16-24
export type ServerState =
  | 'PROVISIONING' | 'STARTING' | 'READY' | 'STOPPING'
  | 'STOPPED' | 'UPDATING' | 'CRASHED' | 'FAILED';
```

`is_maintenance` é uma *flag* separada do estado (`server.entity.ts:72`), e a política de acesso
tem cinco valores, entre eles `INTERNET` (`server.entity.ts:26-30,69`). Backups têm quatro tipos e
quatro status (`database/entities/server-backup.entity.ts:12-24`). O papel do usuário é só
`'ADMIN' | 'PLAYER'` (`database/entities/user.entity.ts:15`).

### O que não existe

Não há **nenhum** frontend no repositório, nem servidor de estáticos para hospedá-lo:

```bash
grep -rln "@angular/core" --include=package.json . | grep -v node_modules
# → 0 resultados
grep -rn "ServeStaticModule\|useStaticAssets" services/control-plane/src
# → 0 resultados
```

### Precedentes no código

- `tailscale/portal/join-portal.template.ts:12` — único HTML do projeto, o portal `/join`, com
  Tailwind via CDN e *script* inline. **Divergir**: o Helmet padrão (`main.ts:32`) aplica CSP que
  bloqueia CDN e *inline script*, e o template interpola `invite.name` e `errorMsg` sem *escape*
  (`join-portal.template.ts:51,59`). O redesenho do `/join` parte do zero no novo estilo.
- Esboços no Figma `Minek8s` (página `0:1`): botões em 6 cores (`9:2152`), inputs (`9:2209`),
  toggle (`9:3817`), 34 ícones pixel (`9:2212`), linha de configuração (`20:1627`), avatares 2D/3D
  com estado online (`19:835`), card de mundo (`20:1271`), card de modpack (`25:2997`), moldura de
  blocos (`3:1096`) e tela de login (`3:3`). **Reutilizar** todos como base; os chanfros já estão
  codificados como *inner shadow* ±4 px + *drop shadow* de 8 px, sem *blur* (lido via
  `get_variable_defs` no nó `9:2152`).
- `docs/srs/06-CONTROL-PLANE-WEB-SPA.md:114-170` — especificação das 7 telas. **Reutilizar** como
  arquitetura de informação; **divergir** onde a SRS e o código discordam (seção 2.6).

### Não-objetivos

- Implementar a SPA em Angular — este trabalho entrega design e pesquisa, não código.
- Desenhar a área do jogador (`PLAYER`): não há rota REST utilizável por esse papel.
- Corrigir as lacunas de API ou os defeitos de segurança listados abaixo.
- Versão clara (*light mode*): o estilo voxel escuro é a identidade; fica para depois.

### ⚠️ Defeitos pré-existentes encontrados no caminho

Nenhum deles é causado por este trabalho, mas todos afetam o que a UI pode prometer:

1. `POST /api/auth/token` emite JWT com o papel do usuário a partir **só** do nick, sem segredo
   (`auth/auth.service.ts:110-128`). A tela de login não pode ser desenhada como "nick + senha"
   enquanto não houver senha no backend.
2. O `AuthGuard` confia no cabeçalho `x-tailscale-user` enviado pelo cliente
   (`auth/auth.guard.ts:49`), em vez de WhoIs pelo IP de origem.
3. `/ws/tasks` aceita qualquer conexão: `handleConnection` só registra *log*
   (`tasks/tasks.gateway.ts:39-41`), e o CORS é `'*'` (`tasks.gateway.ts:29-31`,
   `terminal/terminal.gateway.ts:39`).
4. O nick do `/join` aceita 2–16 caracteres (`tailscale/dto/claim-invite.dto.ts:33-34`), contra a
   regra canônica de 3–16 (C-06).
5. `findOne` devolve `settings` com `rcon_password` ao navegador
   (`servers/servers.service.ts:178-181,111`).

---

## 2. As 7 decisões de design

### 2.1 Linguagem visual: "Ore UI escuro", não "textura do jogo"

O benchmark mostra dois polos. Painéis técnicos (Pterodactyl, Crafty, MCSManager) priorizam
console via WebSocket, gerenciador de arquivos e backups, com visual genérico de *admin* [F5].
Serviços para leigos (Aternos) priorizam um botão de ligar, status visível em todas as páginas,
layout responsivo e lista de jogadores com *kick*/*ban* [F7]. A Ore UI do Bedrock é a referência
oficial de "Minecraft moderno": blocos chapados, chanfro, sem textura; a comunidade elogia a
limpeza e critica a densidade pensada para celular [F8].

| Opção | O que é | Custo | Base | Veredito |
|---|---|---|---|---|
| Texturas do jogo (pedra, madeira, terra) como fundo de painéis | Imitar o *inventory* da Java Edition | Baixo | [F1] | Rejeitada: texturas são *assets* da Mojang [F1] e ruído visual em tabelas |
| Blocos chapados com chanfro de 4 px e sombra dura | Linguagem dos esboços (`9:2152`) e da Ore UI [F8] | Baixo | Esboço `9:2152`, [F8] | **Recomendada** |
| UI genérica (*shadcn*/AdminLTE) com ícones pixel | Só o ícone remete ao jogo | Baixo | [F5] | Rejeitada: perde a identidade pedida |

Padrões adotados do benchmark: **status do servidor visível em toda tela** e **ação primária de
ligar/parar em um clique** (Aternos [F7]); console, arquivos e backups como áreas de primeira classe
(painéis técnicos [F5]); busca de modpacks em cards visuais com capa, autor, versão e *loader*
(launchers [F12], já esboçado em `25:2997`).

**Hipóteses de dor do usuário, não validadas** (fonte nível 5, só pista): o leigo não sabe se o
servidor está ligado ou hibernado; esquece qual link mandar ao amigo; tem medo de restaurar backup
e perder o mundo. Cada uma vira um requisito visual na seção 3: chip de estado, botão "copiar
link" e modal de restauração com backup de segurança explícito.

### 2.2 Tipografia: pixel só onde ajuda, sans onde há dado

Os esboços usam **Minecraftia** (lido no arquivo Figma: tamanhos 12, 14, 20 e 22). A Minecraftia é
gratuita só para uso pessoal; uso comercial e *webfont* exigem licença paga [F4]. Como o projeto é
código aberto e a fonte seria redistribuída no *bundle*, ela fica fora.

| Opção | O que é | Custo | Base | Veredito |
|---|---|---|---|---|
| Minecraftia | Fonte atual dos esboços | Licença comercial | [F4] | Rejeitada: licença restrita |
| Monocraft | Monoespaçada inspirada no jogo, OFL 1.1, v4.2.1 | Zero | [F2] | Rejeitada no Figma: não está disponível no ambiente do plugin; boa candidata para o console no código |
| Pixelify Sans | Pixel OFL do Google Fonts, pesos 400–700 | Zero | [F3] | Rejeitada: a ligadura padrão `fi`/`fl` desenha um "A" ("Perfil" vira "PerAl"), e a API do plugin não desliga ligaduras |
| **Tiny5** (display/botão) + **VT323** (console) + **Inter** (corpo/tabela) | Pixel OFL de traço grosso, a mais próxima da fonte do jogo, + sans legível | Zero | [F13] | **Recomendada** |

⚠️ **Divergência do plano aprovado**: o plano previa Monocraft. A busca
`figma.listAvailableFontsAsync()` no arquivo não retornou Monocraft nem Minecraftia — só Pixelify
Sans, Silkscreen, VT323, Press Start 2P, Tiny5, Jersey, Micro 5, Inter, IBM Plex e Atkinson. A
primeira escolha, Pixelify Sans [F3], foi **descartada** depois de renderizada: a ligadura `fi`
corrompe palavras comuns em português. Tiny5 tem licença OFL e *subsets* `latin` e `latin-ext`
[F13]. Ela foi comparada lado a lado com Silkscreen, Jersey 10, Micro 5, VT323 e Press Start 2P
no próprio arquivo e é a mais parecida com a fonte do jogo. No código, desligar ligaduras com
`font-variant-ligatures: none` vale para qualquer fonte pixel. Para o console, VT323 é
monoespaçada e pixel, mas não tem o glifo `▶`; use `>`.

Regras: pixel em múltiplos do tamanho de desenho e nunca abaixo de 16 px em texto corrido [F9] [F10];
tabelas, *logs* longos e formulários em Inter. A escala usa múltiplos de 8: 12 · 16 · 20 · 24 · 32
· 40 · 48.

### 2.3 Paleta: manter a família, corrigir o contraste

Contraste calculado nesta sessão pela fórmula de luminância relativa da WCAG, com as cores lidas
dos componentes no Figma. O texto dos botões tem 20 px regular, abaixo do limiar de "texto grande"
de 24 px (ou 18,5 px em negrito). Logo, o mínimo é **4,5:1** [F11].

| Par (texto / fundo) | Hoje | Status | Ajuste | Depois |
|---|---|---|---|---|
| branco / Dark `#3E3937` | 11,38 | ✅ | — | — |
| preto / Light `#CEC1C1` | 12,02 | ✅ | — | — |
| branco / Green `#4D8354` | 4,48 | ⚠️ | `#477A4E` | 5,05 |
| branco / Blue `#6585DF` | 3,52 | ❌ | `#4C6CC9` | 4,89 |
| branco / Realms `#D345CF` | 3,80 | ❌ | `#A93AA6` | 5,46 |
| preto / Yellow `#F5CF5D` | 13,97 | ✅ | — | — |
| muted `#9C9C9C` / card `#3E3937` | 4,15 | ❌ | `#B5B0AE` | 5,30 |
| branco / input `#282828` | 14,74 | ✅ | — | — |

Cores novas para estados semânticos: perigo `#A63D2B` (redstone, 6,32 com branco), sucesso em
texto `#7CC383` (7,93 sobre `#1E1E1E`), info em texto `#8FA8F0` (7,17), aviso em texto `#F5CF5D`
(11,09). O chanfro claro `#66615F` sobre `#3E3937` tem só 1,86:1. Isso é aceitável porque o chanfro
é decorativo e a borda funcional continua sendo o contorno escuro, com contraste bem maior que 3:1.

### 2.4 Restrições legais da Mojang

As Minecraft Usage Guidelines definem "marca" como nomes, logos, **fontes, texturas** e outras
características distintivas, e "*assets*" incluindo **capturas de tela** dos jogos [F1]. Para
qualquer uso, elas exigem não sugerir que o produto é oficial, aprovado ou associado à Mojang [F1].
Também proíbem usar qualquer parte da marca ou dos *assets* como logo ou parte de um logo [F1].
Para produtos e serviços, pedem um aviso no formato *"NOT AN OFFICIAL MINECRAFT [PRODUCT]. NOT
APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT"* [F1].

Consequências no design:

- O rodapé do painel e do `/join` leva "Não é um produto oficial do Minecraft. Não aprovado nem
  associado à Mojang ou à Microsoft."
- Os fundos de paisagem nos esboços `3:3` e `13:2451`, se forem capturas do jogo, são *assets*
  [F1]. Proposta: substituí-los por uma cena voxel desenhada com retângulos (céu, colinas em
  degraus, nuvens em bloco).
- Os ícones pixel próprios (`9:2212`) e a moldura de blocos (`3:1096`) não copiam texturas e podem
  ficar.
- O nome "mineKubernetes" e o logo não podem usar letras no estilo do logo do Minecraft [F1].

### 2.5 Arquitetura de informação: 11 telas sobre a API real

| # | Tela | Fonte de dados | Status da API |
|---|---|---|---|
| 1 | Login / bootstrap | `auth/auth.controller.ts:15,27` | 🟡 sem senha (defeito 1) |
| 2 | Dashboard | `GET /api/servers` + `GET /api/tailscale/devices` | 🟡 sem métricas do nó nem jogadores online |
| 3 | Detalhes do servidor | `GET /api/servers/:id`, `start`/`stop`, `domain` | 🟡 sem restart, PATCH de configuração, TPS/JVM |
| 4 | Console e logs | Socket.IO `/terminal` | 🟡 sem separação stdout/RCON |
| 5 | Wizard de criação | `POST /api/servers`, `modpacks/search`, `install`, `/ws/tasks` | 🟡 busca de modpack é catálogo fixo (`modpacks.controller.ts:36-40`); sem PURPUR |
| 6 | Convidados e acesso | `invites`, `devices`, `admin/groups`, `smart-kick` | ✅ |
| 7 | Arquivos | `files`, `file`, `world/upload` | 🟡 sem upload genérico, *mkdir* e *rename* |
| 8 | Backups | `backups` e `restore` | 🟡 sem progresso; tipos divergem da SRS |
| 9 | Publicar na internet (modal) | `POST/DELETE /publish` | ✅ |
| 10 | Saúde do sistema | `health-bot`, `posture-audit`, `reconciler`, `devices/gc` | ✅ (não previsto na SRS) |
| 11 | Portal `/join` | `invites/validate/:token`, `claim` | ✅ |

A navegação é uma *sidebar* fixa com as telas 2–8 e 10. O wizard (5) e a publicação (9) abrem a
partir do Dashboard e dos Detalhes. O `/join` (11) é público, sem *sidebar*.

### 2.6 Lacunas de API: marcar, não esconder

Cada elemento de tela sem endpoint leva a etiqueta **"sem API"** (amarela, tracejada). Assim o
design não vira promessa silenciosa. A prova de ausência dos itens centrais:

```bash
grep -rn "restart\|players\|metrics\|tps" services/control-plane/src/servers/servers.controller.ts
# → 0 resultados
grep -rn "@Patch" services/control-plane/src --include='*.controller.ts'
# → 1 resultado: servers.controller.ts:114  @Patch(':id/domain')  (só domínio)
```

Lacunas: métricas do nó (CPU/RAM/NVMe), TPS e memória da JVM, jogadores online e tempo de sessão,
restart, PATCH de RAM, `sleep_timeout_minutes`, `is_maintenance` e `access_policy`, *push* de
estado por WebSocket, lista de usuários, separação stdout/RCON, alertas de disco 75/85/90 %
(`docs/srs/05-STORAGE-MODPACKS-BACKUPS.md:20-22`) e progresso de backup/restore.

### 2.7 O que não fazer

- Não usar texturas, capturas ou a fonte do jogo (seção 2.4).
- Não depender do `mine.css` [F6]: é AGPL-3.0 e serve só como referência visual.
- Não desenhar pixel font em tabela, *log* longo ou campo de formulário (seção 2.2).
- Não esconder estados intermediários (`STARTING`, `STOPPING`, `UPDATING`): cada um tem chip e
  animação própria, porque o leigo confunde "hibernado" com "quebrado".
- Não desenhar "nick + senha" no login enquanto o backend não tiver senha. O login mostra "entrar
  pela VPN" e, como alternativa, o token de *bootstrap*.

---

## 3. Plano de implementação

| Fase | Conteúdo | Esforço |
|---|---|---|
| **F0** | Este relatório | 0,5 d |
| **F1** | Página "Design System" no Figma: variáveis (primitivas + semânticas), estilos de texto, efeitos de chanfro e componentes novos (chip de estado, barra XP, medidor, *sidebar*, tabs, tabela, modal, toast, slider, *stepper*, painel de console, banner de disco, tag "sem API") | 1,5–2 d |
| **F2** | Telas 2 e 3 (Dashboard e Detalhes) + Dashboard mobile 390 px | 1 d |
| **F3** | Telas 4, 5, 8 e 9 (console, wizard, backups, publicação) | 1–1,5 d |
| **F4** | Telas 1, 6, 7, 10 e 11 (login, acesso, arquivos, saúde, `/join` desktop e mobile) | 1–1,5 d |

Toda tela é montada com instâncias dos componentes da F1 e reaproveita os esboços (`9:2152`,
`9:2209`, `9:2212`, `19:835`, `20:1271`, `25:2997`) em vez de redesenhá-los.

**Mínimo viável:** F1 + F2 ≈ 2,5–3 d. **Escopo completo:** F0–F4 ≈ 5–6,5 d.

A ordem importa: a F1 antes das telas evita retocar cor e chanfro em 11 frames depois.

---

## 4. Armadilhas

| Armadilha | Mitigação |
|---|---|
| Textos existentes em Minecraftia não podem ser editados pelo plugin, porque a fonte não está disponível no ambiente | Não editar os nós de texto dos esboços; componentes novos usam os estilos `display/*`, `button/*` e `label/md` (Tiny5) |
| Chanfro por *inner shadow* de ±4 px cobre bordas `INSIDE` de mesma espessura (a borda dourada de "selecionado" sumia) | Estados com borda de destaque (Selected, NavItem Active) não usam `bevel/*`: apenas *drop shadow* |
| Ícones dos esboços não escalavam (filhos com *constraints* fixas) e distorciam ao trocar ícone dentro de botões | *Constraints* dos vetores dos 34 ícones passadas para `SCALE` — aparência original inalterada |
| Propriedade TEXT no nível do *component set* sobrescreve o texto próprio de cada variante | Variantes com texto fixo (cabeçalho de tabela, passo concluído `✓`) ficam sem vínculo à propriedade |
| Pixel font borra em tamanhos fracionários [F10] | Escala só em múltiplos de 4 e *line-height* inteiro |
| Botão Green fica a 0,02 do AA e parece "ok" a olho nu | Usar o token corrigido `#477A4E` e nunca o hex antigo |
| Chips de estado diferenciados só por cor | Cada estado tem ícone + texto, além da cor |
| Densidade da Ore UI pensada para celular [F8] | Desktop com tabela densa em Inter; blocos grandes só em ações primárias |

---

## 5. Verificação

Automatizável em CI/host: **quase nada** — esta seção é essencialmente visual.

**Script local (contraste):**
- [ ] Todo par texto/fundo dos tokens semânticos ≥ 4,5:1 e todo ícone/borda funcional ≥ 3:1
      [F11]. Falha se alguém trocar um token por uma cor antiga dos esboços.

**No Figma (`get_screenshot` por frame):**
- [ ] Nenhum texto cortado ou sobreposto nas 11 telas e nas 2 versões mobile.
- [ ] Todo campo exibido aponta para um campo de DTO da seção 1 ou leva a tag "sem API".
- [ ] Rodapé com o aviso de não afiliação presente no painel e no `/join` [F1].

**Só com usuários reais (não verificado):**
- [ ] As hipóteses da seção 2.1 se confirmam em 3–5 conversas com jogadores.

---

## 6. Riscos

1. **As lacunas de API são maiores que o design.** Dashboard e Detalhes dependem de métricas que
   não existem. Sem elas, as duas telas principais nascem com metade dos blocos marcados "sem API".
2. **Pesquisa sem usuário real.** As prioridades da seção 2.1 vêm de fóruns e benchmark. Se o
   público for só o próprio autor, a densidade técnica pode subir; se for amigos leigos, ela deve
   descer.
3. **Fonte pixel diferente da imaginada.** Tiny5 é mais condensada que a fonte do jogo.
   Se não agradar, Silkscreen e Tiny5 são as alternativas OFL disponíveis no Figma.

---

## 7. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `docs/reports/PESQUISA-DESIGN-UI.md` | **novo** — este relatório |
| Figma `Minek8s` — página "Design System" (`99:1601`) | **nova** — 3 coleções (32 primitivas, 32 cores semânticas, 9 espaçamentos), 10 estilos de efeito, 13 de texto e 22 componentes (F1) |
| Figma `Minek8s` — página "Telas" (`99:1602`) | **nova** — 13 telas desktop (incluindo 05b, 08b e 09) + 2 mobile (F2–F4) |
| Figma `Minek8s` — página `0:1` | **quase intocada** — só as *constraints* dos ícones (`9:2212`) mudaram para `SCALE`; texto, cor e forma preservados |

---

## 8. Fontes consultadas

| # | Fonte | Tipo | Versão | Consultada em | Sustenta |
|---|---|---|---|---|---|
| F1 | [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines) | Doc oficial | página vigente | 2026-10-02 | Decisão 2.4; texturas 2.1 |
| F2 | [IdreesInc/Monocraft](https://github.com/IdreesInc/Monocraft) | Projeto de terceiros | v4.2.1 (2025-12-06), OFL 1.1 | 2026-10-02 | Decisão 2.2 |
| F3 | [google/fonts — `ofl/pixelifysans/METADATA.pb`](https://github.com/google/fonts/tree/main/ofl/pixelifysans) | Doc oficial | commit `39df74a` | 2026-10-02 | Decisão 2.2 |
| F4 | [Minecraftia — Andrew Tyler (Gumroad)](https://andrewtyler.gumroad.com/l/minecraftia) | Artigo | — | 2026-10-02 | Decisão 2.2 (licença) |
| F5 | [Pterodactyl vs Crafty vs MCSManager 2026 — mineguard.pro](https://mineguard.pro/en/blog/pterodactyl-vs-crafty-vs-mcsmanager-2026) | Artigo | 2026 | 2026-10-02 | Decisão 2.1 |
| F6 | [mine.css — zff.dev](https://zff.dev/anarchythorn/minecss) | Projeto de terceiros | AGPL-3.0 | 2026-10-02 | Referência visual, não dependência (2.7) |
| F7 | [Aternos — "New panel: fresh design and new features"](https://board.aternos.org/thread/13119-new-panel-fresh-design-and-new-features/) | Artigo | — | 2026-10-02 | Decisão 2.1 |
| F8 | [Minecraft Feedback — Ore UI Improvement Ideas](https://feedback.minecraft.net/hc/en-us/community/posts/46437299776141-Ore-UI-Improvement-Ideas) | Artigo | — | 2026-10-02 | Decisão 2.1; armadilha de densidade |
| F9 | [Lapa Ninja — Pixel Fonts](https://www.lapa.ninja/typeface/pixel-fonts/) | Artigo | — | 2026-10-02 | Contexto de pixel fonts para web |
| F10 | [Lapa Ninja — Pixel Fonts Collection](https://www.lapa.ninja/collection/pixel-fonts) | Artigo | — | 2026-10-02 | Regra de tamanho em múltiplos (2.2, armadilha) |
| F11 | [WCAG 2.2 — Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Doc oficial | WCAG 2.2 | 2026-10-02 | Decisão 2.3; verificação |
| F12 | [Modrinth App vs Prism Launcher 2026 — space-node](https://space-node.net/blog/modrinth-app-vs-prism-launcher-2026) | Artigo | 2026 | 2026-10-02 | Cards de modpack (2.1) |
| F13 | [google/fonts — `ofl/tiny5/METADATA.pb`](https://github.com/google/fonts/tree/main/ofl/tiny5) | Doc oficial | commit `1d6e16f` | 2026-10-02 | Decisão 2.2 |

Algumas fontes não puderam ser lidas na íntegra. Sobre F7, a página retornou HTTP 403. F4, F8, F9,
F10 e F12 só foram vistas pelo resumo do buscador. As afirmações que vêm delas valem como pista
(nível 5), não como base. A recomendação de licença (F4) deve ser conferida no EULA antes de
qualquer uso da Minecraftia.

---

> Nenhum item deste relatório foi validado com usuários reais nem implementado em código. A análise
> vem da leitura do branch `main` (commit `4300839`), do arquivo Figma `Minek8s` e de pesquisa de
> mesa. Contraste foi calculado; as telas e as hipóteses de usuário estão listadas na seção 5 como
> pendentes.
