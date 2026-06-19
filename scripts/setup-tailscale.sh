#!/usr/bin/env bash
# =============================================================================
# setup-tailscale.sh — Configura o Tailscale Funnel no host automaticamente
# =============================================================================
#
# O que este script faz (em ordem):
#   1. Lê o TAILSCALE_API_TOKEN do .env ou da variável de ambiente
#   2. Instala o Tailscale no host (se não estiver instalado)
#   3. Cria uma auth key via API do Tailscale (usando o OAuth Client)
#   4. Autentica o nó na tailnet com a auth key
#   5. Ativa o Tailscale Funnel apontando para localhost:30001 (join-server)
#   6. Descobre o hostname atribuído pelo Tailscale
#   7. Atualiza o Secret do K8s com o TAILSCALE_FUNNEL_HOST automaticamente
#
# Uso:
#   bash scripts/setup-tailscale.sh
#   TAILSCALE_API_TOKEN=tskey-client-... bash scripts/setup-tailscale.sh
#
# Pré-requisitos no host:
#   - kubectl configurado apontando para o cluster K3s
#   - curl, jq instalados
#   - Permissão sudo (para instalar Tailscale e rodar tailscale funnel)
# =============================================================================

set -euo pipefail

# ── Cores para output ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Dependências ──────────────────────────────────────────────────────────────
check_deps() {
  for dep in curl jq kubectl; do
    command -v "$dep" &>/dev/null || error "Dependência não encontrada: $dep"
  done
}

# ── Lê o TAILSCALE_API_TOKEN ──────────────────────────────────────────────────
load_token() {
  # Prioridade: variável de ambiente > .env do backend > .env da raiz
  if [[ -n "${TAILSCALE_API_TOKEN:-}" ]]; then
    info "Usando TAILSCALE_API_TOKEN da variável de ambiente"
    return
  fi

  local env_files=(
    "dashboard/backend/.env"
    ".env"
  )

  for f in "${env_files[@]}"; do
    if [[ -f "$f" ]]; then
      local val
      val=$(grep -E '^TAILSCALE_API_TOKEN=' "$f" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
      if [[ -n "$val" && "$val" != "tskey-client-SUBSTITUA-AQUI" ]]; then
        export TAILSCALE_API_TOKEN="$val"
        info "TAILSCALE_API_TOKEN carregado de: $f"
        return
      fi
    fi
  done

  error "TAILSCALE_API_TOKEN não encontrado.\n  Configure em dashboard/backend/.env ou exporte a variável."
}

# ── Lê o TAILSCALE_TAILNET ────────────────────────────────────────────────────
load_tailnet() {
  TAILSCALE_TAILNET="${TAILSCALE_TAILNET:-}"

  if [[ -z "$TAILSCALE_TAILNET" ]]; then
    local env_files=("dashboard/backend/.env" ".env")
    for f in "${env_files[@]}"; do
      if [[ -f "$f" ]]; then
        local val
        val=$(grep -E '^TAILSCALE_TAILNET=' "$f" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
        if [[ -n "$val" ]]; then
          export TAILSCALE_TAILNET="$val"
          break
        fi
      fi
    done
  fi

  # "-" significa: usar o tailnet padrão da conta (recomendado)
  TAILSCALE_TAILNET="${TAILSCALE_TAILNET:--}"
}

# ── Instala o Tailscale (se necessário) ───────────────────────────────────────
install_tailscale() {
  if command -v tailscale &>/dev/null; then
    success "Tailscale já está instalado: $(tailscale version | head -1)"
    return
  fi

  info "Instalando Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sudo sh
  success "Tailscale instalado"
}

# ── Cria uma auth key via API do Tailscale ────────────────────────────────────
# O OAuth Client (tskey-client-...) não pode ser usado diretamente no
# `tailscale up`. Precisamos criar uma auth key (tskey-auth-...) via API.
create_auth_key() {
  info "Criando auth key via Tailscale API..."

  local response
  response=$(curl -sf \
    --request POST \
    --url "https://api.tailscale.com/api/v2/tailnet/${TAILSCALE_TAILNET}/keys" \
    --header "Authorization: Bearer ${TAILSCALE_API_TOKEN}" \
    --header "Content-Type: application/json" \
    --data '{
      "capabilities": {
        "devices": {
          "create": {
            "reusable": false,
            "ephemeral": false,
            "preauthorized": true,
            "tags": ["tag:minecraft-server"]
          }
        }
      },
      "expirySeconds": 300
    }' || true)

  if [[ -z "$response" ]]; then
    error "Falha ao criar auth key. Verifique:\n  - TAILSCALE_API_TOKEN está correto\n  - A tag 'tag:minecraft-server' existe no ACL Policy\n  - O OAuth Client tem escopo auth_keys:write"
  fi

  AUTH_KEY=$(echo "$response" | jq -r '.key // empty')

  if [[ -z "$AUTH_KEY" ]]; then
    local err_msg
    err_msg=$(echo "$response" | jq -r '.message // .error // "resposta inválida"')
    error "API retornou erro: $err_msg"
  fi

  success "Auth key criada (expira em 5 minutos — será usada agora)"
}

# ── Autentica o nó no Tailscale ───────────────────────────────────────────────
authenticate_node() {
  local ts_status
  ts_status=$(sudo tailscale status --json 2>/dev/null | jq -r '.BackendState // "NoState"')

  if [[ "$ts_status" == "Running" ]]; then
    success "Tailscale já está autenticado e rodando"
    return
  fi

  info "Autenticando nó na tailnet com tag:minecraft-server..."
  sudo tailscale up \
    --authkey="${AUTH_KEY}" \
    --hostname="minekube-dashboard" \
    --accept-routes \
    --advertise-tags="tag:minecraft-server"

  success "Nó autenticado na tailnet"
}

# ── Ativa o Tailscale Funnel ──────────────────────────────────────────────────
# O Funnel expõe localhost:30001 (NodePort do join-server) publicamente via HTTPS.
# Apenas a página /join é exposta — o dashboard permanece privado.
enable_funnel() {
  info "Ativando Tailscale Funnel → localhost:30001 (join-server)..."

  # Verifica se o NodePort está acessível antes de ativar o Funnel
  local retries=0
  while ! curl -sf http://localhost:30001/health &>/dev/null; do
    if [[ $retries -ge 12 ]]; then
      warn "join-server não respondeu em localhost:30001 após 60s"
      warn "Certifique-se que o Pod minekube-api está Running:"
      warn "  kubectl get pods -l app=minekube-api"
      warn ""
      warn "Continuando mesmo assim — o Funnel será ativado,"
      warn "mas só funcionará quando o Pod estiver Running."
      break
    fi
    info "Aguardando join-server ficar disponível... (${retries}/12)"
    sleep 5
    retries=$((retries + 1))
  done

  # Ativa o Funnel em background apontando para o NodePort 30001
  sudo tailscale funnel --bg 30001

  success "Tailscale Funnel ativo em background"
}

# ── Descobre o hostname do Tailscale ─────────────────────────────────────────
get_hostname() {
  info "Descobrindo hostname do Tailscale..."

  local retries=0
  local dns_name=""

  # Aguarda o hostname ser atribuído (pode levar alguns segundos)
  while [[ -z "$dns_name" || "$dns_name" == "null" ]]; do
    if [[ $retries -ge 10 ]]; then
      error "Hostname Tailscale não disponível após 30s. Tente rodar novamente."
    fi
    dns_name=$(sudo tailscale status --json | jq -r '.Self.DNSName // empty')
    [[ -z "$dns_name" ]] && sleep 3
    retries=$((retries + 1))
  done

  # Remove o "." final que o Tailscale adiciona ao DNS name
  FUNNEL_HOST="${dns_name%.}"

  success "Hostname: $FUNNEL_HOST"
}

# ── Atualiza o Secret K8s com o TAILSCALE_FUNNEL_HOST ────────────────────────
update_k8s_secret() {
  info "Atualizando Secret K8s com TAILSCALE_FUNNEL_HOST=${FUNNEL_HOST}..."

  # Verifica se o secret existe
  if ! kubectl get secret minekube-api-secret -n default &>/dev/null; then
    warn "Secret 'minekube-api-secret' não encontrado — crie com: make deploy-api"
    warn "Após criar, execute novamente este script ou defina manualmente:"
    warn "  kubectl patch secret minekube-api-secret -n default --type=merge \\"
    warn "    -p '{\"stringData\":{\"TAILSCALE_FUNNEL_HOST\":\"${FUNNEL_HOST}\"}}'"
    return
  fi

  kubectl patch secret minekube-api-secret \
    -n default \
    --type=merge \
    -p "{\"stringData\":{\"TAILSCALE_FUNNEL_HOST\":\"${FUNNEL_HOST}\"}}"

  success "Secret atualizado"

  # Reinicia o pod para carregar o novo valor
  if kubectl get deployment minekube-api -n default &>/dev/null; then
    info "Reiniciando minekube-api para carregar o novo hostname..."
    kubectl rollout restart deployment/minekube-api -n default
    success "Deployment reiniciado"
  fi
}

# ── Atualiza também o .env local (para dev) ───────────────────────────────────
update_local_env() {
  local env_file="dashboard/backend/.env"

  if [[ ! -f "$env_file" ]]; then
    return
  fi

  if grep -q "^TAILSCALE_FUNNEL_HOST=" "$env_file"; then
    # Substitui o valor existente
    sed -i "s|^TAILSCALE_FUNNEL_HOST=.*|TAILSCALE_FUNNEL_HOST=${FUNNEL_HOST}|" "$env_file"
  else
    # Adiciona a linha
    echo "TAILSCALE_FUNNEL_HOST=${FUNNEL_HOST}" >> "$env_file"
  fi

  success ".env local atualizado com TAILSCALE_FUNNEL_HOST"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║   🦊 MineKube Dashboard — Setup Tailscale Funnel  ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""

  # Garante que estamos na raiz do projeto
  cd "$(dirname "$0")/.."

  check_deps
  load_token
  load_tailnet
  install_tailscale
  create_auth_key
  authenticate_node
  enable_funnel
  get_hostname
  update_k8s_secret
  update_local_env

  echo ""
  echo "╔══════════════════════════════════════════════════╗"
  echo "║   ✅ Setup concluído!                            ║"
  echo "╚══════════════════════════════════════════════════╝"
  echo ""
  echo "  🌐 Funnel URL:   https://${FUNNEL_HOST}/join"
  echo "  🔒 Dashboard:    acessível apenas via Tailscale VPN"
  echo "  📋 NodePort:     localhost:30001 → join-server"
  echo ""
  echo "  Para verificar o status do Funnel:"
  echo "    sudo tailscale funnel status"
  echo ""
  echo "  Para enviar um convite a um jogador, use a UI do dashboard"
  echo "  ou a API: POST /api/tailscale/invite"
  echo ""
}

main "$@"
