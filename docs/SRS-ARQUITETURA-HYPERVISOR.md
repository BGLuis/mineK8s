# Documento de Especificação de Requisitos de Software e Arquitetura de Sistemas (SRS)
## Orquestrador / Hypervisor de Instâncias de Minecraft & Gateway L7 de Alta Performance

---

### Sumário Executivo e Metadados do Sistema
- **Projeto:** Orquestrador de Instâncias de Minecraft (Next-Gen Game Server Hypervisor)
- **Perfil do Documento:** Engenharia Reversa de Regras de Domínio, Especificação de Requisitos de Software (SRS) e Arquitetura Agnóstica de Linguagem
- **Público-Alvo:** Engenheiros de Software, Arquitetos de Infraestrutura e Especialistas em Computação Distribuída

---

```mermaid
graph TD
    subgraph Rede Privada Zero-Trust [Rede Mesh / VPN Privada - Tailscale]
        ClientMC[Cliente Minecraft / Jogador]
        AdminWeb[Navegador Web / Dashboard SPA]
    end

    subgraph Ponto de Entrada Público / DMZ
        JoinSvc[Serviço de Convite & Onboarding - Porta 3001]
    end

    subgraph Núcleo do Hypervisor / Control Plane
        Gateway[Gateway Reverso TCP L7 - Porta 25565]
        API[API HTTP de Gerenciamento & Controle]
        Reconciler[Reconciliador de Estado & Watchdog]
        SleepWorker[Worker de Inatividade & Hibernação]
        DB[(Banco de Dados Relacional / Estado)]
    end

    subgraph Camada de Execução OCI / Clusters
        subgraph Pod / Container Instância MC-01
            JVM1[JVM - Servidor Vanilla / Paper]
            PVC1[(Storage Local /data)]
        end
        subgraph Pod / Container Instância MC-02
            JVM2[JVM - Modpack Forge / NeoForge]
            PVC2[(Storage Local /data)]
        end
    end

    ClientMC -->|1. Handshake TCP + Login| Gateway
    Gateway -->|2. Validação de Identidade & ACL| DB
    Gateway -->|3. Proxy TCP Transparente| JVM1
    AdminWeb -->|Comandos & Gerenciamento| API
    API --> DB
    API -->|Deploy, Escala, Lifecycle| Reconciler
    Reconciler --> JVM1
    Reconciler --> JVM2
    SleepWorker -->|Monitoramento de Sessão| Gateway
```

---

## 1. Visão Geral e Escopo do Sistema

### 1.1 Propósito Central do Hypervisor
O sistema atua como um **Plano de Controle (Control Plane) e Hypervisor de Aplicação** voltado para a orquestração dinâmica de instâncias de servidores de jogos baseados na Máquina Virtual Java (JVM), especificamente focado em **Minecraft (Vanilla, Paper, Purpur) e Modpacks pesados (CurseForge e Modrinth/Fabric/Forge/NeoForge)**.

O sistema sintetiza quatro responsabilidades operacionais em uma arquitetura unificada:
1. **Orquestrador de Containers e Ciclo de Vida:** Responsável pelo provisionamento declarativo, escalonamento vertical e horizontal para zero (`scale-to-zero` / hibernação), destruição e monitoramento de processos de instâncias isoladas em contêineres OCI.
2. **Gateway Reverso Dinâmico L7 (SNI Virtual Hosting para TCP):** Ponto único de terminação de conexões de jogo (porta padrão `25565`). Inspeciona o handshake binário da conexão TCP, resolve o subdomínio requisitado e despacha os sockets para a respectiva instância interna, eliminando a necessidade de expor múltiplas portas de rede (`NodePort`/`hostPort`) para o usuário final. *(Especificação técnica e contratos detalhados em [SRS-GATEWAY-L7.md](SRS-GATEWAY-L7.md))*.
3. **Controlador de Acesso Zero-Trust com Mapeamento de Identidade:** Integração com malha de rede privada segura (Tailscale), onde a identidade do jogador é validada antes de o tráfego alcançar a instância de jogo, garantindo controle de acesso granular por listas e grupos. *(Especificação técnica e arquitetura formal detalhada em [SRS-SUBSISTEMA-TAILSCALE.md](SRS-SUBSISTEMA-TAILSCALE.md))*.
4. **Gerenciador de Armazenamento e Backups Atômicos:** Manipulação e salvaguarda do sistema de arquivos das instâncias (`/data`), garantindo integridade de I/O em disco local e backups compactados sem corrupção de blocos de mundos. *(Especificação técnica, pipeline de snapshot e motor de modpacks detalhados em [SRS-STORAGE-MODPACKS-BACKUPS.md](SRS-STORAGE-MODPACKS-BACKUPS.md))*.

### 1.2 Atores do Sistema e Superfícies de Interação
* **Administrador do Sistema (Operator / Power User):**
  - *Interação:* Web UI (Dashboard) e API HTTP REST protegida.
  - *Ações:* Criar instâncias, provisionar modpacks ou servidores puros, monitorar métricas de CPU/RAM, disparar comandos de console administrativo (RCON), manipular arquivos no disco da instância, criar grupos de acesso, emitir links de convite e autorizar/revogar jogadores.
* **Jogadores de Minecraft (Game Clients):**
  - *Interação:* Clientes nativos de Minecraft (Java Edition) conectando via TCP diretamente à porta única `25565` através da interface de rede VPN privada.
  - *Ações:* Consultar status de servidor (Server List Ping) e autenticar no mundo de jogo através do subdomínio atribuído (ex.: `survival.dominio.interno`).
* **Novo Convidado (Guest Onboarding):**
  - *Interação:* Navegador Web acessando o endpoint público do serviço de entrada (`/join`).
  - *Ações:* Instalar a ferramenta de VPN privada e ativar a chave de acesso pré-autorizada via deep linking para ingressar na rede restrita.
* **Agente de Teste E2E (Health Bot Daemon):**
  - *Interação:* Cliente sintético automatizado (bot headless em protocolo nativo) instanciado periodicamente.
  - *Ações:* Conectar-se ao servidor, concluir handshake, autenticar-se, validar o evento de spawn do mundo e desconectar-se para emitir relatório de saúde real da engine de física e mundo.
* **Provedores de Catálogo Externo (Upstream APIs):**
  - *Interação:* Clientes HTTP do Hypervisor consumindo APIs públicas externas: Modrinth v2 (Modpacks), CurseForge v1 (Modpacks e versões de arquivo), Mojang API (manifests de versões de jogo e assinaturas de skins) e Tailscale API (gestão de dispositivos, ACLs e chaves pré-autenticadas).

---

## 2. Ciclo de Vida da Instância de Minecraft

### 2.1 Máquina de Estados da Instância

```mermaid
stateDiagram-v2
    [*] --> Provisioning: createServer(DTO)
    Provisioning --> Starting: Volumes Alocados & Configs Injetadas
    Provisioning --> Failed: Erro de Armazenamento/Permissão
    
    Starting --> Ready: Readiness Probe OK (TCP Ping / Query)
    Starting --> Crashed: Falha de Inicialização / Crash JVM
    Starting --> Stopping: Comando de Stop Manual
    
    Ready --> Stopping: Stop Manual / Hibernação (Inatividade)
    Ready --> Updating: startUpdate(NovaVersão)
    Ready --> Crashed: Watchdog Timeout / OOM Killer
    
    Updating --> Stopping: Parada para Backup Preventivo
    Updating --> RollingBack: Falha na Nova Versão
    RollingBack --> Ready: Dados e Versão Restaurados
    
    Stopping --> Stopped: Graceful Shutdown Concluído (save-all)
    Stopping --> Crashed: Timeout Excedido (SIGKILL Forçado)
    
    Stopped --> Starting: Start Manual / Wake-on-Connection
    Stopped --> [*]: deleteServer(Exclusão Completa)
    Crashed --> Starting: Política de Auto-Restart
    Crashed --> [*]: deleteServer
```

| Estado | Descrição Semântica | Condição de Entrada | Ações em Execução |
| :--- | :--- | :--- | :--- |
| **`Provisioning`** | Criação declarativa de volumes persistentes (PVC), montagem de descritores de serviço e injeção de parâmetros de inicialização. | Requisição de criação recebida pela API. | Alocação de volume em disco, reserva de quota de storage, criação do descritor de orquestração. |
| **`Starting`** | Inicialização do container OCI. A JVM faz bootstrap, carrega bibliotecas, compila mods/plugins e gera ou carrega regiões do mundo. | Escalonamento de réplicas de 0 para 1. | Download de arquivos se necessário, validação de EULA, execução do jar com flags de GC, vinculação da porta local 25565. |
| **`Ready`** | A engine do Minecraft finalizou o carregamento de todos os chunks de spawn e está apta a processar ticks e pacotes de rede. | Sonda de prontidão (`ReadinessProbe`) responde com sucesso na porta 25565. | Habilitação do tráfego no Gateway L7, ativação do terminal RCON, início do monitoramento de atividade de jogadores. |
| **`Stopping`** | Interrupção ordenada do processo com persistência obrigatória de estado em disco. | Requisição manual do usuário ou disparo do worker de hibernação por inatividade. | Envio do comando de parada ordenado (`save-all flush` + `stop`), encerramento de threads, liberação de sockets. |
| **`Stopped`** | A instância está dormente (`replicas = 0`), com processo desalocado e zero consumo de CPU/RAM. O armazenamento permanece preservado. | Processo Java encerrado com sucesso. | Dados em disco preservados intactos. Sonda de liveness inativa. O Gateway L7 bloqueia ou retém pacotes de entrada. |
| **`Updating`** | Execução de rotina transacional de migração de versão de software de modpack/vanilla. | Requisição de atualização de versão recebida. | Parada do servidor, disparo de Job de snapshot/backup atômico, injeção de novos binários, verificação de subida. |
| **`RollingBack`** | Restauração emergencial de dados e parâmetros anteriores devido à falha de compatibilidade da nova versão. | A nova versão não alcançou estado `Ready` dentro da janela limite (ex.: 10 minutos). | Limpeza do diretório de dados, extração do arquivo de backup gerado imediatamente antes do update, restauração do descritor de versão. |
| **`Crashed`** | Interrupção anômala do processo JVM (OOM, erro fatal de carregamento de mods ou interrupção forçada). | Processo Java encerra com código diferente de zero ou liveness probe falha repetidamente. | Captura do log de erro e relatório de falhas (`crash-reports/`), aplicação de regras de re-tentativa (auto-restart). |

---

### 2.2 Mecanismos de Inicialização, Monitoramento e Término

#### A. Inicialização e Bootstrap do Processo
A inicialização da instância requer um modelo de execução estruturado em camadas:
1. **Configuração de Ambiente de Inicialização:** Variáveis de ambiente declarativas são fornecidas ao runtime containerizado informando o tipo de servidor (`TYPE = PAPER | VANILLA | AUTO_CURSEFORGE | MODRINTH`), a versão e a memória base.
2. **Bootstrap de Binários:** O container de inicialização verifica se os arquivos do servidor existem no diretório raiz do volume compartilhado (`/data`). Na ausência, baixa as dependências e o motor de execução apropriado.
3. **Injeção de Argumentos da JVM:** A JVM é instanciada sem interpretador interativo com flags estritas de performance de Garbage Collector (Aikar's Flags otimizadas para G1GC).

#### B. Sondas de Saúde (Healthchecks) e Watchdogs

> **Diagnóstico de Engenharia Reversa:**
> *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
> O código original utiliza um utilitário CLI externo (`mc-monitor status`) acionado via execução de subprocesso periódico no container (`exec probe`) com tolerâncias arbitrariamente longas (`failureThreshold: 60`, `initialDelaySeconds: 30`) para permitir que modpacks pesados inicializem sem que o sistema destrua o container; o requisito funcional real é separar categoricamente a **Fase de Inicialização e Carregamento (Startup)** da **Fase de Prontidão (Readiness)** e **Detecção de Travamento de Tick (Liveness / Watchdog)**.

O novo sistema deve implementar três sondas distintas:
1. **Startup Probe:** Ativa exclusivamente durante a inicialização.
   - *Comportamento:* Consulta a porta local de jogo a cada 10 segundos com tolerância estendida (até 15 minutos para modpacks pesados com mais de 300 mods). Durante esta fase, o sistema reporta estado `Starting` sem penalizar a métrica de disponibilidade da instância.
2. **Readiness Probe:** Ativa a partir da primeira resposta válida da porta de rede.
   - *Comportamento:* Validação de handshake básico do Minecraft. Quando o handshake responde com metadados válidos de versão e contagem de jogadores, a instância é transicionada para `Ready`.
3. **Liveness & Tick Watchdog Probe:** Monitora se a thread principal do servidor (`Server thread`) travou.
   - *Mecanismo Nativo do Minecraft:* O servidor possui a propriedade `max-tick-time` (padrão `60000` ms). Se um tick durar mais de 60 segundos, o próprio servidor encerra o processo gerando um crash log com stacktrace do travamento da thread principal.
   - *Mecanismo do Hypervisor:* Requisições periódicas de ping de protocolo (TCP Status Request). Se o servidor não responder a três pings consecutivos no intervalo de 15 segundos estando em estado `Ready`, considera-se deadlock da JVM.

#### C. Políticas de Auto-Restart e Hibernação (Sleep Mode)
* **Auto-Restart sob Falha:** Se a instância abortar com código diferente de zero ou sofrer falha de liveness após ter alcançado `Ready`, o orquestrador deve aplicar uma política de reinicialização com backoff exponencial (máximo de 3 tentativas em janela de 10 minutos) antes de marcar como `Crashed`.
* **Motor de Hibernação por Inatividade (`Sleep Mode`):**
  - O sistema mantém rastreamento cronológico do número de jogadores conectados em cada instância ativa.
  - A contagem de inatividade é alimentada em tempo real por eventos de desconexão originados no Gateway TCP ou por amostragem periódica não intrusiva.
  - Se a contagem de jogadores permanecer em zero de forma ininterrupta pelo período configurado na regra da instância (`hibernateAfterMinutes`, ex.: 30 minutos), o orquestrador dispara o fluxo de parada ordenada (`Stopping` -> `Stopped` com réplicas reduzidas para 0), liberando imediatamente a memória RAM do nó anfitrião.
  - Servidores parametrizados com política `never` ou nula são tratados como *Always On* e nunca são hibernados automaticamente.

#### D. Tratamento de Graceful Shutdown
O encerramento do processo do Minecraft exige garantia de integridade transacional nos arquivos de região do mundo (chunks salvos no formato NBT/Anvil):
1. **Comando de Flush Pré-Parada:** O Hypervisor emite via console/RCON o comando `save-all flush` para forçar a JVM a persistir imediatamente no disco todas as entidades e chunks em memória.
2. **Comando de Stop Ordenado:** O Hypervisor emite o comando `stop` na console de controle.
3. **Período de Carência do Sistema Operacional (`Termination Grace Period`):** O orquestrador aguarda o encerramento do processo Java com uma janela de segurança de 60 a 90 segundos.
4. **Tratamento de Timeout:** Apenas se a JVM falhar em terminar após o tempo de carência esgotado, o sinal destrutivo `SIGKILL` é emitido pelo gerenciador de processos do container para recuperar os recursos do sistema operacional.

---

## 3. Gerenciamento de Processos, I/O e Recursos

### 3.1 Captura de Fluxos de Entrada/Saída (`stdin`, `stdout`, `stderr`) e Console

> **Diagnóstico de Engenharia Reversa:**
> O código legado invoca `child_process.exec("kubectl exec ${podName} -- rcon-cli \"${command}\"")` diretamente na shell para cada comando de console, além de fazer polling HTTP a cada 3 segundos lendo logs brutos via Kubernetes API e executando filtros de string no navegador para ocultar o spam gerado pelo próprio polling; o requisito funcional real é um **Canal de Comando RCON Persistente em Memória** e um **Pipeline Reativo de Logs baseado em Streams/WebSockets** com desacoplamento total de shell.
> 
> *Para a especificação formal de engenharia deste subsistema, consulte o documento dedicado:* **[SRS-DRIVER-RCON-PIPELINE-LOGS.md](SRS-DRIVER-RCON-PIPELINE-LOGS.md)**.


```mermaid
sequenceDiagram
    autonumber
    participant UI as Cliente Web / Console SPA
    participant Core as API Hypervisor (Next-Gen Core)
    participant RCON as Driver RCON Persistente (TCP)
    participant LogPipe as Stream de Logs (Stdout Engine)
    participant MC as Processo Minecraft (JVM)

    UI->>Core: WebSocket Connect (/ws/servers/:id/terminal)
    Core->>LogPipe: Assina Stream de Stdout/Stderr
    LogPipe-->>UI: Emissão Contínua de Logs (Delta Stream)
    
    UI->>Core: Envia Comando: "/time set day"
    Core->>Core: Sanitiza & Valida Estrutura (Sem Shell)
    Core->>RCON: Envia Pacote RCON TCP (ID 0x02)
    RCON->>MC: Despacha Payload Binário
    MC-->>RCON: Retorna Resposta do Comando
    RCON-->>Core: Pacote de Sucesso RCON (ID 0x00)
    Core-->>UI: Exibe Resposta no Terminal Virtual
```

#### Requisitos de Entrada de Comandos:
- O Hypervisor deve manter uma conexão TCP direta com o listener RCON local do Minecraft (porta interna `25575`), encapsulando os comandos diretamente no protocolo binário RCON (RFC/Minecraft Protocol: Type 2 `SERVERDATA_EXECCOMMAND`).
- É estritamente vedada a interpolação de strings em interpretadores de linha de comando (`bash`, `sh`) ou a invocação de ferramentas CLI de terceiros para disparar comandos.
- O driver RCON deve implementar reconexão automática, controle de timeout (máximo de 5 segundos por comando) e sanitização estrita de delimitadores null-byte (`\0`).

#### Requisitos de Captura de Logs:
- A leitura de logs deve ser orientada a eventos, consumindo o stream de `stdout`/`stderr` do processo do container em tempo real.
- O backend deve implementar um anel de buffer circular em memória (ex.: últimos 500 eventos de log) para prover histórico imediato a novas conexões de console.
- A distribuição para a interface gráfica de gerenciamento deve ocorrer através de canal duplex (WebSocket ou Server-Sent Events).
- O filtro de supressão de ruído de autenticação interna (ex.: `"RCON Listener"`, `"Thread RCON Client"`) deve ser operado no backend antes da emissão, evitando desperdício de banda e processamento do cliente.

---

### 3.2 Alocação de Portas de Rede e Roteamento Dinâmico L7

```mermaid
flowchart LR
    subgraph WAN / VPN
        Client[Cliente Minecraft]
    end

    subgraph Entrada Única de Rede
        Port[Porta 25565 / TCP]
    end

    subgraph L7 Gateway Engine
        Parser[Minecraft Protocol Parser]
        AuthCheck[Validador de Identidade Tailscale + ACL]
        Router[Despachante de Socket TCP]
    end

    subgraph Instâncias de Servidores
        Svc1[Instância A: Porta Interna 25565]
        Svc2[Instância B: Porta Interna 25565]
    end

    Client -->|TCP Connect| Port
    Port --> Parser
    Parser -->|Extrai Hostname & Login| AuthCheck
    AuthCheck -->|Autorizado| Router
    Router -->|Pipe de Socket Duplex| Svc1
    AuthCheck -->|Não Autorizado| Drop[Desconecta com Mensagem Formatada]
```

1. **Porta Central de Entrada (Virtual Hosting):**
   - O Hypervisor disponibiliza um único listener TCP na porta padrão `25565`.
   - O endereço de rede do jogador carrega a indicação do servidor de destino através do campo `Server Address` no handshake do Minecraft (equivalente ao cabeçalho `Host` do HTTP ou `SNI` do TLS).
2. **Decodificação do Pacote Handshake:**
   - Ao receber o primeiro pacote TCP, a leitura deve seguir a especificação de tipos primitivos do Minecraft:
     - `Packet Length`: VarInt (1 a 5 bytes).
     - `Packet ID`: VarInt (`0x00` para Handshake).
     - `Protocol Version`: VarInt (versão do cliente).
     - `Server Address`: String UTF-8 prefixada por VarInt com o tamanho.
     - `Server Port`: Unsigned Short (2 bytes, big-endian).
     - `Next State`: VarInt (`1` para Status/Ping, `2` para Login).
3. **Limpeza e Normalização de Hostname:**
   - Clientes modificados (Forge, NeoForge, FML) anexam flags proprietárias no endereço do servidor (ex.: `servidor.dominio.com\0FML\0`). O parser deve isolar a string até o primeiro null-byte antes da consulta de rota.
4. **Despacho e Roteamento de Socket:**
   - Com o subdomínio normalizado, o sistema busca a instância correspondente.
   - O socket de entrada do cliente é pareado diretamente com o socket interno do container do servidor (`pipe` duplex sem intervenção no tráfego durante o jogo).
   - O primeiro pacote recebido deve ser reinserido de forma idêntica no fluxo de dados despachado para a instância interna para não invalidar a sessão de conexão do Minecraft.
5. **Serviços sem Suporte a Handshake de Nome de Domínio (Exceção Arquitetural):**
   - Servidores de jogos que não enviam hostname no handshake TCP (como Terraria) não são elegíveis ao roteamento por porta compartilhada L7. O orquestrador deve suportar um modelo alternativo de alocação de portas dinâmicas dedicadas a partir de um pool configurável (ex.: `7777`, `7778`, etc.).

> **Especificação Exaustiva do Subsistema:** Para a máquina de estados assíncrona em Rust/Tokio, decodificação streaming de VarInts, Rich MOTD dinâmico, Auto-Wake com retenção de socket (Hold Connection), detecção de PROXY Protocol v2 e contratos gRPC/IPC, consulte o documento autoritativo: **[SRS-GATEWAY-L7.md](SRS-GATEWAY-L7.md)**.

---

### 3.3 Isolamento, Limites e Alocação de Recursos de Hardware

| Parâmetro de Recurso | Regra Arquitetural Obrigatória | Racional de Engenharia de Sistemas |
| :--- | :--- | :--- |
| **Memória JVM (`Xms` / `Xmx`)** | Configurado explicitamente para a quantidade contratada da instância (ex.: `4G`, `8G`). | Evita que a JVM dispute heap dinamicamente durante a execução, prevenindo pausas de GC fora de controle. |
| **Reserva de Memória (`Memory Request`)** | Estritamente igual à memória de Heap da JVM (`${MEM}Gi`). | Garante que o host físico possui a memória real alocada para o Heap do servidor no momento do agendamento. |
| **Teto de Memória (`Memory Limit`)** | Calculado estritamente como `${MEM + 1}Gi` (ou `${MEM + 2}Gi` em modpacks acima de 8G). | **Proteção contra OOM-Killer do SO:** A JVM requer memória fora do Heap (Off-Heap, Metaspace para classes de mods, buffers de rede Netty e threads nativas). Sem essa margem, o Linux OOM-Killer executa `SIGKILL` no container sem gerar crash log. |
| **CPU Requests** | Definido com valor base (ex.: `1000m` / 1 Core) para cada instância. | Garante classe de Qualidade de Serviço (QoS) `Burstable`, impedindo que a instância seja prioritariamente expulsa do nó anfitrião em picos de concorrência. |
| **CPU Limits** | **Não deve ser aplicado (`unlimited` / sem teto rígido).** | O mecanismo Completely Fair Scheduler (CFS) do Linux introduz penalidades severas de throttling na JVM quando o limite de CPU é atingido. Isso estende pausas de Garbage Collection e causa perda irreversível de ticks no motor do jogo. |

#### Conjunto Canônico de Flags de Otimização da JVM (Aikar's Flags):
O orquestrador deve aplicar por padrão os argumentos de inicialização recomendados para mitigação de latência em servidores Minecraft baseados em G1GC:
```bash
-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch \
-XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M \
-XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 \
-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 \
-XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem \
-XX:MaxTenuringThreshold=1
```
*A flag `-XX:+AlwaysPreTouch` é obrigatória para alocar e tocar todas as páginas de memória na inicialização do servidor, eliminando interrupções do sistema operacional durante o jogo.*

---

## 4. Gerenciamento de Arquivos, Templates e Configurações

### 4.1 Estrutura Organizacional de Diretórios
Cada instância possui um diretório de dados raiz unificado (`/data`) persistido em volume de armazenamento dedicado:

```
/data/
├── server.properties          # Configurações globais de rede, gameplay e portas
├── eula.txt                   # Termo de aceite da EULA (eula=true)
├── user_jvm_args.txt          # Argumentos adicionais de JVM (Forge/NeoForge modernos)
├── ops.json                   # Operadores do servidor com privilégios administrativos
├── whitelist.json             # Lista de controle de acesso interna do Minecraft
├── banned-players.json        # Registro de jogadores banidos por UUID/Nickname
├── banned-ips.json            # Registro de IPs banidos nativamente
├── world/                     # Mundo principal (Overworld)
│   ├── session.lock           # Trava binária exclusiva de execução do processo
│   ├── level.dat              # Metadados de semente, regras de jogo e tempo
│   ├── region/*.mca           # Regiões de blocos comprimidas (Formato Anvil)
│   ├── entities/*.mca         # Dados de entidades por chunk
│   ├── poi/*.mca              # Pontos de interesse (vilas, camas, portais)
│   └── playerdata/*.dat       # Inventários e posições de jogadores salvos por UUID
├── world_nether/              # Dimensão do Nether (estruturas Spigot/Paper)
├── world_the_end/             # Dimensão do The End (estruturas Spigot/Paper)
├── plugins/                   # Jars de plugins (Paper/Purpur/Spigot)
├── mods/                      # Jars de modificações (Forge/Fabric/NeoForge)
├── config/                    # Configurações específicas de mods e motores (paper-world.yml)
├── logs/                      # latest.log e arquivos rotacionados comprimidos (.log.gz)
└── crash-reports/             # Stacktraces de falhas gerados pela thread da JVM
```

---

### 4.2 Estratégia de Armazenamento e Templating de Instâncias

> **Especificação Exaustiva do Subsistema:** Para os algoritmos detalhados de backup quente com janela ultracurta via hardlinks, restauração transacional com staging e rollback, cache CAS com deduplicação por hash, resolução declarativa de modpacks CurseForge e Modrinth, modelos de dados TypeORM e manifestos Kubernetes Jobs, consulte o documento autoritativo: **[SRS-STORAGE-MODPACKS-BACKUPS.md](SRS-STORAGE-MODPACKS-BACKUPS.md)**.


1. **Seleção de Storage de Alto Desempenho:**
   - Os volumes de dados dos mundos devem ser montados obrigatoriamente sobre **Armazenamento em Bloco Local com I/O Direto** (como K8s `local-path` ou volume bind de SSD NVMe dedicado do host).
   - Sistemas de arquivos distribuídos em rede via TCP (como NFS puro ou volumes sincronizados em rede sem cache local) são expressamente proibidos para o diretório `/data`, sob pena de travamentos no salvamento síncrono de regiões e corrupção de chunks.
2. **Templating e Provisionamento Automatizado:**
   - O provisionamento não deve depender de cópias completas manuais de templates estáticos gigantescos.
   - O sistema define um **Descritor Declarativo de Instalação**:
     - Para **Vanilla / Paper**: O sistema baixa a versão solicitada diretamente dos repositórios oficiais na primeira execução e gera o esqueleto de configuração.
     - Para **Modpacks (CurseForge / Modrinth)**: O sistema repassa o identificador do projeto e a versão do pacote para o motor de inicialização, que realiza o download dos arquivos de mods e sobreposições diretamente das APIs no momento do bootstrap inicial.
3. **Isolamento de Permissões POSIX:**
   - Todo o sistema de arquivos contido em `/data` deve pertencer obrigatoriamente ao UID/GID não privilegiado do processo da JVM (padrão UID `1000`, GID `1000`). Tarefas auxiliares (Jobs de backup ou uploads) devem normalizar a posse dos arquivos (`chown -R 1000:1000 /data`) para impedir que a JVM falhe ao gravar no disco por falta de permissão de escrita.

---

### 4.3 Manipulação Dinâmica de Arquivos Críticos

O Hypervisor é responsável por injetar e reescrever dinamicamente configurações essenciais sem depender de intervenção manual:

* **`server.properties`:**
  - `server-port=25565` (garantir binding na porta interna padronizada).
  - `enable-rcon=true`, `rcon.port=25575`, `rcon.password=<secret_gerado>` (habilitação mandatória para comunicação interna).
  - `online-mode=false` (para habilitar o fluxo unificado e híbrido de contas piratas e premium via Gateway).
  - `view-distance` e `simulation-distance` (injetados dinamicamente com base nas opções de desempenho da instância).
  - `max-tick-time=60000` (garantia de watchdog de thread ativo).
* **`eula.txt`:**
  - Gerado de forma declarativa e determinística antes da subida do binário com o conteúdo `eula=true`.
* **Proteção de Sessão (`session.lock`):**
  - O arquivo `world/session.lock` consiste em um inteiro de 64 bits (timestamp) travado pelo processo do Minecraft.
  - O orquestrador nunca deve iniciar qualquer rotina de escrita direta no diretório do mundo (como extração de arquivo `.zip` ou restauração de backup) se houver qualquer indicativo de que a JVM ainda está ativa, prevenindo a invalidação imediata da sessão de gravação.

---

### 4.4 Pipeline Transacional de Backups e Restauração

```mermaid
sequenceDiagram
    autonumber
    participant Core as API Hypervisor
    participant Engine as Runtime de Containers / Jobs
    participant Storage as Volume Local (/data)
    participant Archive as Storage de Arquivos (/backups)

    Note over Core,Storage: Fluxo de Backup Quente/Frio
    Core->>Engine: Dispara Job de Compressão
    Engine->>Storage: Monta /data em modo READ-ONLY
    Engine->>Archive: Executa tar -czf (exclui logs e crash-reports)
    Archive-->>Core: Notifica Conclusão do Job

    Note over Core,Storage: Fluxo de Restauração Transacional
    Core->>Core: Valida que a Instância está STOPPED (replicas=0)
    Core->>Engine: Dispara Job de Restauração
    Engine->>Storage: Limpa conteúdo antigo (find /data -delete preservando lost+found)
    Engine->>Archive: Extrai backup .tar.gz para /data
    Engine->>Storage: Normaliza permissões (chown -R 1000:1000)
    Engine-->>Core: Notifica Sucesso da Restauração
    Core->>Core: Libera Instância para Boot (Ready)
```

1. **Backup Quente vs. Backup Frio:**
   - *Backup Frio (Recomendado para Migrações/Updates):* A instância é escalada para `0`. O job monta o volume e gera o pacote comprimido `tar.gz` contendo todo o diretório `/data` (excetuando `logs/` e `crash-reports/`).
   - *Backup Quente (Em Execução):* O Hypervisor emite `save-off` via RCON para congelar gravações em chunks, seguido de `save-all flush`. O snapshot é lido com montagem `readOnly: true`, e após a leitura o comando `save-on` é enviado para o servidor.
2. **Restauração Segura:**
   - **Garantia de Offline:** O sistema bloqueia a execução de qualquer Job de restauração caso a instância não esteja rigorosamente no estado `Stopped`.
   - **Purga de Dados Anteriores:** Antes da descompactação, todos os arquivos residuais devem ser eliminados (preservando o diretório de sistema `lost+found`).
   - **Verificação de Permissões:** O processo conclui aplicando a propriedade de usuário UID `1000` em toda a árvore restaurada.

---

## 5. Interfaces, Comunicação e APIs

### 5.1 Catálogo de Endpoints da API Administrativa (REST HTTP)

#### Módulo: Gerenciamento de Instâncias (`/api/servers`)

| Método | Caminho | Contrato de Entrada (DTO) | Resposta Esperada | Regras de Negócio & Validações |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/servers/create` | `CreateServerDTO` | `201 Created` → `{ id, name, status: "provisioning" }` | Valida duplicidade de subdomínio, sanitiza nomes para OCI e injeta quota de disco e memória. |
| `GET` | `/api/servers` | Nenhum | `200 OK` → `ServerSummaryDTO[]` | Retorna lista consolidada unindo metadados do banco e estado de execução do runtime em tempo real. |
| `POST` | `/api/servers/:id/start` | Nenhum | `200 OK` → `{ message: "Instância iniciando" }` | Escala réplicas para 1; atualiza estado para `Starting`. |
| `POST` | `/api/servers/:id/stop` | Nenhum | `200 OK` → `{ message: "Instância parando" }` | Dispara graceful shutdown (`save-all` + `stop`) e escala réplicas para 0. |
| `DELETE`| `/api/servers/:id` | Nenhum | `200 OK` → `{ message: "Instância removida" }` | Exclui descritores de containers, regras de rota e remove os volumes de dados associados. |
| `GET` | `/api/servers/:id/logs` | `?tail=150` | `200 OK` → `{ logs: string }` | Lê buffer de saída do processo containerizado com supressão de ruído de conexões RCON internas. |
| `POST` | `/api/servers/:id/command` | `{ command: string }` | `200 OK` → `{ response: string }` | Sanitiza entrada contra caracteres nulos e despacha via protocolo binário RCON diretamente ao socket. |
| `GET` | `/api/servers/:id/players` | Nenhum | `200 OK` → `ServerPlayersDTO` | Consulta contagem e lista de jogadores online via RCON e cruza com a tabela de permissões do banco. |
| `GET` | `/api/servers/:id/files` | `?path=string` | `200 OK` → `{ path: string, files: FileItemDTO[] }` | Previne path-traversal (`..`), lê árvore do diretório `/data` da instância. |
| `GET` | `/api/servers/:id/file` | `?path=string` | `200 OK` → `{ content: string }` | Retorna conteúdo de arquivo de texto sanitizado. |
| `PUT` | `/api/servers/:id/file` | `?path=string`, `{ content: string }` | `200 OK` → `{ message: "Salvo com sucesso" }` | Grava arquivo em `/data` de forma atômica utilizando stream seguro de I/O. |
| `DELETE`| `/api/servers/:id/file` | `?path=string` | `200 OK` → `{ message: "Removido com sucesso" }` | Exclui arquivo ou diretório especificado garantindo restrição estrita à pasta `/data`. |
| `PATCH`| `/api/servers/:id/update` | `StartUpdateDTO` | `202 Accepted` → `{ taskId: string }` | Dispara pipeline assíncrono: para instância, gera backup preventivo, aplica versão e monitora boot. |
| `GET` | `/api/servers/:id/update/status/:taskId` | Nenhum | `200 OK` → `UpdateTaskDTO` | Retorna fase atual do pipeline de atualização (`stopping`, `backing-up`, `monitoring`, etc.). |
| `POST` | `/api/servers/:id/world/upload` | Multipart Form: `file` (.zip, .tar.gz) | `202 Accepted` → `{ message: "Extração iniciada" }` | Exige que o servidor esteja `Stopped`. Dispara Job assíncrono de descompressão e normalização de UID. |
| `PATCH`| `/api/servers/:id/domain` | `{ domain: string }` | `200 OK` → `{ message: "Domínio atualizado" }` | Atualiza o subdomínio mapeado no banco e nas tabelas de roteamento virtual do Gateway L7. |

---

#### Módulo: Catálogo e Modpacks (`/api/modpacks`)

| Método | Caminho | Parâmetros | Resposta Esperada | Regras de Negócio & Validações |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/modpacks/search` | `?query=string&limit=number&source=curseforge\|modrinth` | `200 OK` → `{ total: number, results: UniversalModpackDTO[] }` | Consulta simultânea paralela às APIs externas; unifica formato garantindo distinção de versões de jogo e releases. |
| `GET` | `/api/modpacks/:id/versions` | `?source=string` | `200 OK` → `ModpackVersionDTO[]` | Normaliza `source` (case-insensitive); busca arquivos executáveis do servidor e seus identificadores únicos. |

---

#### Módulo: Identidade e Rede Privada (`/api/tailscale`)

> **Especificação Exaustiva do Subsistema:** Para os modelos matemáticos de controle de acesso granular (Público, Grupo, Individual e Manutenção), fluxos de convites com cotas, túneis Tailcat em userspace (sem conta e sem root para usuários leigos), drivers de IPC e pirâmide formal de testes, consulte o documento autoritativo: **[SRS-SUBSISTEMA-TAILSCALE.md](SRS-SUBSISTEMA-TAILSCALE.md)**.

| Método | Caminho | Contrato de Entrada (DTO) | Resposta Esperada | Regras de Negócio & Validações |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/tailscale/invites` | `CreateInviteDTO` | `201 Created` → `InviteResultDTO` | Gera tag única para o jogador (`tag:player-<id>`), pré-cria o usuário no banco e gera chave de pré-autenticação. |
| `GET` | `/api/tailscale/devices` | Nenhum | `200 OK` → `TailscaleDeviceDTO[]` | Lista dispositivos ativos na rede restrita portando tags do ecossistema do jogo. |
| `DELETE`| `/api/tailscale/devices/:id` | Nenhum | `200 OK` → `{ message: "Dispositivo revogado" }` | Remove nó da rede privada e encerra imediatamente qualquer sessão de jogo ativa no Gateway. |

---

#### Módulo: Administração e ACL (`/api/admin`)

| Método | Caminho | Ação |
| :--- | :--- | :--- |
| `GET` | `/api/admin/players/online` | Retorna lista de sockets ativos em tempo real no Gateway L7 com mapa de IP e servidor conectado. |
| `POST` | `/api/admin/users` | Cadastro de jogador (`tailscaleUserId`, `minecraftNick`, `role`). |
| `POST` | `/api/admin/groups` | Criação de grupos de acesso (ex.: "Membros", "Administradores"). |
| `POST` | `/api/admin/groups/:id/users` | Associação de usuário a grupo de acesso. |
| `DELETE`| `/api/admin/groups/:id/users/:userId` | Remoção de usuário do grupo com disparo imediato de **Smart Kick** no Gateway caso esteja jogando em servidor restrito. |
| `POST` | `/api/admin/groups/:id/servers` | Associação de servidor a grupo de acesso. |
| `DELETE`| `/api/admin/groups/:id/servers/:serverId` | Desvinculação de servidor do grupo de permissões. |

---

### 5.2 Contratos de Dados (DTOs Principais)

```json
// CreateServerDTO
{
  "name": "ATM9-Survival",
  "source": "CurseForge", // "CurseForge" | "Modrinth" | "Vanilla"
  "serverSoftware": "paper", // "paper" | "vanilla" (relevante quando source === "Vanilla")
  "modpackId": "all-the-mods-9",
  "modpackSlug": "all-the-mods-9",
  "version": "123456", // ID do arquivo na CurseForge ou tag da versão no Modrinth/Mojang
  "memoryAllocated": "8G",
  "viewDistance": 8,
  "simulationDistance": 6,
  "hibernateAfterMinutes": 30 // null = Always On
}

// UniversalModpackDTO
{
  "id": "all-the-mods-9",
  "slug": "atm9",
  "title": "All the Mods 9",
  "description": "Modpack expansivo com tecnologia e magia.",
  "author": "ATM Team",
  "downloads": 1500000,
  "supportedGameVersions": ["1.20.1"],
  "loader": "Forge", // "Forge" | "NeoForge" | "Fabric" | "Quilt"
  "iconUrl": "https://...",
  "categories": ["Tech", "Magic", "Quests"],
  "updatedAt": "2026-08-15T12:00:00Z",
  "source": "CurseForge"
}

// CreateInviteDTO
{
  "playerName": "JoaoGamer",
  "userId": "uuid-opcional-se-jogador-existente",
  "scope": "individual", // "global" | "group" | "individual"
  "serverIds": ["atm9-srv-uuid"],
  "expiresInDays": 7
}

// InviteResultDTO
{
  "playerName": "JoaoGamer",
  "authKey": "tskey-auth-xxxxxx-xxxxxx",
  "joinUrl": "https://funnel.dominio.interno/join#tskey-auth-xxxxxx-xxxxxx",
  "expiresAt": "2026-09-11T14:00:00Z",
  "tags": ["tag:player-a1b2c3d4", "tag:atm9-srv-uuid"],
  "authorizedServers": [
    {
      "name": "ATM9-Survival",
      "address": "atm9.mine.dominio.interno"
    }
  ]
}
```

---

## 6. Regras de Negócio Ocultas e Peculiaridades de Minecraft

### 6.1 Tratamento do Handshake e Login em Dois Estágios (Gateway L7)

```mermaid
sequenceDiagram
    autonumber
    participant Client as Cliente de Jogo
    participant GW as Gateway L7
    participant Tailscale as API / Cache Tailscale
    participant DB as Banco de Dados (Prisma/Relacional)
    participant MC as Servidor Minecraft

    Client->>GW: Conexão TCP iniciada
    Client->>GW: Pacote 1: Handshake (0x00, ServerAddress, NextState=2)
    GW->>GW: Pausa Stream (clientSocket.pause())
    GW->>Tailscale: Resolve Identidade por IP (100.X -> tag:player-ID ou userId)
    GW->>DB: Valida se Jogador possui Grupo com Acesso ao Servidor
    
    alt Sem Permissão de Rede
        GW->>Client: Envia Pacote de Disconnect (JSON Text Formatado)
        GW->>Client: Destrói Socket (clientSocket.destroy())
    else Autorizado na Camada de Rede
        Client->>GW: Pacote 2: Login Start (String username)
        GW->>DB: Valida se Nickname já pertence a outro Usuário (Anti-Impersonation)
        alt Nickname Violado
            GW->>Client: Disconnect: "Nickname pertence a outro jogador registrado"
            GW->>Client: Destrói Socket
        else Nickname Válido
            GW->>MC: Estabelece Conexão TCP Interna
            GW->>MC: Reinjeta Handshake + Login Start via pipe()
            GW->>GW: Despausa Stream (clientSocket.resume())
            Note over Client,MC: Sessão de Jogo Transparente Bidirecional
        end
    end
```

#### A. Proteção contra Impersonação em Modo Híbrido (`ONLINE_MODE=false`)
1. **O Problema de Domínio:** Em servidores corporativos/privados que desejam admitir clientes alternativos (offline/pirata) junto a contas oficiais da Mojang, a variável `ONLINE_MODE` deve ser `false`. Isso faz com que a engine do Minecraft aceite qualquer nome de usuário sem autenticar a posse da conta junto à Mojang, gerando UUIDs offline baseados no hash `"OfflinePlayer:<username>"`. Qualquer usuário poderia entrar fingindo ser outro jogador.
2. **A Regra de Negócio Implementada no Gateway:**
   - O Gateway inspeciona não apenas o Handshake, mas também o pacote imediatamente subsequente: **`Login Start`** (Packet ID `0x00` no estado `Login`).
   - O payload do `Login Start` contém a string pura do `username` declarado pelo cliente.
   - O Gateway compara esse `username` com o `minecraftNick` registrado no banco de dados para a respectiva identidade de rede (resolvida via IP da VPN privada).
   - **Regra de Auto-Adoção:** Se o usuário é novo e não possui `minecraftNick` registrado no banco, o sistema grava o nome declarado no primeiro login, bloqueando esse nickname permanentemente para aquela identidade de rede.
   - **Regra de Rejeição:** Se um usuário tentar autenticar com um nickname pertencente a outro cadastro, o Gateway emite o pacote de encerramento de sessão formatado (`createDisconnectPacket`) e fecha o socket imediatamente.

#### B. Restauração de Skins em Servidores Offline
Como o modo offline impede o handshake com os servidores de sessão da Mojang, o cliente do jogo não recebe as texturas de skin originais assinadas, exibindo a skin padrão (Steve/Alex).
- **Motores com Plugins (Paper/Purpur):** O provisionador injeta automaticamente o plugin **`SkinsRestorer`**, que consulta a API pública da Mojang diretamente pelo nickname e injeta o blob base64 da textura assinada na sessão do jogador.
- **Modpacks Puros (Fabric/Forge/NeoForge):** Para modpacks que não suportam plugins Bukkit, o provisionador deve incluir nos templates mods de servidor como **`CustomSkinLoader`** ou **`Fabric Tailor`** para carregamento automático de skins sem intervenção manual.

#### C. Compatibilidade com Chat Seguro (`enforce-secure-chat: false`)
A partir do Minecraft 1.19, a Mojang introduziu validação criptográfica de mensagens de chat assinadas pelo cliente. Clientes alternativos/piratas não possuem chaves públicas atestadas pela Microsoft.
- **Configuração Obrigatória de Bootstrap:** O provisionador do Hypervisor deve configurar obrigatoriamente `enforce-secure-chat=false` no arquivo `server.properties` e `paper-global.yml` de todas as instâncias criadas, prevenindo que jogadores offline sejam expulsos pela JVM com erros de *"Missing profile public key"*.
- **Experiência Zero-Atrito:** Como a segurança de identidade é garantida na camada de rede pelo Gateway L7 e Tailscale, o ambiente é 100% livre de plugins intrusivos de autenticação por chat (`/login` e `/register`), permitindo que convidados piratas entrem diretamente no mundo.

---

### 6.2 Idiossincrasias de Protocolo e Sistema de Arquivos

| Peculiaridade do Minecraft | Comportamento Implícito do Domínio | Tratamento Obrigatório no Orquestrador |
| :--- | :--- | :--- |
| **Marcadores de Modloader no Handshake** | Launchers Forge e NeoForge enviam extensões no campo de endereço (ex.: `srv.dominio\0FML3\0` ou `srv.dominio\0FML\0`). | O decodificador de rede deve truncar a string no primeiro caractere nulo (`\0`) antes de realizar a resolução de rota no banco de dados. |
| **Limpeza de Trava de Sessão (`session.lock`)** | O arquivo `session.lock` impede duas instâncias de lerem a mesma pasta de mundo. Se a JVM sofrer crash repentino, o arquivo pode reter timestamps inconsistentes. | Durante a inicialização de um container novo após crash, a rotina de boot valida se a trava pertence a um processo zumbi ativo no mesmo nó antes de reabrir os arquivos de região. |
| **Caracteres Especiais em Comandos RCON** | O protocolo RCON delimita payloads de string com dois bytes nulos consecutivos (`0x00 0x00`). | Parâmetros com quebras de linha ou caracteres de escape em comandos de console devem ser sanitizados para evitar o descompasso de pacotes no socket RCON. |
| **Consistência do Formato Universal de Modpacks** | Modrinth e CurseForge utilizam terminologias divergentes. Modrinth chama de "versão" a release do modpack, enquanto CurseForge lista arquivos de compilação vinculados às versões suportadas do motor de jogo. | O contrato do Hypervisor deve desacoplar explicitamente `supportedGameVersions` (ex.: Minecraft 1.20.1) de `modpackReleaseVersion` (ex.: ATM9 build v0.2.5). |

---

## 7. Casos de Borda e Falhas Tratadas (ou Ignoradas)

### 7.1 Análise Comparativa de Falhas de Implementação vs. Requisitos Funcionais Reais

Esta seção documenta explicitamente as fragilidades encontradas no código legado e estabelece os requisitos funcionais formais para a nova arquitetura:

#### 1. Injeção de Comandos e RCE na Execução de RCON
- **Diagnóstico:**
  *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
  O código legado concatena strings diretamente em `kubectl exec ${podName} -- rcon-cli "${command}"` sem validação, permitindo que um usuário execute comandos arbitrários no nó do cluster escapando com `"` ou subshells `$(...)`; o requisito funcional real é **comunicação estrita através do protocolo de aplicação RCON sobre soquetes de rede dedicados sem invocação de interpretadores de shell do sistema operacional**.

#### 2. Ausência de Autenticação e Autorização na API HTTP
- **Diagnóstico:**
  *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
  Os controladores HTTP do backend operam sem nenhuma camada de autenticação (`@UseGuards`/JWT), deixando endpoints com poderes destrutivos (`DELETE /api/servers/:id`, `POST /command`) abertos; o requisito funcional real é **um Modelo de Controle de Acesso Baseado em Papéis (RBAC) com autenticação obrigatória via tokens assinados em todos os endpoints administrativos**.

#### 3. Dessincronização entre Estado do Orquestrador e Banco Relacional
- **Diagnóstico:**
  *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
  O método `createServer` cria os recursos no Kubernetes, mas não cria o registro correspondente no banco de dados relacional (Prisma), enquanto o Gateway L7 rejeita 100% das conexões se o domínio não existir no banco; o requisito funcional real é **um padrão de Transação Distribuída ou Loop de Reconciliação (Reconciliation Loop)**: o orquestrador deve garantir atomicidade entre o cadastro de roteamento no banco e os recursos de execução no cluster, sincronizando periodicamente o estado desejado com o estado observado.

#### 4. Identidade Colapsada por Dispositivos com Tags
- **Diagnóstico:**
  *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
  O código original consulta o usuário do dispositivo Tailscale e atribui o identificador sintético genérico `"tagged-devices"` para todos os nós que possuem tags de rede, colapsando todos os jogadores convidados na mesma identidade; o requisito funcional real é **atribuir uma tag exclusiva de identificador de jogador por convite (`tag:player-<uuid>`) pré-cadastrada no banco de dados relacional** e implementar resolução dupla de identidade: buscar por tag de jogador primeiro, e por identificador de usuário mestre (admin) apenas na ausência de tags.

#### 5. Exaustão de Recursos por Polling Ativo de Processos
- **Diagnóstico:**
  *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
  O painel web e o worker de hibernação disparam milhares de execuções de subprocessos (`kubectl exec`) por dia via polling contínuo para verificar logs e contagem de jogadores; o requisito funcional real é **gestão reativa de presença em memória no próprio Gateway L7 (que já monitora conexões ativas) e streaming contínuo de logs via WebSocket/SSE**, pausando qualquer tráfego quando as abas do navegador estiverem ocultas (`visibilitychange`).

#### 6. Persistência Volátil de Banco de Dados
- **Diagnóstico:**
  *O código faz X de forma frágil para resolver o problema Y; o requisito funcional real é Y:*
  O banco de dados de aplicação (SQLite) foi configurado para ser montado em caminho de sistema de arquivos inconsistente com o CWD do container e apontando para o disco local do desenvolvedor em manifesto de produção; o requisito funcional real é **persistência em volume gerenciado desacoplado do código-fonte ou utilização de banco relacional externo de produção com backups transacionais periódicos**.

---

### 7.2 Matriz de Tratamento de Casos de Borda Críticos

```mermaid
flowchart TD
    subgraph OOM Hazard Detection
        JVMAlloc[JVM Aloca Heap Xmx]
        OffHeap[Despesas Off-Heap / Metaspace / Netty]
        CGMonitor{Consumo Total > Cgroup Limit?}
        OOMKill[Linux OOM Killer: SIGKILL Repentino]
        GracefulOOM[JVM OutOfMemoryError: Log & Crash-Report]
        
        JVMAlloc --> OffHeap
        OffHeap --> CGMonitor
        CGMonitor -- "Sem Margem (+1G)" --> OOMKill
        CGMonitor -- "Com Margem Adequada" --> GracefulOOM
    end
```

| Cenário de Borda | Risco para o Sistema | Comportamento Esperado / Solução Requerida |
| :--- | :--- | :--- |
| **Vazamento de Sockets TCP (Socket Descriptor Leak)** | Clientes que desconectam abruptamente deixam o socket do lado do servidor aberto no Gateway, esgotando os descritores de arquivo do sistema operacional. | Monitoramento de eventos de ciclo de vida do socket (`error`, `close`, `timeout`). O encerramento de um dos lados do pipe deve disparar obrigatoriamente `destroy()` explícito no socket oposto e purga imediata do registro em memória. |
| **Processos Zumbis / Órfãos após SIGKILL** | Um processo Java travado em I/O de disco pode não morrer imediatamente, impedindo a reinicialização da instância por bloqueio de porta ou `session.lock`. | O orquestrador deve aguardar a liberação do identificador de processo (PID) e garantir a liberação das portas antes de permitir novo agendamento da instância. |
| **Concorrência em Upload de Mundos** | Extração de mapas via `.zip` com o servidor em execução sobrescreve chunks ativos enquanto a JVM tenta salvá-los, gerando corrupção irreversível do mundo. | Bloqueio de API: a rota de upload rejeita a operação com código HTTP `409 Conflict` se a instância não estiver no estado `Stopped` com réplicas iguais a 0. |
| **Múltiplos Convites para o Mesmo Jogador** | O administrador gera convites repetidos para o mesmo usuário (ex.: celular e notebook), criando usuários duplicados e fragmentando o nickname e o inventário. | O modelo de dados deve desacoplar o **Usuário** de seus **Dispositivos/Tags**, permitindo relação `1:N` onde uma conta de jogador agrega múltiplas tags de autenticação sem duplicar permissões ou regras de nickname. |
| **Revogação de Permissão em Tempo Real (Smart Kick)** | O administrador remove o jogador de um grupo enquanto ele está no servidor, mas a sessão TCP permanece aberta por horas. | O serviço de controle despacha um evento de revogação para o Gateway L7 informando o IP e o domínio afetado; o Gateway localiza o socket em sua tabela de conexões ativas, envia o pacote de desconexão formatado e destrói o socket na hora. |

---

## 8. Arquitetura Alvo Recomendada (Visão Tecnológica)

Para a recriação do projeto a partir do zero, a arquitetura deve seguir os princípios modernos de **Engenharia de Plataforma e Infraestrutura Distribuída**:

```mermaid
graph TB
    subgraph Core Control Plane
        direction TB
        APIServer[API Gateway & Control Server - Tipado & Seguro]
        L7Proxy[Gateway TCP L7 Assíncrono de Baixa Latência]
        StateManager[Reconciliador Contínuo de Estado - State Engine]
    end

    subgraph Armazenamento & Estado
        RelationalDB[(Banco de Dados de Produção - Usuários/Rotas/ACL)]
        LocalNVMe[(Volume de Alta Velocidade NVMe - Dados do Mundo)]
    end

    subgraph Isolamento de Infraestrutura
        ContainerHost[Runtime de Containers OCI - Cgroups v2]
    end

    APIServer --> RelationalDB
    L7Proxy --> RelationalDB
    StateManager --> RelationalDB
    StateManager --> ContainerHost
    ContainerHost --> LocalNVMe
    L7Proxy --> ContainerHost
```

1. **Desacoplamento de Responsabilidades:**
   - **Gateway L7 de Tráfego:** Módulo especializado em I/O não bloqueante para decodificação rápida do protocolo Minecraft, mantendo em memória o mapa de sessões ativas e atuando como guardião de identidade.
   - **Control Plane & Reconciler:** Serviço responsável por aplicar as mutações no cluster, executando loops de reconciliação contínuos para manter o estado desejado (Declarative State Machine).
2. **Abstração de Provedores de Jogo (`GameProvider Interface`):**
   - Criação de uma camada de isolamento para regras de negócio específicas do jogo (parâmetros de linha de comando, formato de pacotes de rede, modelo de roteamento por domínio ou porta), permitindo a futura inclusão de outros motores de jogos sem modificação no núcleo do orquestrador.
3. **Persistência Confiável:**
   - Separação mandatória entre os metadados relacionais do Hypervisor (usuários, permissões, grupos, instâncias) e os dados brutos de blocos e entidades dos mundos de jogo (`/data` em NVMe local com quotas de filesystem isoladas).
