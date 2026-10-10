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

Os passos com `sudo` precisam ser feitos por você.

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

Repita o passo 2 e reinicie:

```bash
kubectl -n minekubernetes rollout restart deploy/control-plane deploy/gateway
```

Cada pod novo do control plane roda as migrações pendentes no init container `migrate`, então não há passo manual; "No migrations are pending" no log do `migrate` significa que o banco já estava em dia. Se o `migrate` falhar (por exemplo, migração com erro), o pod não sobe e o `rollout status` não conclui; veja o log com o comando acima.

Mudanças em `site.env` ou `control-plane.env` mudam o nome gerado do Secret ou do ConfigMap, e o `kubectl apply -k k8s` já reinicia o control plane.
