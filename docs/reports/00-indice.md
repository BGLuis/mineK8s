# Relatórios de trabalho — MineKubernetes

Estes documentos foram gerados a partir de uma auditoria completa do código-fonte **e**
de uma inspeção ao vivo do cluster k3s real deste homelab (não é análise só estática —
os achados abaixo foram confirmados com `kubectl`, `terraform show`, chamadas reais à API
do Tailscale e leitura direta do banco SQLite de produção). Nenhuma correção foi aplicada
ainda: são relatórios de diagnóstico + plano de correção, para outra sessão de IA (ou você)
executar.

Leia `docs/DOCUMENTACAO.md` e `docs/TODO.md` com desconfiança — foram gerados por agentes
de IA anteriores e erram o status de várias features (detalhes no relatório 02).

## Contexto do ambiente (para quem for executar)

- Cluster real: k3s single-node, host `luisarch` (192.168.0.218), acessível via
  `KUBECONFIG=~/.kube/config` (não `/etc/rancher/k3s/k3s.yaml`, que exige root).
- **`sudo` não está disponível sem senha interativa neste ambiente.** Qualquer passo que
  exija `sudo k3s ctr images import` (usado pelo Makefile em `import-api`/`import-frontend`/
  `import-minecraft`) precisa ser rodado pelo humano, não por um agente autônomo.
- O cluster **não é dedicado a este projeto** — hospeda também um projeto não relacionado
  chamado `gatuno-*` (API, frontend Angular, MySQL, Redis) no namespace `default`. Nunca
  toque em recursos com esse prefixo.
- Namespaces relevantes: `default` (app real: `minekube-api`, `minekube-frontend`,
  `minekube-health-bot`, mais os `mc-*` dinâmicos) e `teste-terraform` (só o Terraform,
  candidato a remoção — ver relatório 03).
- Tailscale está ativo no host (`tailscale status`) e a API token real está em
  `dashboard/backend/.env` (não commitado). Testes que chamam a API do Tailscale de
  verdade devem ser feitos com cautela — mudanças de ACL afetam a rede real do usuário.

## Os relatórios

1. **[01-testes-e-validacoes.md](01-testes-e-validacoes.md)** — a suíte de testes hoje
   não roda (`npm test` falha antes de qualquer asserção). Diagnóstico exaustivo arquivo
   por arquivo + plano para destravar e depois dar cobertura real ao que importa.
2. **[02-tailscale-roteamento-controle-granular.md](02-tailscale-roteamento-controle-granular.md)**
   — o item mais crítico. O controle de acesso granular (Tailscale + Prisma + Gateway TCP)
   está **completamente inoperante** por 8 falhas encadeadas, e o caminho que hoje
   "funciona" na prática ignora toda autorização. Plano completo de correção, já com
   decisões de arquitetura tomadas pelo dono do projeto.
3. **[03-k8s-terraform-validacao-correcao.md](03-k8s-terraform-validacao-correcao.md)** —
   estado real dos manifests K8s e do Terraform, confirmado ao vivo no cluster (RBAC,
   probes, hostPath, namespaces duplicados, recursos órfãos).
4. **[04-fluxo-convite-e-conexao-do-jogador.md](04-fluxo-convite-e-conexao-do-jogador.md)**
   — a jornada completa do convite até o jogador entrar no mundo, incluindo um bug ativo
   (link de convite sempre `undefined` na UI) e uma lacuna que fragmenta a identidade de
   quem é convidado mais de uma vez. Complementa a Fase 3 do relatório 02.
5. **[05-jogadores-piratas-e-premium.md](05-jogadores-piratas-e-premium.md)** — hoje
   contas piratas nem conseguem logar (achado novo: `ONLINE_MODE` nunca é setado no
   caminho real de provisionamento). Plano para suportar pirata + premium juntos,
   preservando skin de quem tem conta paga e reservando nickname por identidade
   Tailscale via extensão do Gateway.
6. **[06-evolucao-multi-jogo.md](06-evolucao-multi-jogo.md)** — mapeamento de
   arquitetura (sem cronograma) para eventualmente suportar outros jogos além de
   Minecraft, usando Terraria como exemplo guia. Documenta por que o modelo de
   roteamento atual (domínio compartilhado) não serve para Terraria, e o que já é
   genérico o suficiente para reaproveitar.
7. **[07-consistencia-apis-externas.md](07-consistencia-apis-externas.md)** — auditoria
   das integrações com Modrinth e CurseForge (a chave do CurseForge está duplicada e
   uma das duas cópias ignora a configuração do projeto; o campo `versions` do
   "formato universal" mistura semânticas diferentes entre as duas APIs, causando dado
   errado já observável na UI hoje; loader de modpack é adivinhado por palavra-chave em
   vez de lido da API).
8. **[08-performance-migracao-loadbalancer-go.md](08-performance-migracao-loadbalancer-go.md)**
   — não vale migrar o `GatewayService` para Go por performance: na escala real deste
   homelab, o proxy TCP não é o gargalo (as JVMs de Minecraft consomem 2-3 ordens de
   grandeza mais recurso). Identifica dois problemas de performance reais e
   independentes de linguagem (RCON via `child_process.exec` por comando, e
   `--max-old-space-size` do Node maior que o limite do container) que valem mais a
   pena corrigir primeiro.
9. **[09-performance-mundos-e-consumo-geral.md](09-performance-mundos-e-consumo-geral.md)**
   — performance dos mundos (falta `VIEW_DISTANCE`/`SIMULATION_DISTANCE`, JVM flags
   hardcoded parecem faltar `-XX:+AlwaysPreTouch`, os YAMLs de Paper do repo não afetam
   nenhum servidor real) e consumo geral da orquestração (o polling do console ×
   custo do RCON gera milhares de `kubectl exec` por dia por aba aberta — o maior item
   de desperdício do sistema; o próprio sleep-mode sofre do mesmo problema; Longhorn
   ainda rodando de antes da migração para `local-path`, mas com ressalva de outro
   tenant do cluster dependendo dele).

## Achados de segurança que atravessam os três relatórios

Não repita a investigação — estes dois já estão 100% confirmados no código, com
`arquivo:linha`, e são pré-requisito de qualquer exposição do sistema além do laptop
do dono:

- **RCE via `sendCommand`** — `dashboard/backend/src/servers/servers.service.ts:400-414`.
  `exec()` do Node roda `kubectl exec ${podName} -- rcon-cli "${command}"` com o `command`
  do `POST /api/servers/:id/command` interpolado sem sanitização nenhuma numa shell. Um
  `"` seguido de `$(...)` ou crase escapa as aspas. É alcançável também indiretamente via
  `getPlayers` (`servers.service.ts:435`) e pelo cron do `sleep-mode`
  (`sleep-mode.service.ts`, chama `getPlayers` a cada 5 minutos). Zero testes cobrem este
  caminho.
- **Zero autenticação na API HTTP** — nenhum controller (`servers`, `admin`, `backups`,
  `tailscale`, `monitoring`, `sleep-mode`, `modpacks`) tem `@UseGuards`/JWT. `/api/admin/*`
  e o endpoint acima estão publicamente abertos para quem alcançar a porta 3000.

Ambos ficam **fora do escopo dos três relatórios abaixo** (que têm foco próprio), mas
qualquer trabalho de exposição pública do sistema deve resolvê-los primeiro.
