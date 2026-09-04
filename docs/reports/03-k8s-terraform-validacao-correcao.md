# Relatório 03 — Validação e correção do K8s e Terraform

> Ver [00-indice.md](00-indice.md) para contexto do ambiente antes de executar qualquer coisa aqui.
> Todos os achados abaixo foram confirmados **ao vivo** no cluster k3s real
> (`KUBECONFIG=~/.kube/config`), não só por leitura estática dos manifests.

## Veredito em uma frase

Os manifests da API/frontend estão bem escritos (probes, limits, RBAC com verbos
específicos); o problema é que o Terraform gerencia uma infraestrutura paralela e morta
que nada tem a ver com o que a aplicação realmente usa, e três detalhes concretos
(RBAC com escopo de cluster, `chmod 777`, hostPath pessoal) precisam de correção.

---

## Parte A — Terraform: confirmado que só gerencia recursos mortos

Lido diretamente de `infra/terraform.tfstate` (state local, não commitado — correto,
`.gitignore` cobre `infra/terraform.tfstate*` e `infra/.terraform/`):

```
kubernetes_cluster_role           mc_router            -> mc-router-role
kubernetes_cluster_role_binding   mc_router            -> mc-router-binding
kubernetes_deployment             mc_router            -> mc-router-deployment
kubernetes_deployment             minecraft            -> minecraft-deployment
kubernetes_ingress_v1             dashboard_ingress    -> dashboard-ingress
kubernetes_namespace              teste                -> teste-terraform
kubernetes_service                mc_router_service    -> mc-router-service
kubernetes_service                minecraft             -> minecraft-service
kubernetes_service_account        mc_router            -> mc-router-sa
```

Nove recursos, todos em `infra/main.tf` + `infra/proxy.tf`. Confirmado ao vivo, nenhum é
necessário para a aplicação funcionar:

- **`minecraft-deployment`/`minecraft-service`** (`infra/main.tf`): usa
  `image_pull_policy = "Never"` com `local/minecraft-server:latest` — hoje em
  `ErrImageNeverPull` (a imagem não foi importada recentemente). É o deployment de
  tutorial do `docs/TUTORIAL.md` (Fase 1 do guia de infra), nunca atualizado depois que
  o provisionamento dinâmico via API (`servers.service.ts`) passou a existir. Os
  servidores de Minecraft reais nascem em runtime pela API, não por aqui.
- **`mc-router-*`** (`infra/proxy.tf`): o proxy SNI descrito em `docs/DOCUMENTACAO.md`
  como peça central da arquitetura. Confirmado rodando ao vivo
  (`mc-router-service`, namespace `teste-terraform`, `EXTERNAL-IP 192.168.0.240:25565`
  via MetalLB) — mas é exatamente o componente que o
  [relatório 02](02-tailscale-roteamento-controle-granular.md) determina que deve ser
  **aposentado**, porque ele ignora toda autorização (bypass via annotation
  `mc-router.itzg.me/externalServerName`).
- **`dashboard_ingress`** (`infra/proxy.tf`): aponta para um Service chamado
  `dashboard-service`, porta 8000 — esse Service **nunca existiu** em nenhum manifest do
  repo. É um placeholder do tutorial que nunca foi atualizado para o nome real
  (`minekube-frontend-svc`).
- **`kubernetes_namespace.teste` → `teste-terraform`**: namespace paralelo ao `default`,
  onde a aplicação real roda. Confirmado ao vivo: dois namespaces coexistindo para o
  "mesmo" produto, sem nenhuma sincronia entre eles.

**MetalLB, storage classes (`local-path`, `longhorn`) e o próprio K3s não são geridos
pelo Terraform** — confirmado por `grep -riE "metallb|storage_class|helm" infra/*.tf`
(zero ocorrências) e `kubectl get deploy -n metallb-system -o jsonpath='...managed-by'`
→ `Helm`. Ou seja, remover `infra/` **não tira nenhuma capacidade** de provisionar nada
— tudo que a aplicação precisa (namespaces, Deployments, Services, PVCs dos servidores
de Minecraft) já é criado pela própria API NestJS em runtime, e a aplicação (API,
frontend, RBAC) sobe via `kubectl apply -f k8s/*.yaml` pelo Makefile.

### Correção recomendada

Alinhada com a decisão já tomada no relatório 02 (aposentar o `mc-router`):

1. `terraform -chdir=infra destroy` — remove os 9 recursos do cluster, incluindo o
   namespace `teste-terraform` inteiro. **Ação destrutiva em infraestrutura viva**: até o
   `GatewayService` assumir a porta 25565 (relatório 02, Fase 4), `mc-router-service` é
   o único caminho com IP externo para jogar. Sequencie: só rode o `destroy` depois que
   o Gateway já estiver exposto e validado (relatório 02, verificação #2), não antes —
   senão ninguém consegue conectar na janela entre os dois.
2. Remover o diretório `infra/` do repositório.
3. Atualizar `docs/TUTORIAL.md` (hoje descreve o fluxo Terraform como "Fase 1" da
   infraestrutura) e o `Makefile` (`infra`, `infra-plan`, `infra-destroy` targets,
   linhas ~150-162) para não referenciar mais Terraform.
4. Se no futuro fizer sentido meter MetalLB/storage class sob IaC, essa é uma decisão
   nova e separada — não ressuscite o `infra/` atual para isso, comece um state limpo.

---

## Parte B — `k8s/rbac.yaml`: verbos corretos, escopo errado

Lido o manifest completo — ao contrário do que uma leitura superficial sugeriria, os
**verbos já são bem escopados** (nenhum wildcard `*`, recursos específicos:
`deployments`, `services`, `persistentvolumeclaims`, `pods`, `pods/exec`, `pods/log`,
`jobs`, e leitura de `metrics.k8s.io`). O problema real é a **abrangência**: é um
`ClusterRole` + `ClusterRoleBinding`, válido em **todos os namespaces do cluster**
(confirmado: o binding não tem namespace, e `ClusterRoleBinding` é sempre cluster-wide),
quando a aplicação só opera no namespace `default`.

### Correção

Dividir em dois recursos, já que uma regra (`metrics.k8s.io`) é inerentemente
cluster-scoped (a API de métricas de `nodes` não existe em versão namespaced) e as
outras não precisam ser:

```yaml
# Role namespaced — tudo que hoje está no ClusterRole, exceto metrics.k8s.io
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: minekube-api-role
  namespace: default
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "watch", "create", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch", "create", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: minekube-api-binding
  namespace: default
subjects:
  - kind: ServiceAccount
    name: minekube-api
    namespace: default
roleRef:
  kind: Role
  name: minekube-api-role
  apiGroup: rbac.authorization.k8s.io
---
# ClusterRole só para o que exige escopo de cluster (nodes não tem versão namespaced)
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: minekube-api-metrics-role
rules:
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: minekube-api-metrics-binding
subjects:
  - kind: ServiceAccount
    name: minekube-api
    namespace: default
roleRef:
  kind: ClusterRole
  name: minekube-api-metrics-role
  apiGroup: rbac.authorization.k8s.io
```

O `ServiceAccount` (bloco já existente no início do arquivo) não muda. Combinado com o
[relatório 02](02-tailscale-roteamento-controle-granular.md) (que já corrige o RCE e a
falta de autenticação HTTP como itens transversais), isso limita o raio de explosão de
um eventual comprometimento da API ao namespace `default`, em vez do cluster inteiro.

---

## Parte C — `k8s/nestjs-api.yaml`: dois problemas concretos

Confirmado por leitura do manifest e checagem ao vivo do pod/volumes.

### C1. `chmod 777` no initContainer

```yaml
initContainers:
  - name: permission-fixer
    image: alpine:latest
    command: ["/bin/sh", "-c", "chmod 777 /var/minekube/uploads"]
```

Abre o volume de uploads para qualquer usuário/processo do nó escrever. Correção —
resolver a permissão declarativamente, sem `chmod` algum:

```yaml
spec:
  securityContext:
    fsGroup: 1000       # ajuste ao UID/GID real do processo Node na imagem
  # remover o initContainer "permission-fixer" inteiro
```

### C2. hostPath do banco aponta para o disco pessoal do desenvolvedor

```yaml
volumes:
  - name: db-volume
    hostPath:
      path: /home/luis/Documents/proxmox/mineKubernetes/dashboard/backend/dev.db
      type: FileOrCreate
```

Já é o Achado 8 do [relatório 02](02-tailscale-roteamento-controle-granular.md#detalhe-de-cada-achado)
(caminho de montagem não bate com o que a app abre, e mesmo corrigido, hostPath pessoal
não é portável). A correção — PVC `local-path` em `/data` — está descrita lá, na Fase 4;
não duplique aqui, implemente junto.

---

## Parte D — Comparação com o que os servidores dinâmicos realmente recebem

O relatório de auditoria original apontou `k8s/mc-vanilla.yaml` (manifest estático,
sem `resources`/probes) como risco. **Verificação adicional importante**: esse manifest
é vestigial — não é o caminho usado pela aplicação. `servers.service.ts:119-156`
(`createServer`, o caminho real de provisionamento) já define:

```ts
resources: {
	limits: { memory: `${mem + 1}Gi` },   // +1G de margem off-heap
	requests: { memory: `${mem}Gi` },
},
livenessProbe: { exec: { command: ['mc-monitor', 'status', ...] }, ... },
readinessProbe: { exec: { command: ['mc-monitor', 'status', ...] }, ... },
```

Ou seja: **servidores criados pela dashboard já têm limite de memória e probes** — o
achado original só se aplica ao manifest estático órfão. Duas ações, não uma:

1. Alinhar `k8s/mc-vanilla.yaml` com o mesmo padrão (`resources`, probes) só se ele
   continuar tendo uso real como referência/exemplo manual — senão, considere removê-lo
   junto com a limpeza do Terraform, para não confundir quem lê o repo achando que é o
   caminho de produção.
2. **CPU não tem limite nem request em nenhum dos dois caminhos** — só memória. Para
   JVM isso costuma ser intencional (CPU throttling causa pausas de GC piores que não
   limitar), mas vale uma decisão explícita: se o nó só tem um servidor de Minecraft
   pesado disputando CPU com a API/frontend/outros pods, um `requests.cpu` mínimo (sem
   `limits.cpu`) evita fome de CPU para os outros serviços sem sofrer o problema de
   throttling da JVM.

---

## Parte E — Duas storage classes marcadas como `default`

Confirmado ao vivo:

```
NAME                   PROVISIONER             DEFAULT
local-path (default)   rancher.io/local-path   sim
longhorn (default)     driver.longhorn.io      sim
```

Duas storage classes disputando o papel de default simultaneamente. Quando um PVC não
especifica `storageClassName` explicitamente, o comportamento é indefinido/depende de
qual admission controller processa primeiro — não é determinístico. `docs/DOCUMENTACAO.md`
já documenta que o projeto migrou de Longhorn para `local-path` "devido a problemas de
corrupção". `servers.service.ts:58` já especifica `storageClassName: 'local-path'`
explicitamente (bom, não depende do default) — mas confirme que **todo** PVC criado pelo
projeto (incluindo os de backup, se existirem) faz o mesmo, e remova a flag de default do
Longhorn (`kubectl patch storageclass longhorn -p '{"metadata":{"annotations":
{"storageclass.kubernetes.io/is-default-class":"false"}}}'`) para eliminar a ambiguidade
para qualquer PVC futuro que esqueça de especificar a classe.

---

## Parte F — Serviços órfãos no cluster

Confirmado ao vivo, dois Services no namespace `default` sem Deployment/dashboard
correspondente reconhecível pelo código atual:

```
mc-better-mc-forge-bmc4-svc   NodePort   25565:31995/TCP   76d
mc-test-modpack-svc           NodePort   25565:30974/TCP   76d
```

76 dias de idade — mais antigos que o `minekube-api`/`minekube-frontend` atuais (63
dias). Provavelmente resquício de testes manuais anteriores ao provisionamento dinâmico
atual (o tipo `NodePort` não bate com o que `servers.service.ts` cria hoje, que é sempre
`ClusterIP` — ver [relatório 02](02-tailscale-roteamento-controle-granular.md), achado
adicional sobre tipo de Service). Confirme se os Deployments correspondentes ainda
existem (`kubectl get deploy -n default | grep -E "bmc4|test-modpack"`) antes de decidir
entre reconciliar (registrar no Prisma, se forem servidores reais em uso) ou remover
(se forem lixo de teste).

---

## Verificação

1. `terraform -chdir=infra plan` mostra remoção limpa dos 9 recursos, sem afetar
   `default`, `metallb-system`, `longhorn-system` ou o projeto não relacionado `gatuno-*`.
2. `kubectl auth can-i --as=system:serviceaccount:default:minekube-api delete pods
   -n kube-system` deve retornar `no` depois da migração de RBAC (hoje provavelmente
   retorna `yes`, já que é `ClusterRole`).
3. `kubectl get pod -n default -l app=minekube-api -o jsonpath='{.spec.securityContext}'`
   mostra `fsGroup` configurado e nenhum `initContainer` de permissão.
4. Upload de arquivo pelo file manager continua funcionando depois da remoção do
   `chmod 777` (valida que o `fsGroup` resolveu a permissão corretamente).
5. `kubectl get sc` mostra só uma storage class marcada `(default)`.
