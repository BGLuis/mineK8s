# ─────────────────────────────────────────────────────────────────────────────
# MineKubernetes — Makefile
# ─────────────────────────────────────────────────────────────────────────────
# Uso:
#   make up         → provisiona tudo de uma vez (infra, build, import, deploy)
#   make install    → instala dependências npm (backend + frontend)
#   make start      → sobe em modo dev (NestJS + Angular com hot-reload)
#   make build      → builda as imagens Docker
#   make deploy     → aplica os manifests K8s no cluster atual
#   make infra      → terraform apply (mc-router e recursos base)
#   make status     → mostra todos os pods do cluster
#   make logs       → logs ao vivo do minekube-api
#   make destroy    → terraform destroy (CUIDADO!)
# ─────────────────────────────────────────────────────────────────────────────

IMAGE_API     = minekube-api
IMAGE_ANGULAR = minekube-frontend
TAG           = latest

# Garante que o kubectl use o kubeconfig do usuário e não o root do K3s
export KUBECONFIG ?= $(HOME)/.kube/config

.PHONY: install start start-backend start-frontend \
        build build-api build-frontend \
        deploy deploy-rbac deploy-api \
        infra infra-destroy \
        status logs \
        help up

# ── Desenvolvimento local ──────────────────────────────────────────────────────

install:
	@echo "📦 Instalando dependências do backend..."
	cd dashboard/backend && npm install
	@echo "📦 Instalando dependências do frontend..."
	cd dashboard/frontend && npm install

start: ## Sobe NestJS + Angular em modo dev (hot-reload)
	@echo "🚀 Iniciando em modo desenvolvimento..."
	@make -j2 start-backend start-frontend

start-backend:
	@echo "🟢 Backend NestJS (porta 3000)..."
	cd dashboard/backend && npm run start:dev

start-frontend:
	@echo "🟣 Frontend Angular (porta 4200)..."
	cd dashboard/frontend && npm start

# ── Build Docker ───────────────────────────────────────────────────────────────

build: build-api build-frontend ## Builda todas as imagens Docker

build-api: ## Builda a imagem Docker do NestJS
	@echo "🐳 Buildando imagem $(IMAGE_API):$(TAG)..."
	docker build -t $(IMAGE_API):$(TAG) ./dashboard/backend
	@echo "✅ Imagem $(IMAGE_API):$(TAG) pronta"

build-frontend: ## Builda a imagem Docker do Angular (nginx)
	@echo "🐳 Buildando imagem $(IMAGE_ANGULAR):$(TAG)..."
	docker build -t $(IMAGE_ANGULAR):$(TAG) ./dashboard/frontend
	@echo "✅ Imagem $(IMAGE_ANGULAR):$(TAG) pronta"

# Importa as imagens para o K3s (necessário quando não usa registry externo)
import: import-api import-frontend

import-api: build-api
	@echo "📤 Importando API para o K3s..."
	docker save $(IMAGE_API):$(TAG) | sudo k3s ctr images import -
	@echo "✅ Imagem $(IMAGE_API):$(TAG) importada no K3s"

import-frontend: build-frontend
	@echo "📤 Importando frontend para o K3s..."
	docker save $(IMAGE_ANGULAR):$(TAG) | sudo k3s ctr images import -
	@echo "✅ Imagem $(IMAGE_ANGULAR):$(TAG) importada no K3s"

build-bot: ## Builda a imagem Docker do Bot
	@echo "🐳 Buildando imagem minekube-bot:$(TAG)..."
	docker build -t minekube-bot:$(TAG) ./bot
	@echo "✅ Imagem minekube-bot:$(TAG) pronta"

import-bot: build-bot
	@echo "📤 Importando bot para o K3s..."
	docker save minekube-bot:$(TAG) | sudo k3s ctr images import -
	@echo "✅ Imagem minekube-bot:$(TAG) importada no K3s"

# ── Deploy no Kubernetes ───────────────────────────────────────────────────────

up: infra import deploy ## Provisiona tudo de uma vez (Infra, Build, Import e Deploy K8s)

deploy: deploy-rbac deploy-api deploy-frontend ## Aplica todos os manifests K8s

deploy-rbac: ## Aplica o ServiceAccount e RBAC
	@echo "🔐 Aplicando RBAC..."
	kubectl apply -f k8s/rbac.yaml

deploy-api: ## Aplica o Deployment do NestJS
	@echo "🚀 Aplicando Deployment do NestJS..."
	kubectl apply -f k8s/nestjs-api.yaml

deploy-frontend: ## Aplica o Deployment do Angular
	@echo "🌐 Aplicando Deployment do Angular..."
	kubectl apply -f k8s/angular-frontend.yaml

deploy-bot: ## Aplica o CronJob do Bot
	@echo "🤖 Aplicando CronJob do Bot..."
	kubectl apply -f k8s/bot-cronjob.yaml

# Restart forçado dos pods (puxa nova imagem importada)
restart-api:
	@echo "🔄 Reiniciando minekube-api..."
	kubectl rollout restart deployment/minekube-api

restart-frontend:
	@echo "🔄 Reiniciando minekube-frontend..."
	kubectl rollout restart deployment/minekube-frontend

# ── Tailscale Funnel ──────────────────────────────────────────────────────────

setup-ts: ## Instala Tailscale, ativa Funnel e configura TAILSCALE_FUNNEL_HOST automaticamente
	@echo "🦊 Configurando Tailscale Funnel..."
	bash scripts/setup-tailscale.sh

# ── Infraestrutura (Terraform) ─────────────────────────────────────────────────

infra: ## Aplica a infra base via Terraform (mc-router, namespace, etc)
	@echo "🏗️  Aplicando infra com Terraform..."
	cd infra && terraform init && terraform apply

infra-plan: ## Mostra o plano do Terraform sem aplicar
	cd infra && terraform plan

infra-destroy: ## ⚠️  DESTRÓI toda a infra Terraform (cuidado!)
	@echo "💥 ATENÇÃO: Isso vai destruir mc-router e recursos base!"
	@read -p "Digite 'destroy' para confirmar: " confirm && [ "$$confirm" = "destroy" ]
	cd infra && terraform destroy

# ── Observabilidade ────────────────────────────────────────────────────────────

status: ## Mostra todos os pods do cluster
	@echo "📊 Status do cluster:"
	kubectl get pods -A
	@echo ""
	@echo "📦 PVCs (volumes dos servidores):"
	kubectl get pvc

logs: ## Logs ao vivo do minekube-api
	kubectl logs -f deployment/minekube-api --all-containers=true

logs-mc: ## Logs de todos os servidores Minecraft (pods mc-*)
	kubectl logs -l app!=minekube-api,app!=mc-router --all-containers=true --prefix=true

# ── Help ───────────────────────────────────────────────────────────────────────

help: ## Mostra esta ajuda
	@echo ""
	@echo "🎮 MineKubernetes — Comandos disponíveis:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
