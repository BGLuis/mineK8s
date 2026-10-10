#!/usr/bin/env bash
# Updates a running deployment on the single-node k3s. See k8s/README.md.
#
#   k8s/update.sh             git pull, build, import, roll out, roll back if the rollout fails
#   k8s/update.sh --no-pull   the same, building what is checked out
#   k8s/update.sh check       preflight only (changes nothing)
#
# The images are tagged with their own ID, so a component whose image did not change is not
# restarted, and `kubectl rollout undo` can go back to the previous one. Steps that need root
# (`sudo`) run inside this script, so start it from a terminal.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

NAMESPACE=minekubernetes
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-minek8s.yaml}"
ROLLOUT_TIMEOUT=300s
# Kubelet evicts pods (DiskPressure) when the disk is nearly full; stay well below that.
MAX_DISK_USED_PERCENT=85

CONTROL_PLANE_IMAGE=minekubernetes/control-plane
GATEWAY_IMAGE=minekubernetes/gateway

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'erro: %s\n' "$*" >&2; exit 1; }

preflight() {
  step "Dependências"
  for tool in docker kubectl git; do
    command -v "$tool" >/dev/null || fail "'$tool' não está no PATH"
  done

  step "k3s"
  systemctl is-active --quiet k3s || fail "o k3s está parado (sudo systemctl start k3s)"
  [ -f "$KUBECONFIG" ] || fail "kubeconfig $KUBECONFIG não existe; rode k8s/bootstrap.sh check"
  kubectl wait --for=condition=Ready node --all --timeout=60s

  step "Disco"
  local used
  used="$(df --output=pcent /var/lib/rancher 2>/dev/null | tail -1 | tr -dc '0-9')"
  [ -n "$used" ] || used="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  [ "$used" -le "$MAX_DISK_USED_PERCENT" ] \
    || fail "disco com ${used}% de uso (limite ${MAX_DISK_USED_PERCENT}%): construir imagens agora pode disparar o DiskPressure. Libere espaço."

  step "Deployments"
  for deployment in control-plane gateway; do
    kubectl -n "$NAMESPACE" get "deploy/$deployment" >/dev/null \
      || fail "deploy/$deployment não existe em $NAMESPACE; este é o primeiro deploy? Use k8s/bootstrap.sh"
  done
}

# The first 12 hex digits of the image ID: the same build always gets the same tag.
build() {
  local image="$1" dockerfile="$2" id
  docker build -q -f "$dockerfile" -t "$image:local" . >&2
  id="$(docker image inspect --format '{{.Id}}' "$image:local")"
  id="${id#sha256:}"
  docker tag "$image:local" "$image:${id:0:12}"
  echo "${id:0:12}"
}

current_image() {
  kubectl -n "$NAMESPACE" get "deploy/$1" -o jsonpath='{.spec.template.spec.containers[0].image}'
}

# roll_out <deployment> <image reference> <container=image arguments...>
roll_out() {
  local deployment="$1" target="$2"
  shift 2
  if [ "$(current_image "$deployment")" = "$target" ]; then
    echo "$deployment já está em $target"
    return 0
  fi

  step "Atualizando $deployment para $target"
  kubectl -n "$NAMESPACE" set image "deploy/$deployment" "$@"
  if kubectl -n "$NAMESPACE" rollout status "deploy/$deployment" --timeout="$ROLLOUT_TIMEOUT"; then
    return 0
  fi

  printf '\nO rollout de %s falhou. Log do migrate (se houver):\n' "$deployment" >&2
  kubectl -n "$NAMESPACE" logs "deploy/$deployment" -c migrate --tail=20 >&2 2>/dev/null || true
  step "Voltando $deployment para a versão anterior"
  kubectl -n "$NAMESPACE" rollout undo "deploy/$deployment"
  kubectl -n "$NAMESPACE" rollout status "deploy/$deployment" --timeout="$ROLLOUT_TIMEOUT" || true
  fail "$deployment não subiu com $target e foi revertido. Uma migração já aplicada não volta sozinha."
}

update() {
  if [ "${1:-}" != "--no-pull" ]; then
    step "git pull"
    git pull --ff-only
  fi
  echo "commit: $(git rev-parse --short HEAD)"

  step "Imagens"
  local control_plane gateway
  control_plane="$(build "$CONTROL_PLANE_IMAGE" services/control-plane/Dockerfile)"
  gateway="$(build "$GATEWAY_IMAGE" crates/gateway/Dockerfile)"

  step "Importando no containerd do k3s"
  docker save \
    "$CONTROL_PLANE_IMAGE:local" "$CONTROL_PLANE_IMAGE:$control_plane" \
    "$GATEWAY_IMAGE:local" "$GATEWAY_IMAGE:$gateway" \
    | sudo k3s ctr images import -

  local cp_ref="$CONTROL_PLANE_IMAGE:$control_plane" gw_ref="$GATEWAY_IMAGE:$gateway"
  roll_out control-plane "$cp_ref" "migrate=$cp_ref" "control-plane=$cp_ref"
  roll_out gateway "$gw_ref" "gateway=$gw_ref"

  step "Pronto"
  kubectl -n "$NAMESPACE" logs deploy/control-plane -c migrate --tail=3 2>/dev/null || true
  kubectl -n "$NAMESPACE" get deploy
}

case "${1:-}" in
  check) preflight ;;
  ""|--no-pull) preflight; update "${1:-}" ;;
  *) fail "uso: k8s/update.sh [--no-pull | check]" ;;
esac
