# ==========================================
# 1. Proxy Reverso Minecraft (mc-router)
# ==========================================
resource "kubernetes_deployment" "mc_router" {
  metadata {
    name      = "mc-router-deployment"
    namespace = kubernetes_namespace.teste.metadata[0].name
    labels = {
      app = "mc-router"
    }
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "mc-router"
      }
    }

    template {
      metadata {
        labels = {
          app = "mc-router"
        }
      }

      spec {
        container {
          image = "itzg/mc-router:latest"
          name  = "mc-router"

          # Aqui passamos os mapeamentos de domínios.
          # Formato: dominio_do_jogador=nome_do_service_interno:porta
          args = [
            "sobrevivencia.seudominio.com=minecraft-service:25565",
            # Você pode adicionar mais servidores assim:
            # "criativo.seudominio.com=minecraft-criativo-service:25565"
          ]

          port {
            container_port = 25565
          }
        }
      }
    }
  }
}

# Expõe publicamente o mc-router
resource "kubernetes_service" "mc_router_service" {
  metadata {
    name      = "mc-router-service"
    namespace = kubernetes_namespace.teste.metadata[0].name
  }

  spec {
    selector = {
      app = "mc-router"
    }

    port {
      port        = 25565
      target_port = 25565
      node_port   = 30065 # O Proxy agora atende publicamente na mesma porta antiga
    }

    type = "NodePort"
  }
}

# ==========================================
# 4. Proxy Reverso Web (Ingress para o Dashboard)
# ==========================================
# Obs: Isso será usado mais a frente quando criarmos os Pods do Dashboard
resource "kubernetes_ingress_v1" "dashboard_ingress" {
  metadata {
    name      = "dashboard-ingress"
    namespace = kubernetes_namespace.teste.metadata[0].name
    annotations = {
      # No K3s, o Traefik costuma ser o padrao.
      "kubernetes.io/ingress.class" = "traefik"
    }
  }

  spec {
    rule {
      host = "painel.seudominio.com"
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              # Este será o Service do Crafty/MCSManager que criaremos no futuro
              name = "dashboard-service"
              port {
                number = 8000 # Substituiremos pela porta real da aplicação web
              }
            }
          }
        }
      }
    }
  }
}
