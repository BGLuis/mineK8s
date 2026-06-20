terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
  }
}

# Configura o provider para ler o ficheiro kubeconfig do seu computador
provider "kubernetes" {
  config_path = "~/.kube/config"
}

# Cria um Namespace isolado para este teste
resource "kubernetes_namespace" "teste" {
  metadata {
    name = "teste-terraform"
  }
}

# Cria o Deployment do Minecraft
resource "kubernetes_deployment" "minecraft" {
  metadata {
    name      = "minecraft-deployment"
    namespace = kubernetes_namespace.teste.metadata[0].name
    labels = {
      app = "minecraft"
    }
  }

  spec {
    replicas = 1 # Reduzido para 1 para evitar problemas de concorrência com o mesmo mundo/porta

    selector {
      match_labels = {
        app = "minecraft"
      }
    }

    template {
      metadata {
        labels = {
          app = "minecraft"
        }
      }

      spec {
        container {
          image = "local/minecraft-server:latest"
          name  = "minecraft"
          image_pull_policy = "Never" # Usa a imagem local

          volume_mount {
            name       = "minecraft-scripts"
            mount_path = "/minecraft"
          }

          port {
            container_port = 25565
          }

          resources {
            limits = {
              cpu    = "2.0"
              memory = "4Gi"
            }
            requests = {
              cpu    = "1.0"
              memory = "2Gi"
            }
          }
        }

        volume {
          name = "minecraft-scripts"
          host_path {
            path = abspath("${path.module}/../create-minecraft-server")
            type = "Directory"
          }
        }
      }
    }
  }
}

# Cria o Service para expor o Minecraft (apenas internamente agora)
resource "kubernetes_service" "minecraft" {
  metadata {
    name      = "minecraft-service"
    namespace = kubernetes_namespace.teste.metadata[0].name
  }

  spec {
    selector = {
      app = "minecraft"
    }

    port {
      port        = 25565
      target_port = 25565
    }

    type = "ClusterIP"
  }
}
