# Sistema Centralizado de Logs (Promtail + Loki)

## Propósito
Em um cluster Kubernetes, os logs dos Pods são efêmeros por padrão. Se um servidor Minecraft (Pod) reiniciar por OOMKilled ou crash interno, os logs antigos (`kubectl logs`) são rotacionados e perdidos.
A stack Loki + Promtail resolve isso coletando e armazenando permanentemente os logs fora do ciclo de vida do Pod, permitindo buscas e análises históricas.

## Arquitetura
1. **Loki**: Banco de dados otimizado para logs (estilo Prometheus, mas para texto). Pode armazenar os dados num Persistent Volume local (Longhorn) ou num bucket S3.
2. **Promtail**: Agente implantado como `DaemonSet` no K3s (um por nó físico). Ele captura o `stdout` e `stderr` de todos os containers rodando na máquina.
3. **Backend NestJS**: Em vez de fazer queries na API do K8s (`readNamespacedPodLog`), o Backend passa a realizar queries HTTP REST (LogQL) diretamente contra o serviço do Loki.

## Integração Proposta (Backend)
Quando o usuário solicitar o endpoint `/api/servers/:id/logs`:
- O NestJS formatará uma query LogQL: `{app="mc-nomedoservidor", container="minecraft"}`.
- O Loki retornará os logs em JSON.
- É possível passar parâmetros de tempo cronológico (ex: `start=1h-ago`) para investigar eventos que aconteceram muito antes da inicialização atual.

## Vantagens Específicas para Modpacks
- **Depuração Histórica**: Se um player crashou o servidor às 3 da manhã jogando um item no chão, o admin pode investigar no dia seguinte mesmo que o Kubernetes tenha auto-reiniciado o servidor.
- **Métricas via Logs**: O Loki permite transformar logs em métricas. Você pode alertar se a string `[FATAL] OutOfMemoryError` aparecer mais de X vezes num intervalo de 10 minutos.

## Planejamento de Implementação Futura
1. Deploy do Loki stack no namespace `monitoring`.
2. Alteração no `ServersService.getLogs()` para rotear a requisição ao Loki.
3. Interface Angular: adicionar botões de paginação ou seleção de datas para buscar logs antigos.
