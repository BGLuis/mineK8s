# Relatório 07 — Consistência das APIs externas (Modrinth, CurseForge, Tailscale)

> Ver [00-indice.md](00-indice.md) para contexto do ambiente. Este relatório não repete
> o que já foi coberto em profundidade nos relatórios 02 (Tailscale) e 05
> (Mojang/SkinsRestorer) — cruza com eles só onde há uma inconsistência nova.

## Veredito em uma frase

A integração com Modrinth funciona e é razoavelmente fiel à API real; a integração com
CurseForge funciona mas depende de uma chave pública de terceiro duplicada e ignorada
pela própria configuração do projeto em metade dos lugares que a usam; e o "formato
universal" que tenta unificar os dois catálogos mistura campos com semânticas
diferentes sob o mesmo nome, o que já causa dado errado mostrado na UI hoje — não é
risco teórico, é observável na tela.

Mapa completo de toda chamada de rede a serviço externo no backend, para referência:

| API | Onde | Uso |
|---|---|---|
| Modrinth `v2` | `modpacks.service.ts:29,130` | busca de modpacks, versões |
| CurseForge `v1` | `modpacks.service.ts:43,142` | busca de modpacks, versões |
| Tailscale `v2` | `tailscale.service.ts:26` | convites, ACL, identidade de dispositivo — coberto no relatório 02 |
| Minotar | `servers.service.ts:481` | avatar do jogador por nickname — hotlink de imagem, sem lógica, sem achado aqui |

---

## Achado 1 — a chave do CurseForge está duplicada, e um dos dois lugares ignora a configuração

`servers.service.ts:99-101` (dentro de `createServer`) usa a chave via configuração, com
fallback:
```ts
CF_API_KEY: this.appConfig.cfApiKey || '$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC',
```

`modpacks.service.ts:8-9` **não usa `AppConfigService` em lugar nenhum** — tem seu
próprio campo privado, sempre fixo, com a mesma string:
```ts
private curseforgeApiKey = '$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC';
```

O schema já tem `CF_API_KEY` como variável de ambiente opcional
(`app-config.schema.ts:11`, `Joi.string().optional().allow('')`) — ou seja, o projeto
já foi desenhado para permitir configurar uma chave própria. **Na prática, isso só
funciona para o provisionamento de servidor (`servers.service.ts`). Para busca e
listagem de versões de modpacks (`modpacks.service.ts`), configurar `CF_API_KEY` no
`.env` não tem efeito nenhum** — o módulo de marketplace sempre usa a chave hardcoded,
silenciosamente, sem avisar o admin que a variável que ele configurou está sendo
ignorada.

Nota sobre a chave em si, para calibrar a severidade: o comentário no código
(`modpacks.service.ts:7`) diz que ela foi *"encontrada no código fonte do
PrismLauncher"* — é a chave pública que o PrismLauncher (launcher de Minecraft
open-source popular) expõe deliberadamente no próprio repositório, como contorno
conhecido da comunidade para as regras de aprovação de app da CurseForge. Não é um
segredo vazado por acidente — é compartilhada de propósito por um projeto terceiro. Mas
isso não torna a duplicação/inconsistência aceitável:

- **Está sujeita a limite de taxa e revogação fora do controle do projeto.** É usada
  por qualquer instalação do PrismLauncher no mundo inteiro, além de qualquer outro
  projeto que tenha copiado a mesma chave — nada garante que continue funcionando.
  Se a CurseForge revogar ou limitar essa chave especificamente, **todo o catálogo
  CurseForge do marketplace para de funcionar de uma vez**, sem relação com nada que o
  projeto tenha feito.
- **Nenhum tratamento diferenciado para esse cenário existe hoje** (Achado 3, abaixo).

**Correção**: centralizar em `AppConfigService` — `modpacks.service.ts` deve injetar
`AppConfigService` e usar `this.appConfig.cfApiKey || <mesmo fallback>`, exatamente como
`servers.service.ts` já faz, eliminando a segunda cópia da string. Trivial de aplicar,
maior valor é remover a divergência de comportamento entre os dois módulos.

---

## Achado 2 — o "formato universal" mistura campos com semânticas diferentes

`searchModpacks` (`modpacks.service.ts:65-106`) mapeia Modrinth e CurseForge para um
formato comum, mas o campo `versions` **não significa a mesma coisa** nos dois lados,
apesar de ter o mesmo nome, o mesmo tipo (`string[]`) e ser tratado de forma idêntica
pelo consumidor:

- **Modrinth**: `hit.versions` — na API real de busca do Modrinth, este campo é a lista
  de **versões do jogo suportadas** pelo projeto (ex.: `["1.20.1", "1.19.2"]`), não uma
  lista das releases do modpack em si.
- **CurseForge**: calculado a partir de `mod.latestFilesIndexes.map(f => f.gameVersion)`
  — também versões do **jogo**, não do modpack, e além disso `latestFilesIndexes` só
  cobre os arquivos mais recentes, não o histórico completo.

Nos dois casos, portanto, `versions` é "quais versões do Minecraft este modpack roda",
não "quais releases deste modpack existem" — o que é internamente consistente entre os
dois provedores, mas **colide de nome com o conceito real de "versões"** usado no
endpoint separado `getModpackVersions` (`modpacks.service.ts:125-168`, exposto como
`GET /api/modpacks/:id/versions`), que retorna releases de verdade (`{ id, name, date }`
— arquivos/versões publicadas do modpack). Mesma palavra, dois conceitos diferentes, dois
lugares diferentes do mesmo módulo.

**Efeito observável na UI hoje**: `modpack-gallery.ts:118`
(`mapToModpackInfo`, frontend):
```ts
version: pack.versions && pack.versions.length ? pack.versions[0] : 'Unknown',
```
Pega o **primeiro** item do array de versões do jogo suportadas — sem ordenação
garantida por nenhuma das duas APIs — e mostra isso como "a versão" do modpack no card.
Na prática, o card pode mostrar `1.16.5` para um modpack que na verdade já suporta até
`1.21`, dependendo da ordem arbitrária em que a API devolveu o array. Não é uma
hipótese — é o comportamento garantido do código como está escrito hoje.

**Correção**: no backend, renomear o campo do "formato universal" para algo que reflita
a semântica real (`supportedGameVersions`, não `versions`), e no frontend, ordenar antes
de pegar o primeiro elemento (versões de Minecraft seguem semver-like, dá para ordenar
corretamente) ou, melhor, buscar explicitamente a versão mais recente via
`getModpackVersions` quando o card for exibido — mais uma chamada de API, mas dado
correto em vez de arbitrário.

---

## Achado 3 — nenhuma distinção entre "sem resultado" e "API externa falhou"

`searchModpacks` engole erro por provedor silenciosamente:
```ts
.catch((_e) => ({ data: { hits: [] } }))       // Modrinth
.catch((_e) => ({ data: { data: [] } }))       // CurseForge
```
Não há log, não há métrica, não há sinalização nenhuma para quem opera o sistema.
Resultado: se a chave pública do CurseForge (Achado 1) for revogada amanhã, a busca
continua "funcionando" — só que **CurseForge nunca mais aparece em nenhuma busca, para
sempre, silenciosamente**, indistinguível de "não existe modpack CurseForge com esse
nome" do ponto de vista de quem usa a dashboard. Ninguém vai investigar um catálogo que
simplesmente nunca traz resultado — o sintoma não parece um bug.

`getModpackVersions`, ao contrário, propaga o erro como 500 genérico
(`modpacks.service.ts:158-167`) com log via `console.error` (não usa o `Logger` do Nest
usado em todo o resto do módulo `servers` — inconsistência de estilo menor, mas real:
grep por `Logger` neste arquivo retorna zero ocorrências, é o único serviço do backend
que usa `console.error` cru).

**Correção**: diferenciar, no mínimo por log estruturado (`this.logger.warn` com o
status HTTP da resposta de erro, não só a mensagem), entre "provedor externo respondeu
com erro" (4xx/5xx — vale alertar) e "sem resultados para esta busca" (200 com lista
vazia — normal). Isso não muda o que o usuário final vê (a resiliência de devolver
parcial é a escolha certa), só dá visibilidade operacional de que algo está errado antes
que um usuário reporte "CurseForge não acha nada nunca".

---

## Achado 4 — `source` é tratado com rigor diferente em dois métodos do mesmo serviço

`searchModpacks` (`modpacks.service.ts:24`): `const filterSource = source?.toLowerCase();`
— aceita `curseforge`, `CurseForge`, `CURSEFORGE`, tanto faz.

`getModpackVersions` (`modpacks.service.ts:127,139`): `if (source === 'Modrinth') ... else
if (source === 'CurseForge')` — **comparação exata, sensível a maiúsculas**. Qualquer
outra grafia cai no `return []` final (l.157), sem erro nenhum — silenciosamente vazio,
mesmo problema de visibilidade do Achado 3.

**Não é um bug ativo hoje** porque o único consumidor real (`modpack-gallery.ts:57`)
sempre reenvia o `pack.source` exatamente como o backend devolveu na busca (que é sempre
`'Modrinth'`/`'CurseForge'`, literal PascalCase — `modpacks.service.ts:78,104`), então a
grafia bate por construção. Mas é uma armadilha para qualquer chamada direta à API
(curl, Postman, um cliente futuro) que reutilize a mesma convenção lenient de
`/search` — `GET /api/modpacks/:id/versions?source=curseforge` (minúsculo, do jeito que
`/search?source=curseforge` aceita) devolve `[]` silenciosamente em vez do que o
usuário esperaria.

**Correção**: aplicar `.toLowerCase()` (ou um enum/pipe de validação do Nest) nos dois
métodos, do mesmo jeito.

---

## Achado 5 — o loader do modpack é adivinhado, não lido da API

`modpack-gallery.ts:119`:
```ts
loader: pack.categories && pack.categories.includes('Fabric') ? 'Fabric' : 'Forge'
```
Trata "loader" como binário: Fabric ou Forge, sem terceira opção. Isso é
demonstravelmente incompleto — o próprio componente que recebe esse valor
(`modpack-card.component.ts:30`) usa **NeoForge** como exemplo no dado padrão/mockado do
`input()`, ou seja, o autor do componente sabia que NeoForge existe e é comum, mas o
código que popula o valor de verdade nunca poderia produzir esse resultado. Faltam
também **Quilt** (cada vez mais comum) e o caso de modpacks Bukkit/Paper-based
(existem em ambas as plataformas, sem "loader" no sentido de mod loader).

Tanto Modrinth quanto CurseForge carregam essa informação de forma mais confiável do
que adivinhar por uma palavra em `categories`: o Modrinth tem categorias dedicadas de
loader (`fabric`, `forge`, `quilt`, `neoforge` aparecem como valores de categoria
próprios, não miscelânea) e o CurseForge expõe `modLoader`/`modLoaderId — via
`latestFilesIndexes[].modLoader` — dentro do próprio objeto que o backend já recebe e
hoje descarta ao montar `versions` (só extrai `gameVersion`, ignora o loader que está
ao lado). **O dado certo já está disponível na resposta que o backend já busca — só não
é repassado para o formato universal.**

**Correção**: o backend passa a extrair e expor um campo `loader` de verdade no formato
universal (de `mod.latestFilesIndexes[].modLoader` no CurseForge, mapeando o enum
numérico do CurseForge para nome — 1=Forge, 4=Fabric, 5=Quilt, 6=NeoForge, conforme a
enumeração pública `ModLoaderType` da CurseForge API; e da categoria de loader já
presente em `hit.categories` no Modrinth, sem precisar adivinhar). O frontend deixa de
adivinhar e só exibe o que veio.

---

## Achado 6 — `updatedAt` sempre mostra "agora"

`modpack-gallery.ts:117`: `updatedAt: new Date()` — hardcoded na chamada, não vem do
`pack` em lugar nenhum. Isso acontece porque o backend nunca extrai nem `date_modified`
(Modrinth, presente nos resultados de busca) nem `dateModified`/`dateReleased`
(CurseForge, presente no objeto do mod) para o formato universal — o campo não existe
para o frontend usar, então o card mente ("atualizado agora") para todo modpack, sempre.

**Correção**: adicionar `updatedAt` ao mapeamento de `searchModpacks` nos dois ramos
(`hit.date_modified` / `mod.dateModified`), remover o `new Date()` hardcoded do
frontend.

---

## Achado 7 — cobertura de teste real: só o caminho feliz do Modrinth

`modpacks.service.spec.ts` (54 linhas, único teste de lógica de negócio real do
backend, conforme [relatório 01](01-testes-e-validacoes.md)) usa
`mockReturnValueOnce` — só a **primeira** chamada a `httpService.get` recebe a resposta
mockada (a busca do Modrinth, que dispara primeiro no código). A segunda chamada
(CurseForge, disparada em paralelo antes do `Promise.all`) recebe `undefined` do mock
genérico `get: jest.fn()`, cai no `.catch()` de resiliência do Achado 3, e o teste passa
mesmo assim — **mas isso significa que o mapeamento de resposta do CurseForge nunca é
exercitado por nenhum teste**, nem o caminho feliz nem o de erro. `getModpackVersions`
(as duas ramificações, Modrinth e CurseForge) também não tem nenhum teste.

**Correção**: mockar as duas chamadas (`mockReturnValueOnce` encadeado ou verificação
por URL) para cobrir o mapeamento CurseForge de verdade, e adicionar testes para
`getModpackVersions` nos dois provedores — ver
[relatório 01, Parte C](01-testes-e-validacoes.md#parte-c--onde-a-cobertura-real-está-faltando-por-ordem-de-risco)
para o padrão geral de priorização de cobertura.

---

## O que está correto e não precisa de correção

Para não parecer que tudo está quebrado — não está:

- **IDs usados corretamente para reprovisionamento**: CurseForge usa o `id` numérico do
  arquivo (`f.id`) como identificador de versão, que é exatamente o que
  `servers.service.ts` espera em `CF_FILE_ID`. Modrinth usa `project_id`
  (identificador real do projeto) para buscar versões, e o endpoint de versões usa a
  URL correta (`/v2/project/{id}/version`). Sem bug aqui.
- **Parâmetros de busca do CurseForge conferem com a API real**: `gameId: 432`
  (Minecraft) e `classId: 4471` (categoria Modpacks) são as constantes públicas e
  documentadas da CurseForge API — corretos.
- **Sintaxe de facets do Modrinth** (`facets: '[["project_type:modpack"]]'`) está no
  formato esperado pela API v2 real (array de arrays serializado em JSON) — correto.
- **Resiliência a falha parcial** (uma API cair não derruba a busca inteira) é a decisão
  de design certa — só falta visibilidade de quando isso acontece (Achado 3), a decisão
  em si não muda.

## Fora de escopo deste relatório

- **Chave hardcoded como problema de segurança** (não só de consistência) — já
  documentado no [00-indice.md](00-indice.md) e no relatório 01. Aqui o foco foi a
  duplicação/inconsistência de uso, não o fato de estar no código-fonte.
- **API do Tailscale** — tratada em profundidade no
  [relatório 02](02-tailscale-roteamento-controle-granular.md) (identidade, ACL,
  grants). Não repetido aqui.
- **API/textura da Mojang para skins** — tratada no
  [relatório 05](05-jogadores-piratas-e-premium.md) (SkinsRestorer, `ONLINE_MODE`).

## Verificação

1. Configurar `CF_API_KEY` no `.env` com uma chave própria (ou uma string qualquer de
   teste) e confirmar, via log/interceptação de requisição, que **tanto**
   `POST /api/servers/create` **quanto** `GET /api/modpacks/search?source=CurseForge`
   passam a usar essa chave, não mais só o primeiro.
2. Buscar um modpack conhecido por rodar NeoForge (existem vários populares) e confirmar
   que o card mostra "NeoForge", não "Forge".
3. Buscar um modpack e confirmar que a "versão" mostrada no card é a mais recente
   suportada, não um item arbitrário do array.
4. Chamar `GET /api/modpacks/:id/versions?source=curseforge` (minúsculo) diretamente e
   confirmar que devolve os dados esperados, não uma lista vazia silenciosa.
5. `npm test` cobrindo o mapeamento de resposta do CurseForge em `searchModpacks` e os
   dois provedores de `getModpackVersions`.
