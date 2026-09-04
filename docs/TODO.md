# 📋 Controle de Tarefas e Funcionalidades (MineKube Dashboard)

Este arquivo é um checklist em tempo real do estado do projeto. Ele serve para rastrear o que já foi validado em produção, o que está em área de "Staging" (código feito, mas não integrado) e o que ainda precisa ser codificado no futuro.

---

## ✅ 1. Concluído (Em Produção)
As tarefas abaixo já foram programadas, testadas e estão operando 100% no código fonte atual do Frontend e do Backend.

- [x] **Orquestrador Base de Kubernetes:** A API NestJS consegue provisionar `Deployments`, `Services` e `PersistentVolumeClaims` sob demanda baseados na imagem `itzg/minecraft-server`.
- [x] **Arquitetura de Rede SNI:** Integração com o proxy `mc-router` para roteamento dinâmico via hostname sem abrir múltiplas portas no host físico.
- [x] **Painel de Meus Servidores:** Leitura em tempo real do status dos pods direto da API do K8s (exibição de Online/Offline na UI).
- [x] **Controles de Energia:** Botões funcionais na UI para Ligar (Scale 1), Desligar (Scale 0) e Excluir Servidor (Deleta tudo, incluindo o PVC).
- [x] **Console RCON Interativo:** Terminal web que injeta comandos via Kube API (`kubectl exec rcon-cli`) e faz stream de logs filtrando spams indesejados.
- [x] **Integração Modrinth & CurseForge:** Frontend puxa galerias de modpacks das APIs originais e unifica na UI em tempo real.
- [x] **Instalação Minecraft Vanilla:** Botão estático e fluxo customizado para subir servidores Minecraft clássicos, ignorando injeção de mods.
- [x] **Seletor de Versões de Modpack:** Modal visual acionado ao clicar em um Modpack. Ele busca as versões históricas do mod e permite o deploy fixo em uma versão específica (injeção via `CF_FILE_ID` ou equivalente).
- [x] **Leitor de Arquivos do Servidor:** Aba de gerenciamento de arquivos capaz de rodar comandos de leitura (`ls -lah` e `cat`) para exibir diretórios e textos dentro dos pods pela UI do Angular.
- [x] **Gateway TCP L7 & ACLs em DB:** Proxy TCP interceptando SNI e consultando permissões do jogador no banco Prisma + SQLite para autorizar conexões ("Smart Kicks" implementados).
- [x] **Integração de Identidade Tailscale:** Mapeamento do IP `100.x.x.x` local para recuperar o e-mail do dono via `tailscale status --json` no NestJS.
- [x] **Bot de Healthcheck E2E (Pod):** Infraestrutura (Dockerfile e K8s CronJob) para rodar o `mineflayer` com testes reais de logon nos servidores.

---

## 🏗️ 2. Código Gerado e Testado (Aguardando Integração)
As tarefas abaixo já foram desenvolvidas por Sub-Agentes Inteligentes e aprovadas pelos Testes Unitários do Jest. Os códigos estão vivos na pasta isolada `src/tmp_agents/`, bastando plugar no circuito principal.

- [x] **Sistema de Backups (Job Compressor):** Rotina NestJS para subir um K8s Job, anexar o PVC do servidor e um PVC de Backups, e gerar um pacote `.tar.gz` do mundo de forma isolada.
- [ ] **Integração VPN Tailscale (Zero-Trust):** Injetor YAML que acopla o sidecar do `tailscale/tailscale` em Deployments de Minecraft, garantindo acesso ultra-secreto sem passar pelo proxy público.
- [x] **Write/Delete no File Manager:** Funções no backend via `child_process` (`kubectl exec`) manipulando pipes de STDIN para permitir que a dashboard salve edições de arquivos ou exclua mapas do K8s.

---

## 🚧 3. Pendente (Roadmap Futuro)
As tarefas abaixo são funcionalidades prometidas ou discutidas que ainda não possuem código escrito.

- [x] **Tela/Fluxo de Restauração de Backups:** Criar a UI para listar os `.tar.gz` armazenados e a lógica do backend para fazer o processo reverso do Job de Compressão (apagar `/data` atual e extrair o backup no lugar).
- [x] **Integração Visual do File Manager (UI):** Adaptar a aba de Arquivos no Angular para consumir as funções de edição, criando um botão de "Salvar" no Code Editor e ícones de "Lixeira" para deletar.
- [x] **Botão UI do Tailscale:** Adicionar uma chave de configuração (Toggle) na tela de criação de servidor permitindo ao usuário "Ativar Rede Segura (Tailscale)" inserindo sua `AuthKey`.
- [x] **Gerenciamento de Jogadores (Player List):** Criar uma aba dedicada no Frontend listando avatares de quem está online, com botões para `Kick`, `Ban` e `Op`.
- [x] **Monitoramento de Recursos (Opcional):** Integração com K8s Metrics Server para exibir gráficos ao vivo de uso de RAM e CPU de cada servidor de Minecraft na dashboard.
- [x] **Agendamento de Hibernação Automática (Sleep Mode):** Um worker no NestJS que checa se os servidores estão com 0 jogadores online por X tempo e os desliga sozinhos para poupar memória do nó físico. Suporta modo Always On por servidor.
- [ ] **Integração do Banco de Dados no Frontend:** Consumir os endpoints `/api/admin/*` já construídos no backend para gerenciar Servidores, Usuários e Grupos diretamente no painel visual.
- [ ] **Panorama 3D (Fundo Animado BlueMap):** Integrar e expor a porta `8100` do mod BlueMap nos K8s Services e usar um iframe no Frontend para rodar um fundo 3D imersivo.
