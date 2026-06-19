# 🤖 Gemini Project Rules & Context (MineKubernetes)

Este arquivo serve como a **memória principal e o guia de diretrizes arquiteturais** para qualquer sessão do Gemini (ou outros assistentes de IA) trabalhando no projeto **Dashboard / MineKubernetes**. Ao iniciar uma nova sessão ou retomar o projeto, a IA deve ler este arquivo para carregar o contexto completo.

---

## 📌 1. Identidade do Projeto

- **Nome:** MineKubernetes (Dashboard)
- **Objetivo:** Um painel de controle corporativo "Pterodactyl-like", mas 100% nativo para Kubernetes (K3s). Permite deploy dinâmico de servidores de Minecraft (Foco em Modpacks pesados do CurseForge/Modrinth) e Minecraft Vanilla.
- **Ambiente:** Infraestrutura Bare-metal / Proxmox rodando K3s no Arch Linux.
- **IP do Host Principal:** `192.168.0.218`

## 🛠️ 2. Tech Stack Oficial

- **Frontend:** Angular (Standalone Components, Signals, Observables). Design deve focar em **Aesthetics** (Dark Mode premium, glassmorphism, micro-interações, cores esmeralda/indigo).
- **Backend:** NestJS hospedado internamente.
- **Kubernetes API:** Uso pesado da biblioteca `@kubernetes/client-node` no NestJS.
- **Container Base (Minecraft):** Imagem oficial `itzg/minecraft-server` (A "bala de prata" para subir os servidores).
- **Armazenamento:** K8s StorageClass `local-path` (escolhido para evitar corrupção e lentidão I/O).
- **Proxy/Ingress:** `itzg/mc-router` para roteamento dinâmico SNI via TCP.

---

## 🧠 3. O Que Já Está Pronto (Core)

1. **Provisionador Dinâmico:** O K8s sobe PersistentVolumeClaims, Services e Deployments automaticamente via API do NestJS.
2. **Terminal RCON:** Console hacker embutido no Angular. A API faz túnel direto pro K8s via `kubectl exec rcon-cli` e extrai as respostas em tempo real, omitindo spam.
3. **Marketplace Modrinth/CurseForge:** Galeria que puxa modpacks via API externa, listando as versões e permitindo escolher qual instalar (ou Vanilla puro).
4. **Leitor de Arquivos (Read-only):** O painel consegue listar a árvore de pastas `/data` do pod através de scripts de injeção em terminal e exibir `server.properties` e outros `.json`.
5. **Gateway TCP L7 & ACLs via DB:** Proxy reverso TCP intercepta conexões do Minecraft. Usamos Prisma + SQLite para validar o acesso de usuários a servidores específicos antes de rotear o tráfego.
6. **Mapeamento de Identidade (Tailscale):** O NestJS busca o dono do IP do jogador via API Local do Tailscale para realizar a autenticação "Smart" (sem senhas extras).
7. **Infraestrutura de Testes (Bot Pod):** Configurado o projeto de testes E2E com `mineflayer` executando no K8s via CronJob para validar o "Health" real do jogo.

---

## 🚧 4. O Que Estamos Construindo (Roadmap Atual)

As funcionalidades abaixo **tiveram o código gerado em pastas de staging (`src/tmp_agents/`) e já foram validadas por Testes Unitários**, precisando apenas serem consolidadas de vez no ecossistema:

1. **Sistema Avançado de Backups:** Como `local-path` não aceita K8s CSI Snapshots de bloco nativamente, estamos usando K8s Jobs para comprimir (`tar.gz`) a pasta `/data/world` para um PVC de arquivamento secundário.
2. **Redes "Zero-Trust" (Tailscale Sidecar):** Injeção dinâmica de sidecars `tailscale/tailscale:latest` atrelados aos pods, permitindo servidores privados isolados fora do roteamento SNI do proxy.
3. **File Manager Direto (Write/Delete):** Capacidade da Dashboard de gravar, editar e apagar configurações dos mods dentro dos pods rodando em tempo real usando pipes `stdin` e `kubectl exec`.

---

## 📜 5. Regras Estritas do Projeto (Domain Rules)

- **NÃO DESTRUA DADOS:** O K8s gerencia pods voláteis. O `/data` é sagrado. Qualquer refatoração nos Deployments do NestJS deve manter integridade absoluta do `VolumeMount`.
- **FRONTEND AESTHETICS:** Qualquer tela gerada não pode parecer um "MVP seco". Exige-se capricho nas animações, Tailwind/Vanilla refinado, estados de Loading e feedback visual claro para ações lentas de cluster.
- **CONTEXTO DE K8S:** Lembre-se sempre que não acessamos MySQL ou SQLite para saber status de servidor. Nós fazemos **Polling** nas APIs do Kubernetes ou interceptamos via K8s Informers no NestJS. O K8s é a fonte da verdade.
- **SEM PORTAS ABERTAS À TOA:** Mantemos a arquitetura limpa. Tudo passa pelo `mc-router` (porta padrão 25565), exceto VPNs estritas (Tailscale). Não crie NodePorts adicionais sem motivo.

---

## 🧠 6. Diretrizes Comportamentais para a IA (Os 12 Mandamentos)

Estas regras se aplicam a TODAS as tarefas no projeto, a menos que explicitamente sobrescritas.
Viés: cautela em vez de velocidade em trabalhos não triviais. Use bom senso em tarefas triviais.

1. **Pense Antes de Codar:** Declare premissas explicitamente. Se houver dúvida, pergunte em vez de adivinhar. Apresente múltiplas interpretações em caso de ambiguidade. Recuse abordagens complexas quando houver alternativas mais simples. Pare se estiver confuso e explique o que não está claro.
2. **Simplicidade em Primeiro Lugar:** Código mínimo que resolve o problema. Nada de especulações ou recursos extras não solicitados. Sem abstrações para códigos de uso único. Teste: um engenheiro sênior diria que isso está supercomplicado? Se sim, simplifique.
3. **Mudanças Cirúrgicas:** Toque apenas no que for estritamente necessário. Limpe apenas a bagunça que você mesmo criou. Não "melhore" códigos, comentários ou formatações adjacentes. Não refatore o que não está quebrado. Siga o estilo existente.
4. **Execução Focada em Objetivos:** Defina critérios de sucesso. Crie ciclos (loops) de verificação independentes até ser concluído. Não apenas siga passos cegamente, defina o que é o sucesso da tarefa e itere.
5. **Use a IA apenas para julgamentos:** Use a capacidade do modelo para classificação, rascunhos, resumos e extração. NÃO use para roteamento, tentativas repetitivas cegas (retries) ou transformações determinísticas onde o código responderia/resolveria de forma mais confiável.
6. **Orçamentos de Tokens não são sugestão:** Cuidado com os limites (orçamento base de 4.000 tokens por tarefa). Se o limite de contexto estiver próximo do fim, faça um resumo e inicie do zero. Avise sobre o estouro, não ultrapasse limites silenciosamente.
7. **Exponha Conflitos, Não os Mescle:** Se dois padrões se contradizem no código, escolha um (o mais recente ou mais testado). Explique o motivo de sua escolha. Marque o outro para limpeza. Não misture padrões conflitantes na mesma implementação.
8. **Leia Antes de Escrever:** Antes de adicionar código, leia as exportações (exports), os chamadores imediatos e utilitários compartilhados. Achar que algo é "ortogonal" sem ler é perigoso. Se não entender por que um código está estruturado de certa forma, pergunte.
9. **Testes Verificam a Intenção, Não Apenas o Comportamento:** Testes devem codificar o POR QUÊ o comportamento importa, não apenas O QUÊ ele faz. Um teste que não falha quando a regra de negócios muda está errado.
10. **Faça Checkpoints Após Passos Significativos:** Resuma o que foi feito, o que foi verificado e o que falta. Não continue a partir de um estado que você não consiga descrever. Se perder o fio da meada, pare e recapitule.
11. **Siga as Convenções do Projeto, Mesmo se Discordar:** Conformidade é maior que gosto pessoal dentro deste repositório. Se achar que uma convenção é prejudicial, exponha o problema, mas não crie um padrão novo ou faça um fork silenciosamente.
12. **Falhe Alto (Fail Loud):** Dizer "Concluído" é errado se alguma coisa foi ignorada ou pulada silenciosamente. Dizer "Testes passam" é errado se algum teste foi omitido. O padrão deve ser expor problemas e incertezas, nunca escondê-los.
