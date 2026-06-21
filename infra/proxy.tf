# ==========================================
# 1. Proxy Reverso Minecraft (mc-router)
# ==========================================
resource "kubernetes_service_account" "mc_router" {
  metadata {
    name      = "mc-router-sa"
    namespace = kubernetes_namespace.teste.metadata[0].name
  }
}

resource "kubernetes_cluster_role" "mc_router" {
  metadata {
    name = "mc-router-role"
  }
  rule {
    api_groups = [""]
    resources  = ["services", "endpoints"]
    verbs      = ["get", "list", "watch"]
  }
}

resource "kubernetes_cluster_role_binding" "mc_router" {
  metadata {
    name = "mc-router-binding"
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.mc_router.metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.mc_router.metadata[0].name
    namespace = kubernetes_namespace.teste.metadata[0].name
  }
}

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
        service_account_name = kubernetes_service_account.mc_router.metadata[0].name
        
        container {
          image = "itzg/mc-router:latest"
          name  = "mc-router"

          # Habilita o modo de cluster do Kubernetes para descoberta dinâmica
          args = [
            "-in-kube-cluster",
            "-kube-namespace=default"
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
    }

    type = "LoadBalancer"
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
