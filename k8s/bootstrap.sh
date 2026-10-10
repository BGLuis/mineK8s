#!/usr/bin/env bash
# First deploy on a single-node k3s. See k8s/README.md.
#
#   k8s/bootstrap.sh          preflight, build and import the images, apply, wait
#   k8s/bootstrap.sh check    preflight only (changes nothing)
#
# Steps that need root (`sudo`) run inside this script, so start it from a terminal.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

NAMESPACE=minekubernetes
K3S_KUBECONFIG=/etc/rancher/k3s/k3s.yaml
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-minek8s.yaml}"
# Kubelet evicts pods (DiskPressure) when the disk is nearly full; stay well below that.
MAX_DISK_USED_PERCENT=85

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'erro: %s\n' "$*" >&2; exit 1; }

preflight() {
  step "Dependências"
  for tool in docker kubectl openssl; do
    command -v "$tool" >/dev/null || fail "'$tool' não está no PATH"
  done

  step "Kernel"
  # k3s needs the modules of the running kernel (overlay, br_netfilter...); after a pacman -Syu
  # the running kernel's /lib/modules is gone until the next reboot, and k3s crash-loops.
  [ -d "/lib/modules/$(uname -r)" ] \
    || fail "/lib/modules/$(uname -r) não existe: o kernel em execução foi atualizado. Reinicie o computador."

  step "k3s"
  if ! systemctl is-active --quiet k3s; then
    echo "k3s parado, iniciando"
    sudo systemctl start k3s
  fi

  step "Disco"
  local used
  used="$(df --output=pcent /var/lib/rancher 2>/dev/null | tail -1 | tr -dc '0-9')"
  [ -n "$used" ] || used="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  [ "$used" -le "$MAX_DISK_USED_PERCENT" ] \
    || fail "disco com ${used}% de uso (limite ${MAX_DISK_USED_PERCENT}%): o kubelet vai aplicar o taint DiskPressure e nada será agendado. Libere espaço."

  step "kubeconfig ($KUBECONFIG)"
  if [ ! -f "$KUBECONFIG" ]; then
    mkdir -p "$(dirname "$KUBECONFIG")"
    sudo install -m 600 -o "$(id -u)" -g "$(id -g)" "$K3S_KUBECONFIG" "$KUBECONFIG"
  fi
  kubectl wait --for=condition=Ready node --all --timeout=120s

  step "Portas do host"
  # control plane and gateway use hostNetwork, so their ports must be free on the host. Once the
  # namespace exists the ports are ours, and listening there is expected.
  if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "namespace $NAMESPACE já existe, nada a conferir"
    return
  fi
  local port
  for port in 8080 25565 50051 9090; do
    [ -z "$(ss -Hltn "sport = :$port")" ] \
      || echo "aviso: a porta $port já está em uso no host; mude-a nos manifests (veja 'Topologia' no README)"
  done
}

ensure_site_env() {
  step "k8s/site.env"
  if [ ! -f k8s/site.env ]; then
    cp k8s/site.env.example k8s/site.env
    sed -i \
      -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" \
      k8s/site.env
    echo "criado com DB_PASSWORD e JWT_SECRET gerados"
  fi
  grep -Eq '^TAILSCALE_API_KEY=.+' k8s/site.env \
    || echo "aviso: TAILSCALE_API_KEY vazio em k8s/site.env; convites e remoção de dispositivos não vão funcionar até preenchê-lo"
  echo "confira API_URL, APP_URL e ALLOWED_ORIGINS em k8s/site.env: o painel só aceita essas origens"
}

build_and_import_images() {
  step "Imagens"
  docker build -f services/control-plane/Dockerfile -t minekubernetes/control-plane:local .
  docker build -f crates/gateway/Dockerfile -t minekubernetes/gateway:local .
  docker save minekubernetes/control-plane:local minekubernetes/gateway:local | sudo k3s ctr images import -
}

apply_and_wait() {
  step "Aplicando os manifests"
  kubectl apply -k k8s
  kubectl -n "$NAMESPACE" rollout status statefulset/postgres --timeout=300s
  kubectl -n "$NAMESPACE" rollout status deploy/control-plane --timeout=300s
  kubectl -n "$NAMESPACE" rollout status deploy/gateway --timeout=300s

  step "Pronto"
  kubectl -n "$NAMESPACE" logs deploy/control-plane -c migrate | tail -3
  local token
  token="$(kubectl -n "$NAMESPACE" logs deploy/control-plane | grep INITIAL_BOOTSTRAP_TOKEN | tail -1 || true)"
  if [ -n "$token" ]; then
    echo "$token"
  else
    echo "Sem token no log: o primeiro admin já existe ou INITIAL_BOOTSTRAP_TOKEN está definido em k8s/site.env."
  fi
}

case "${1:-}" in
  check) preflight ;;
  "") preflight; ensure_site_env; build_and_import_images; apply_and_wait ;;
  *) fail "uso: k8s/bootstrap.sh [check]" ;;
esac
