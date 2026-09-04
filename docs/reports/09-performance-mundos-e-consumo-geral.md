# Relatório 09 — Performance dos mundos e consumo geral da orquestração

> Ver [00-indice.md](00-indice.md) para contexto do ambiente. Cruza com o
> [relatório 03](03-k8s-terraform-validacao-correcao.md) (recursos K8s), o
> [relatório 05](05-jogadores-piratas-e-premium.md) (Paper vs Vanilla) e o
> [relatório 08](08-performance-migracao-loadbalancer-go.md) (custo do RCON via
> `child_process.exec`) — não repete o que já está lá, só referencia.

## Duas perguntas, duas respostas

**"Dá pra melhorar a performance dos mundos?"** — Sim, e a maior alavanca (distância de
visão/simulação) nem está configurável hoje, o que é incomum: é a primeira coisa que
qualquer administrador de servidor Minecraft ajusta.

**"Dá pra fazer a orquestração consumir menos no total do dia?"** — Sim, e o achado
principal não é sutil: o polling do console do frontend, multiplicado pelo custo real do
RCON (relatório 08, achado 1), gera **milhares de processos `kubectl exec` por dia só de
uma aba do navegador aberta** — isso é o maior item de consumo evitável de todo o
sistema, maior que qualquer coisa relacionada à linguagem do Gateway.

---

## Parte A — Performance dos mundos de Minecraft

### A1. `VIEW_DISTANCE`/`SIMULATION_DISTANCE` nunca são configurados

`createServer` (`servers.service.ts:87-118`) define `EULA`, `MEMORY`, `JVM_XX_OPTS` e as
variáveis específicas de `TYPE` — **nunca** `VIEW_DISTANCE` nem `SIMULATION_DISTANCE`,
duas variáveis que a própria imagem `itzg/minecraft-server` já suporta nativamente
(escreve direto no `server.properties` gerado). Sem elas, o servidor sobe com o padrão
do Paper/Vanilla (historicamente `view-distance: 10`), que é conhecidamente pesado —
cada nível de distância de visão aumenta o número de chunks carregados/simulados de
forma aproximadamente quadrática. Esta costuma ser a alavanca de maior impacto isolado
em CPU/memória de qualquer servidor Minecraft, maior que quase qualquer ajuste de JVM.

**Correção**: adicionar `viewDistance`/`simulationDistance` (opcionais) ao
`CreateServerDto`, com default conservador (ex.: `8`/`6`) em vez de herdar o padrão do
jogo, e repassar como env vars:
```ts
VIEW_DISTANCE: String(dto.viewDistance ?? 8),
SIMULATION_DISTANCE: String(dto.simulationDistance ?? 6),
```
Idealmente exposto como campo ajustável na tela de criação de servidor, não só um
default silencioso — o valor certo depende do hardware disponível e de quantos
servidores rodam simultaneamente no mesmo nó.

### A2. As flags de JVM hardcoded parecem ser uma cópia incompleta das "Aikar's Flags"

`servers.service.ts:91` tem uma string longa de flags G1GC que corresponde, quase
inteiramente, ao conjunto de flags de tuning de GC popularizado pela comunidade
Minecraft (conhecido como "Aikar's Flags", referência amplamente publicada e usada por
praticamente todo host de Minecraft sério). Comparando com a lista canônica, **falta
`-XX:+AlwaysPreTouch`** — a flag que faz o JVM reservar/tocar todas as páginas de heap
na inicialização, em vez de sob demanda durante o jogo. Sem ela, picos de latência
podem ocorrer durante o jogo (quando o SO precisa alocar página nova) em vez de só uma
vez, na subida do servidor (quando ninguém está jogando ainda).

**Risco adicional de manter a string hardcoded**: é uma cópia estática, congelada no
tempo em que foi escrita — não recebe atualização se a comunidade revisar a recomendação
(já aconteceu antes). A própria imagem `itzg/minecraft-server` mantém a variável
`USE_AIKAR_FLAGS=true`, aplicando o conjunto correto e atualizado automaticamente pelos
mantenedores da imagem, sem o projeto precisar rastrear mudanças manualmente.

**Correção recomendada**: trocar `JVM_XX_OPTS` fixo por `USE_AIKAR_FLAGS: 'true'` — uma
env var em vez de uma string de ~15 flags mantida à mão. Se houver motivo específico
para manter controle manual das flags (ex.: um modpack que precisa de uma flag
diferente), pelo menos adicionar `-XX:+AlwaysPreTouch` à string atual.

### A3. Paper em vez de Vanilla também é uma vitória de performance, não só de skins

O [relatório 05](05-jogadores-piratas-e-premium.md) já recomenda Paper como opção
padrão (não obrigatória) pelo motivo de preservar skins via SkinsRestorer. Vale reforçar
aqui o motivo adicional, independente: Paper reescreve partes centrais do motor do jogo
(carregamento assíncrono de chunks, otimizações de IA/pathfinding de mobs, redução de
trabalho em ticks de entidade) especificamente para rodar mais rápido que o Vanilla com
o mesmo hardware, mantendo a jogabilidade idêntica. Os dois relatórios (05 e este) apontam
para a mesma mudança de configuração por motivos diferentes — reforça a recomendação, não
a duplica.

### A4. Os arquivos `paper-world-defaults.yml`/`paper-global.yml` do repositório não afetam nenhum servidor real

Achado de verificação, não de tuning: `create-minecraft-server/config/paper-*.yml`
existem no repositório com os valores **padrão de fábrica** do Paper (gerados
automaticamente na primeira subida, sem nenhuma customização visível). Confirmado por
busca (`grep -n "create-minecraft-server\|ConfigMap" servers.service.ts`, zero
resultados): **nenhum servidor criado pela dashboard monta ou referencia esses
arquivos** — eles pertencem à imagem Docker customizada e vestigial
(`local/minecraft-server:latest`) usada só pelo caminho Terraform morto (ver
[relatório 03](03-k8s-terraform-validacao-correcao.md), Parte A). Servidores reais usam
`itzg/minecraft-server` puro, que gera seus próprios arquivos de configuração dentro do
volume `/data` de cada servidor, a partir do zero.

**Implicação prática**: qualquer esforço de tuning fino nesses YAMLs específicos
(anti-xray, taxas de carregamento de chunk, etc.) seria desperdiçado — não afeta nenhum
mundo em produção. Ajustes de performance devem passar pelas env vars do
`itzg/minecraft-server` (que a imagem aceita e usa para sobrescrever `server.properties`
e os YAMLs do Paper dentro do volume real do servidor), não pelos arquivos deste
diretório do repositório.

### A5. Memória: fórmula correta, não mexer

Só para deixar registrado o que **não** precisa de correção: `resources.limits.memory`
(`${mem+1}Gi`) e `resources.requests.memory` (`${mem}Gi`) em `servers.service.ts:119-126`
já seguem a prática recomendada — a margem de 1G extra no limite acima do `Xmx`
efetivo cobre memória off-heap/metaspace/buffers diretos da JVM, que não é contabilizada
no heap gerenciado. Não altere isso.

### A6. CPU sem `requests`/`limits` nos pods de Minecraft — nuance do cluster single-node

Já apontado no [relatório 03](03-k8s-terraform-validacao-correcao.md), Parte D. Vale uma
nuance específica de consumo/QoS para este relatório: como o cluster é **single-node**
(confirmado — só o nó `luisarch`), um `requests.cpu` **não influencia o agendamento** (não
há outro nó para o scheduler escolher) — o ganho real de definir `requests.cpu` aqui é de
**classe de QoS** (`Burstable` em vez do `BestEffort` atual quando só memória tem
request), o que muda a ordem de prioridade de eviction sob pressão de recursos: pods
`BestEffort` são os primeiros candidatos a serem mortos pelo kubelet quando o nó fica sem
memória/CPU. Vale definir um `requests.cpu` modesto (não um `limits.cpu`, que causaria
throttling e piora pausas de GC) só por esse motivo — não para melhorar agendamento, que
neste cluster não existe como problema.

---

## Parte B — Consumo geral da orquestração

### B1. O maior item de consumo evitável do sistema: polling do console × custo do RCON

`server-console.ts` (frontend), enquanto a aba do console estiver aberta:
```ts
this.logTimer = setInterval(() => this.fetchLogs(), 3000);      // a cada 3s
this.playerTimer = setInterval(() => this.fetchPlayers(), 10000); // a cada 10s
```

`fetchPlayers()` chama `GET /api/servers/:id/players` → `ServersService.getPlayers`
(`servers.service.ts:416-502`) → `sendCommand(id, 'list')`
(`servers.service.ts:400-414`) → um `kubectl exec ... rcon-cli "list"` **novo a cada
chamada** (relatório 08, Achado 1: `fork`+`exec` de processo, handshake K8s API, exec
remoto, handshake RCON — dezenas de milissegundos cada, medido em ordem de grandeza, não
em benchmark deste ambiente).

Fazendo a conta: uma aba de console aberta por 1 hora gera **360 execuções de
`kubectl exec`** só para a lista de jogadores (10.000ms de intervalo × 3600s/hora). Se
um admin costuma deixar o painel aberto durante o dia (comportamento normal de quem está
monitorando um servidor), isso passa de **8.000 execuções por dia, por aba aberta** —
cada uma disparando um processo novo no host, uma chamada à API do Kubernetes e uma
conexão RCON nova dentro do pod. `fetchLogs()` a cada 3s (mais barato — é leitura de log
via API do K8s, não subprocess) soma outras ~28.000 chamadas/dia por aba.

Isto **não escala com o número de jogadores** — escala com o número de abas do painel
abertas, e é o mesmo custo esteja o servidor com 0 ou 20 jogadores. É desperdício puro:
o painel está gastando recursos do cluster para mostrar uma lista de jogadores que quase
sempre não mudou desde a última checagem 10 segundos atrás.

**Correções, da mais barata para a mais estrutural**:

1. **Pausar o polling quando a aba não está visível** — `document.addEventListener(
   'visibilitychange', ...)`, pausar os dois timers quando `document.hidden`. Mudança
   só no frontend, sem tocar o backend, elimina o custo de abas esquecidas em segundo
   plano (o caso mais comum de desperdício).
2. **Resolver o custo por chamada** (relatório 08, Achado 1) — trocar o RCON via
   `child_process.exec`/`kubectl exec` por uma conexão persistente. Isso não reduz o
   *número* de chamadas, mas reduz o custo de cada uma de "processo novo + 3
   handshakes de rede" para "uma escrita numa conexão TCP já aberta" — a correção de
   maior impacto agregado, porque beneficia tanto o polling do console quanto o
   sleep-mode (item B2, abaixo) e qualquer comando digitado manualmente.
3. **Aumentar o intervalo de `fetchPlayers`** (10s é agressivo para um dado que muda
   raramente) ou, estruturalmente, **trocar polling por push** — o Gateway já mantém
   `activeConnections` em memória (`gateway.service.ts:19-22`,
   `getActivePlayers()`) atualizado em tempo real por evento de conexão/desconexão, sem
   custo de RCON nenhum. Expor isso via WebSocket ou Server-Sent Events eliminaria o
   polling de jogadores inteiramente para servidores que passam pelo Gateway — troca um
   problema de polling por um de arquitetura de tempo real, mudança maior, mas a mais
   correta a médio prazo.

### B2. O sleep-mode — cuja função é economizar recursos — hoje gasta recursos para descobrir se deve economizar

`SleepModeService.checkAndHibernate` (`sleep-mode.service.ts:38-86`) roda a cada 5
minutos e chama `checkServer` → `serversService.getPlayers(serverId)` para **cada**
servidor online com hibernação habilitada — o mesmo caminho RCON caro do item B1. Com N
servidores em modo hibernação (não Always-On) rodando ao mesmo tempo, são N execuções de
`kubectl exec` a cada 5 minutos, permanentemente, mesmo quando nada está mudando. Em um
dia, isso é `N × 288` execuções só para decidir se hiberna ou não.

Isto é irônico, mas não é um bug de lógica — é o mesmo problema de fundo do B1
manifestando num lugar diferente. A correção é a mesma (item B1.2): consertar o
transporte RCON de uma vez resolve os dois pontos de consumo simultaneamente, porque
ambos passam pelo mesmo `sendCommand`.

### B3. Longhorn ainda está rodando no cluster — legado de antes da migração para `local-path`

Confirmado ao vivo (namespace `longhorn-system`): controlador MetalLB à parte, o
Longhorn sozinho mantém cerca de 15 pods rodando permanentemente neste cluster
single-node — `csi-attacher`, `csi-provisioner`, `csi-resizer`, `csi-snapshotter`
(3 réplicas cada), `engine-image`, `instance-manager`, `longhorn-driver-deployer`,
`longhorn-manager`, `longhorn-ui` (2 réplicas). `docs/DOCUMENTACAO.md` já documenta que
o projeto **migrou de Longhorn para `local-path`** por problemas de corrupção — mas o
Longhorn nunca foi desinstalado, só parou de ser usado por este projeto.

**Ressalva importante, verificada ao vivo antes de recomendar qualquer remoção**: o
único PVC hoje usando a `StorageClass` `longhorn` neste cluster pertence ao
`mysql-operator` (`data-mysql-operator-db-operator-0`), que é infraestrutura do projeto
não relacionado `gatuno-*` que compartilha este cluster (ver [00-indice.md](00-indice.md)).
**Nenhum PVC do MineKube usa Longhorn hoje** (`servers.service.ts:58` já especifica
`storageClassName: 'local-path'` explicitamente) — mas desinstalar o Longhorn
quebraria o outro projeto. Esta não é uma decisão que este relatório pode recomendar
executar unilateralmente; é uma coordenação necessária com quem administra o `gatuno-*`
(possivelmente você mesmo, noutro contexto), não uma limpeza de código.

**Registro, não ação**: o consumo existe, é legado deste projeto, mas a remoção depende
de uma decisão fora do escopo do MineKube isoladamente.

### B4. O que já está correto e não precisa de mudança

- **`--max-old-space-size` vs. limite do container** — já corrigível, coberto no
  [relatório 08](08-performance-migracao-loadbalancer-go.md#achado-2--configuração-de-memória-do-node-já-está-incoerente-com-o-container),
  não repetido aqui.
- **`MonitoringService.getMetrics()`** (leitura de `metrics.k8s.io`) busca **todos** os
  pods de uma vez e filtra em memória (`monitoring.service.ts:38-128`) — não é chamado
  em loop por servidor, é uma única chamada batched à API do Kubernetes por requisição
  do frontend. Padrão correto, sem achado aqui.
- **Sondas de liveness/readiness dos servidores de Minecraft** (`mc-monitor status`,
  `servers.service.ts:127-156`) rodam via `exec` **dentro do próprio pod**, sem round-trip
  de rede externo — custo de kubelet local, não comparável ao RCON via `kubectl exec`
  (que sai do pod da API, atravessa a API do K8s, entra no pod do Minecraft). Não é o
  mesmo tipo de operação, não precisa da mesma correção.

## Verificação

1. **A1/A2**: criar um servidor com `VIEW_DISTANCE`/`SIMULATION_DISTANCE` reduzidos e
   `USE_AIKAR_FLAGS=true`; comparar uso de CPU (via `MonitoringService`/`kubectl top
   pod`) contra um servidor idêntico sem essas variáveis, sob a mesma carga de
   exploração de mundo.
2. **B1**: com o DevTools do navegador aberto na aba Network, confirmar a frequência
   real das chamadas a `/players` e `/logs` hoje; depois de implementar a pausa por
   `visibilitychange`, confirmar que minimizar/trocar de aba para o painel realmente
   para as chamadas.
3. **B1/B2**: depois de trocar o transporte RCON (relatório 08), medir a latência de uma
   chamada a `getPlayers` antes/depois — deve cair de dezenas de milissegundos (processo
   novo) para baixo de 5ms (conexão já aberta).
4. **B3**: `kubectl top pod -n longhorn-system` para quantificar o consumo real antes de
   decidir se/quando desinstalar, coordenado com quem administra o `gatuno-*`.
