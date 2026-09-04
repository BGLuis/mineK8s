# 🤖 Contexto para a IA de Frontend (MineKubernetes)

> **Instrução para a IA de Destino:** O projeto a seguir é um painel de gerenciamento corporativo de Minecraft sobre Kubernetes (estilo Pterodactyl, porém nativo do K8s). O foco deste documento é lhe dar total entendimento das capacidades que a API backend oferece para que você construa/refatore as telas do Frontend da melhor e mais eficiente forma.

---

## 🏗️ 1. Contexto do Sistema e Stack

- **Objetivo:** Uma Dashboard que lê diretamente pods do Kubernetes via APIs em tempo real, gerando e orquestrando servidores de Minecraft puramente baseados na imagem docker `itzg/minecraft-server`.
- **Frontend:** Angular 18+, Standalone Components, Signals, Observables, Vanilla CSS ou Tailwind.
- **Backend:** NestJS hospedado em `http://localhost:3000`. Toda comunicação com a infra do servidor já é abstraída pelo NestJS, o Frontend apenas consome REST.
- **Infra:** O banco de dados do estado _é o próprio Kubernetes_. Não há MySQL ou MongoDB. O Frontend faz polling rápido e o Backend reage injetando YAML no Cluster.

---

## 📡 2. Mapeamento das Capacidades da API NestJS

Abaixo estão todos os endpoints que o Frontend pode (e deve) consumir para construir a interface. As chamadas podem demorar (especialmente provisionamento), portanto o frontend deve lidar com telas de loading.

### 🎮 A. Gerenciamento de Servidores (`/api/servers`)

- `GET /api/servers`
    - **O que faz:** Retorna a lista de todos os servidores de Minecraft no cluster.
    - **Retorno esperado:** Array de objetos com `{ id: string, name: string, status: "Online" | "Offline", readyReplicas: number, desiredReplicas: number, connectionPort: number }`.
- `POST /api/servers/create`
    - **O que faz:** Provisiona um servidor novo no K8s. Cria Volume (PVC), Deployment e Service.
    - **Payload (Body):** `{ name: string, modpackId: string, version?: string, type?: string }`
- `POST /api/servers/:id/start`
    - **O que faz:** Altera a escala do Deployment do K8s para 1 (Liga o servidor).
- `POST /api/servers/:id/stop`
    - **O que faz:** Altera a escala do Deployment do K8s para 0 (Hiberna o servidor, mantendo os dados no disco).
- `DELETE /api/servers/:id`
    - **O que faz:** Operação perigosa. Deleta completamente o pod, apaga a Service e destrói o disco (PVC) com todos os mapas.
- `GET /api/servers/:id/players`
    - **O que faz:** Via RCON interno, lista todos os jogadores logados atualmente.

### 🛠️ B. Terminal RCON / Console (`/api/servers`)

- `GET /api/servers/:id/logs`
    - **O que faz:** Faz stream das últimas centenas de linhas de log do Pod Kubernetes. Ideal para uma tela de console/terminal preta que atualiza a cada 3~5 segundos via polling ou WebSocket (se implementado).
- `POST /api/servers/:id/command`
    - **O que faz:** Envia um comando administrativo para o servidor K8s via comando RCON do CLI `itzg`.
    - **Payload (Body):** `{ command: "time set day" }` (sem a barra `/` inicial). O retorno deve ser parseado para injetar na tela do console do frontend.

### 🗂️ C. File Manager do Servidor (`/api/servers` e FileLogic API nova)

- `GET /api/servers/:id/files?path=/data`
    - **O que faz:** Lista pastas e arquivos de um diretório dentro do Pod do servidor de Minecraft.
    - **Retorno:** JSON simulado derivado de um comando `ls -lah` no container. Retorna `{ type: "file" | "dir", name: string, size: string, date: string }`.
- `GET /api/servers/:id/file?path=/data/server.properties`
    - **O que faz:** Retorna todo o conteúdo texto de um arquivo usando comando `cat` interno. Ideal para jogar num Code Editor na UI (ex: AceEditor ou Monaco).
- _(Novo Endpoint a ser plugado)_ `POST /api/servers/:id/file/save`
    - **O que faz:** Sobrescreve/salva o texto editado no Frontend direto no Pod.
- _(Novo Endpoint a ser plugado)_ `DELETE /api/servers/:id/file/delete`
    - **O que faz:** Apaga permanentemente um arquivo mapeado dentro do pod K8s.

### 🛍️ D. Marketplace e Modpacks (`/api/modpacks`)

- `GET /api/modpacks/search?q=query&limit=10`
    - **O que faz:** Comunica em tempo real com as APIs oficias do **Modrinth** e do **CurseForge**. Devolve uma array unificada de resultados. Se `q` for vazio, retorna os populares.
    - **Retorno esperado:** Array de modpacks `{ id: string, title: string, description: string, author: string, downloads: number, iconUrl: string, source: "Modrinth" | "CurseForge" }`.
- `GET /api/modpacks/:id/versions?source=CurseForge`
    - **O que faz:** Lista o histórico completo de todas as versões do modpack (ex: v1.0, v1.2) para que o usuário escolha qual delas instalar.

### 🔒 E. Redes e Segurança Privada (Em Integração / Tailscale)

- _(A Ser Plugado)_ `POST /api/servers/:id/tailscale`
    - **O que faz:** Modifica o cluster para injetar o Sidecar do Tailscale VPN em servidores ultra-privados que não devem rodar pelo Proxy público.

### 💾 F. Backups e Discos (Em Integração)

- _(A Ser Plugado)_ `POST /api/backups/create/:serverId`
    - **O que faz:** Dispara um Job do Kubernetes que intercepta o disco do minecraft e roda uma rotina de empacotamento `.tar.gz` (`world`) salvando no cluster frio. O frontend precisa reagir com uma barra de progresso ou loader de bloqueio (pois Backups de mapas pesados podem levar minutos).

---

## 🎨 3. Diretrizes de UX para a UI

Ao construir essa interface, foque na usabilidade e na clareza:

1. **Empty States:** Se um servidor retornar vazio ou uma pesquisa de modpack não achar nada, exiba mensagens amigáveis informando a ausência de dados.
2. **Resiliência e Feedback Visual:** Quase tudo que a API faz gera espera (baixar mods do CurseForge, ligar container no Linux, gerar mundos Java). Mostre Feedback constante (Spinners, "Inicializando Servidor", "Descompactando Mods"). O botão de ligar servidor deve desativar e exibir um Loading imediatamente para evitar double-clicks.
