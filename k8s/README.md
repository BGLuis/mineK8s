# Deploy no k3s

Manifests para um k3s de um nó com o Tailscale instalado no host (o `luisarch`). `kubectl apply -k k8s` cria o namespace `minekubernetes` com o Postgres, o control plane (API, painel e gRPC) e o gateway.

## Topologia

| Componente | Rede | Porta no host | Por quê |
| --- | --- | --- | --- |
| control plane | `hostNetwork` | `8080` (API e painel), `50051` (gRPC) | O login do painel faz WhoIs do IP do cliente no `tailscaled` do host; um Service trocaria esse IP. A `3000` já está em uso no `luisarch`. |
| gateway | `hostNetwork` | `25565` (jogadores), `9090` (`/metrics`, `/healthz`) | SEC-01: só aceita origem `100.64.0.0/10` e identifica o jogador pelo WhoIs. |
| Postgres | Service `postgres` | nenhuma | Só o control plane fala com ele. |

Os dois `Deployment`s usam `strategy: Recreate`: com `hostNetwork`, um pod novo não consegue abrir as mesmas portas enquanto o antigo roda.

## Armazenamento

A StorageClass `local-nvme` cria cada PVC em `/var/lib/rancher/k3s/storage/minekubernetes/<PVC>/volume` (`pathPattern`). O control plane monta `/var/lib/rancher/k3s/storage/minekubernetes` como `SERVERS_DATA_ROOT`, então o gerenciador de arquivos, os backups e o instalador de modpacks mexem nos mesmos arquivos que o servidor de Minecraft (`data-<subdomínio>/volume`).

- O control plane cria `data-<subdomínio>/volume` antes do PVC. O k3s deixa o diretório de cada PVC com modo `700`, e só o dono (o control plane) continua entrando nele.
- O control plane roda como UID 1000, o mesmo dos servidores de Minecraft, para que os arquivos que ele grava no mundo continuem editáveis pelo servidor.
- Com o k3s iniciado com `--default-local-storage-path`, ajuste o `hostPath` `servers-data` em `control-plane.yaml`.

## Primeiro deploy

`k8s/bootstrap.sh` faz os passos abaixo (confere kernel, disco e portas, gera `k8s/site.env` com `DB_PASSWORD` e `JWT_SECRET`, constrói e importa as imagens, aplica e espera os rollouts). Ele chama `sudo` sozinho, então rode-o num terminal. `k8s/bootstrap.sh check` só confere o ambiente, sem mudar nada.

Os passos manuais, caso prefira fazê-los um a um (os com `sudo` precisam ser feitos por você):

```bash
# 1. Subir o k3s
sudo systemctl start k3s

# 2. Construir as imagens e importá-las no containerd do k3s (não há registry)
docker build -f services/control-plane/Dockerfile -t minekubernetes/control-plane:local .
docker build -f crates/gateway/Dockerfile -t minekubernetes/gateway:local .
docker save minekubernetes/control-plane:local minekubernetes/gateway:local | sudo k3s ctr images import -

# 3. Configuração do host e segredos
cp k8s/site.env.example k8s/site.env   # preencha DB_PASSWORD, JWT_SECRET e a chave do Tailscale

# 4. Se a StorageClass local-nvme já existe sem o pathPattern, recrie-a (parâmetros são imutáveis;
#    os PVs existentes ficam, reclaimPolicy: Retain)
kubectl delete storageclass local-nvme --ignore-not-found

# 5. Aplicar
kubectl apply -k k8s
kubectl -n minekubernetes rollout status deploy/control-plane
```

As migrações do banco rodam sozinhas no init container `migrate` do control plane (mesma imagem, tenta de novo até o Postgres ficar pronto), antes de a API subir; em produção o boot da API não as aplica. Para ver o resultado:

```bash
kubectl -n minekubernetes logs deploy/control-plane -c migrate
```

O painel fica em `http://luisarch:8080`. Sem `INITIAL_BOOTSTRAP_TOKEN`, o control plane escreve no log o token de criação do primeiro admin:

```bash
kubectl -n minekubernetes logs deploy/control-plane | grep INITIAL_BOOTSTRAP_TOKEN
```

## Atualizar

`k8s/update.sh` faz o `git pull --ff-only`, constrói as duas imagens, importa no containerd (com `sudo`, então rode num terminal), troca a imagem dos Deployments e espera o rollout. Se o rollout falhar, mostra o log do `migrate` e volta o Deployment para a versão anterior. `--no-pull` constrói o que já está no checkout; `check` só confere o ambiente.

```bash
k8s/update.sh
```

As imagens levam como tag os 12 primeiros dígitos do próprio ID, então o que não mudou não é reiniciado e `kubectl rollout undo` encontra a imagem anterior. Isso vale mesmo se o mesmo comando rodar de novo. O gateway só reinicia (e derruba as conexões abertas) quando a imagem dele muda; os mundos de Minecraft são Deployments à parte e continuam rodando. O control plane e o gateway usam `strategy: Recreate`, então o painel fica fora do ar por alguns instantes durante a troca.

Uma migração que já foi aplicada não volta com o rollback; reverta-a à mão antes de voltar a versão se o código antigo não a entender.

Sem o script, o equivalente é repetir o passo 2 e reiniciar:

```bash
kubectl -n minekubernetes rollout restart deploy/control-plane deploy/gateway
```

Cada pod novo do control plane roda as migrações pendentes no init container `migrate`, então não há passo manual; "No migrations are pending" no log do `migrate` significa que o banco já estava em dia. Se o `migrate` falhar (por exemplo, migração com erro), o pod não sobe e o `rollout status` não conclui; veja o log com o comando acima.

Mudanças em `site.env` ou `control-plane.env` mudam o nome gerado do Secret ou do ConfigMap, e o `kubectl apply -k k8s` já reinicia o control plane.

## Regras de ACL da Tailscale e nós compartilhados (`autogroup:shared`)

De acordo com o modelo Zero-Trust (ver `k8s/tailscale/policy.hujson` e KB 1084 da Tailscale), dispositivos compartilhados com a Tailnet (`autogroup:shared`) ou tagueados com `tag:mc-player` devem ter acesso liberado às portas do Gateway Minecraft (`25565`) e da área do jogador no painel (`8080`):

```hujson
{
  "action": "accept",
  "src": ["autogroup:shared", "tag:mc-player"],
  "dst": ["tag:mc-gateway:25565", "tag:mc-gateway:8080"]
}
```

Isso garante que jogadores convidados via Tailscale Share possam acessar o servidor Minecraft e abrir a área do jogador no painel web sem permissão a outras portas administrativas do host (SSH `22`, API interna `3000`, etc.).
