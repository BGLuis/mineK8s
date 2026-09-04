# Relatório 08 — Performance: vale migrar o load balancer para Go?

> Ver [00-indice.md](00-indice.md) para contexto do ambiente. Refere-se ao
> `GatewayService` (`dashboard/backend/src/gateway/gateway.service.ts`), o proxy TCP
> customizado descrito no [relatório 02](02-tailscale-roteamento-controle-granular.md) —
> não ao `mc-router`, que **já é escrito em Go** e está sendo aposentado por falta de
> autorização, não por performance (ver relatório 02, decisão de arquitetura #2).

## Resposta curta

**Não, não pelo motivo de performance.** No tamanho real deste sistema (um homelab
single-node, servindo família/amigos), o proxy TCP não é nem está perto de ser o
gargalo — os processos JVM dos servidores de Minecraft consomem 2-3 ordens de grandeza
mais CPU/memória que o `GatewayService` inteiro. Uma reescrita em Go teria custo real
(duplicar a lógica de identidade/autorização numa segunda linguagem, sem cliente Prisma
maduro em Go) para resolver um problema que este projeto não tem. Existem dois problemas
de performance/confiabilidade **reais e mensuráveis hoje**, e nenhum dos dois se resolve
trocando de linguagem — ver Achados 1 e 2.

---

## Por que a resposta é "não": o perfil de trabalho do Gateway

`GatewayService.handleConnection` (`gateway.service.ts:53-198`) faz, por conexão:

1. **Uma vez, na entrada**: lê o primeiro pacote TCP (dezenas de bytes — o Handshake do
   Minecraft), faz parsing de alguns VarInts e uma string (`MinecraftProtocol`,
   microssegundos de CPU), consulta Prisma (SQLite local, in-process, sub-milissegundo)
   e a API do Tailscale (cacheada por 5 minutos — `tailscale.service.ts:169-174` —
   só bate na rede quando o cache expira ou o IP é novo).
2. **Pelo resto da conexão** (a sessão de jogo inteira, potencialmente horas):
   `clientSocket.pipe(serverSocket)` / `serverSocket.pipe(clientSocket)`
   (`gateway.service.ts:163-164`) — a partir daqui, **nenhum byte é processado em
   JavaScript**. `pipe()` delega para a implementação de streams do Node sobre libuv,
   que já é o mesmo modelo de I/O assíncrono orientado a eventos que o runtime do Go usa
   por baixo (epoll/kqueue + goroutines vs. epoll/kqueue + event loop) — não há
   "trabalho perdido" em JS por byte transferido.

Ou seja: o custo em CPU por jogador conectado é **um parsing pequeno na conexão** +
**zero processamento contínuo** depois disso. Isto não é um proxy que decodifica,
inspeciona ou transforma tráfego byte a byte durante o jogo (como faria, por exemplo,
um proxy MITM de HTTP fazendo TLS termination) — é encaminhamento bruto de socket a
socket na maior parte do tempo de vida da conexão. Este é precisamente o tipo de
workload em que Node.js historicamente não perde para runtimes com goroutines: ambos
são I/O-bound, ambos delegam para o kernel, a diferença de linguagem começa a importar
em outro regime de escala (abaixo).

## Onde Go faria diferença de verdade — e por que não é este caso

Reescrever em Go compensa quando pelo menos um destes é verdade:

- **Dezenas de milhares de conexões concorrentes** (C10K+), onde o overhead de memória
  por conexão (goroutine ~2KB de stack inicial vs. objetos JS + buffers do Node, ordem
  de dezenas de KB por socket) começa a somar para gigabytes de diferença.
- **Trabalho pesado de CPU por pacote**, sustentado durante toda a conexão (decodificação
  contínua, criptografia, compressão) — não é o caso aqui, o parsing acontece uma vez
  (ou duas, depois da extensão proposta no relatório 05 para checar nickname) por
  conexão, não por pacote de jogo.
- **Latência sub-milissegundo previsível sob carga**, onde pausas de GC do V8 seriam
  inaceitáveis — relevante para trading de alta frequência ou proxies de borda de CDN em
  produção com SLA agressivo, não para o handshake de entrada de um servidor de
  Minecraft doméstico.

Escala real deste projeto: o `k8s/nestjs-api.yaml` (ver
[relatório 03](03-k8s-terraform-validacao-correcao.md)) limita o pod inteiro da API —
que roda HTTP, o Gateway TCP e todo o resto do NestJS num único processo — a
`500m` CPU / `512Mi` de memória. É um homelab de uma pessoa convidando amigos e família;
o número realista de conexões simultâneas é dezenas, não milhares. Nenhum dos dois
motivos técnicos acima para migrar para Go se aplica nesta escala.

---

## Achado 1 — o problema real de performance não é o proxy, é o RCON

`sendCommand` (`servers.service.ts:400-414`, já citado nos relatórios 00/01/02 pelo
risco de segurança) tem um custo de performance genuíno e **independente da linguagem
do Gateway**: cada comando RCON — incluindo o `list` chamado pelo `sleep-mode` a cada 5
minutos para cada servidor ligado (`sleep-mode.service.ts`) e pela listagem de
jogadores no Admin — dispara um **processo novo** via `child_process.exec`:
```ts
await execAsync(`kubectl exec ${podName} -- rcon-cli "${command}"`);
```
Cada chamada paga o custo de: iniciar um processo `kubectl`, autenticar contra a API do
Kubernetes, abrir um `exec` remoto para dentro do pod, iniciar o binário `rcon-cli`
*dentro* do pod, conectar via RCON, executar, encerrar tudo. Isso é
tipicamente dezenas de milissegundos por chamada — **ordens de grandeza mais lento que
qualquer coisa que o Gateway TCP faz** — e se repete a cada verificação de hibernação,
a cada consulta de jogadores online, a cada comando digitado no console.

Este custo existe **igualmente em Go**: o gargalo é o `fork+exec` de um processo externo
e uma cadeia de três handshakes de rede (kubectl→K8s API→pod→RCON), não a linguagem que
inicia esse processo. **Correção de performance real**: manter uma conexão RCON
persistente (biblioteca RCON nativa, sem passar por `kubectl exec`/`rcon-cli` a cada
chamada) ou, no mínimo, uma conexão `kubectl exec` de longa duração reaproveitada — isso
sim eliminaria o overhead repetido de processo+handshake, em qualquer linguagem.

## Achado 2 — configuração de memória do Node já está incoerente com o container

`Dockerfile.prod`: `CMD ["node", "--max-old-space-size=3072", "dist/main.js"]` — instrui
o V8 a permitir até **3072 MiB** de heap. `k8s/nestjs-api.yaml`
(`resources.limits.memory`) limita o container a **512Mi**. O V8 decide quando rodar o
garbage collector com base no teto que você deu a ele (3072Mi), não no cgroup do
container — sob pressão real de memória, o processo tende a ser morto pelo OOM killer
do Kubernetes antes do V8 sequer achar necessário coletar lixo agressivamente, porque do
ponto de vista do V8 ele ainda está longe do limite configurado.

Isto não é hipotético nem exige tráfego alto para se manifestar — é uma discrepância de
configuração presente hoje, independente de carga. **Correção**: `--max-old-space-size`
deve ficar abaixo do limite do container (algo como `400`, deixando margem para a pilha
nativa e buffers fora do heap do V8), ou remover a flag e deixar o Node autodetectar o
limite via cgroup (versões recentes do Node, e o `Dockerfile.prod` já usa Node 24, fazem
isso automaticamente quando a flag não é passada manualmente e sobrescrevendo o default).

Nota: isto é um argumento a favor de Go **como fato isolado** (um binário Go compilado
tem footprint de memória previsível, sem heap gerenciado que precise ser calibrado
contra o cgroup) — mas é um problema de uma linha de configuração a corrigir, não
justificativa para reescrever o serviço inteiro.

---

## O custo real de uma migração para Go, se fosse feita

Para ser honesto sobre os dois lados: migrar o Gateway para Go não é "só reescrever o
parser". O `GatewayService` está acoplado, no mesmo processo, a:

- **Prisma** (`checkAuthorization` consulta `User`/`Server`/`Group` a cada conexão) —
  Prisma não tem cliente oficial para Go. Seria preciso reescrever essas queries com
  outra biblioteca (`sqlx`, `ent`, `gorm`) contra o mesmo SQLite, **mantendo os dois
  conjuntos de queries em sincronia** com qualquer mudança de schema feita pelo lado
  NestJS/Prisma — superfície de manutenção dobrada para a mesma lógica.
- **`TailscaleService`** (chamada HTTP à API do Tailscale, cache, criação de convites)
  — duplicar em Go, ou manter uma dependência entre processos (o Go teria que chamar de
  volta o NestJS para resolver identidade, reintroduzindo a mesma latência de rede que
  se está tentando evitar).
- **Deploy**: hoje é um único pod, uma única imagem, uma linguagem. Um Gateway em Go
  vira um segundo processo/container no mesmo pod (ou um Deployment separado), com seu
  próprio ciclo de build (`make build-api` já é específico do Node hoje — precisaria de
  um segundo pipeline Go) — mais uma peça no Makefile/CI para manter, pelo ganho de
  performance zero descrito acima.

## Recomendação

Não migrar por performance. Se o objetivo real for outro (aprendizado de Go, unificar
com o `mc-router` que já é Go antes de aposentá-lo, gosto pessoal por binários
estáticos) — motivos válidos, só não são "performance", e vale nomear o motivo real
explicitamente antes de decidir, porque o custo de manter duas linguagens no mesmo
sistema é real e permanente.

Se o apetite for por otimizar algo, os dois itens com retorno real, nesta ordem, custam
muito menos que uma reescrita e resolvem gargalos que **de fato existem hoje**:

1. Corrigir o `--max-old-space-size` (Achado 2) — literalmente uma linha.
2. Trocar `child_process.exec` + `kubectl exec` por uma conexão RCON persistente
   (Achado 1) — remove o maior custo de latência do sistema, presente em qualquer
   comando/consulta de jogadores/verificação de hibernação, em qualquer linguagem.

## Como validar isto empiricamente, se quiser números medidos (não estimados)

Nada acima foi medido neste ambiente — é uma análise de engenharia baseada no perfil de
trabalho do código (I/O-bound, parsing mínimo por conexão, sem processamento contínuo) e
em características bem estabelecidas dos dois runtimes, não um benchmark rodado. Se
quiser confirmar com números reais antes de descartar a ideia: um teste de carga simples
— abrir N conexões TCP simultâneas contra o Gateway (simulando o Handshake do Minecraft)
e medir CPU/memória do pod via `kubectl top pod` enquanto sobe N — é suficiente para
confirmar que o teto prático de conexões concorrentes deste homelab está muito abaixo de
onde a escolha de linguagem passaria a importar. Não executei esse teste aqui porque
exigiria gerar carga contra o cluster real deste ambiente — avise se quiser que eu
prepare o script e rodemos juntos.
