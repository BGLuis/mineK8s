# 🎮 Projeto MineKubernetes (MineKube Dashboard)

**Visão Geral:** 
Um painel de gerenciamento de servidores de Minecraft "Pterodactyl-like" construído nativamente sobre Kubernetes (K3s). O grande diferencial é sua orquestração dinâmica e arquitetura robusta voltada para Modpacks pesados (CurseForge e Modrinth), escalando containers sob demanda em uma infraestrutura on-premise (Proxmox/Arch Linux).

---

## ✅ 1. Funcionalidades Implementadas (O que já temos)

### 🏗️ Arquitetura e Orquestração (NestJS + Kubernetes API)
- **Provisionamento Dinâmico:** Ao solicitar um servidor, a API cria automaticamente um `Deployment`, um `PersistentVolumeClaim (PVC)` e um `Service` (ClusterIP).
- **Armazenamento:** Migrado de Longhorn para `local-path` devido a problemas de corrupção, garantindo I/O mais rápido e estável para os mundos.
- **Proxy Reverso (SNI):** Integração com o `itzg/mc-router` para roteamento TCP automático. Mapeamos um subdomínio (ex: `atm.meuservidor.com`) direto para a porta 25565 do Pod no K8s, sem precisar expor as portas individualmente.
- **Imagem Base Docker:** Utilização intensiva da poderosa imagem `itzg/minecraft-server` com injeção automática de variáveis (`TYPE=AUTO_CURSEFORGE`, `CF_SLUG`, `MODRINTH_MODPACK`, etc).

### 🛒 Marketplace de Modpacks e Vanilla (Angular)
- **Integração com 2 Grandes Repositórios:** Busca simultânea nas APIs do **Modrinth** e **CurseForge**, unificando os resultados na mesma interface.
- **Instalador de Minecraft Vanilla:** Um card fixo para provisionar instâncias de Minecraft puras direto da Mojang (com opção de escolher a versão).
- **Seletor de Versões:** Um Modal interativo que consulta o histórico de versões do modpack (via APIs de terceiros) e permite ancorar o download em uma versão exata ou na "mais recente" (Latest).

### 🖥️ Painel de Controle e Gerenciamento (Dashboard)
- **Listagem em Tempo Real:** Leitura direta do status dos Pods no cluster K8s para exibir "Online" ou "Offline".
- **Botões de Energia:** 
  - *Ligar / Desligar:* Controla o scale down (Replicas = 0) para hibernar o servidor e economizar RAM no host.
  - *Excluir:* Apaga o Deployment, a Service e destrói o Volume (PVC), limpando completamente o servidor.
- **Terminal interativo (RCON):**
  - Um console "Hacker" embutido na UI.
  - Injeção bidirecional: Envia comandos RCON para o cluster via `kubectl exec rcon-cli` e extrai as respostas.
  - *Auto-completar inteligente:* Sistema híbrido no Frontend para sugerir comandos base (`/op`, `/time`, `/gamemode`).
  - *Filtro anti-spam:* Ocultação de logs de poluição RCON (ex: "RCON Listener", "Rcon connection from...").
- **Explorador de Arquivos (File Manager):**
  - Navegação visual pelas pastas do disco do servidor (diretório `/data`).
  - Leitura de diretórios em tempo real convertendo saídas de terminal do K8s (`ls -lah`) para objetos JSON legíveis no Angular.
  - Editor visualizador de código para arquivos de texto (ex: `server.properties`, `banned-players.json`).

---

## 🚧 2. Funcionalidades Pendentes (O que ainda vamos implementar)

### 💾 Sistema de Backups (Snapshots de Volumes) - *Missão Atual*
- Criar a capacidade de gerar **Snapshots de PVC** antes de fazer atualizações perigosas.
- Um menu na interface para criar backups sob demanda do mundo e restaurar o servidor para um momento anterior caso o Modpack corrompa a base de dados.

### ✍️ File Manager Avançado
- **Edição e Escrita:** Permitir que o usuário digite no Editor de Arquivos e clique em "Salvar", reescrevendo o arquivo direto no Pod Kubernetes.
- **Upload / Download:** Botões para importar mapas customizados (`.zip`) ou baixar backups locais do mundo.
- **Deleção:** Permitir a exclusão de pastas de mods ou configurações corrompidas pela interface.

### 📊 Monitoramento de Recursos
- Instalar e consultar o **Metrics Server** do Kubernetes para criar gráficos em tempo real no dashboard.
- Exibir consumo de **RAM** (Mundial e por Servidor) e carga de **CPU**.

### 👥 Painel Visual de Jogadores
- Criar uma aba dedicada de "Jogadores" no servidor.
- Listar a Array de jogadores logados, puxando o rosto dos avatares deles (ex: via API Minotar).
- Botões visuais de UI de 1 clique para "Kickar", "Banir", "Matar" e "Dar OP", em vez de precisar digitar comandos no Terminal RCON.
- Whitelist Switcher: Uma alavanca na UI para habilitar e desabilitar a Whitelist dinamicamente.

---

*Gerado automaticamente pelo agente Antigravity na arquitetura de pares com o Arquiteto de Sistemas Luis.*
