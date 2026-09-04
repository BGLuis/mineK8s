# Guia de Infraestrutura: Minecraft no Kubernetes (Fase 1)

Este documento guarda os passos e tutoriais necessários para inicializar a sua infraestrutura Kubernetes local gerida por Terraform, executando o seu código base de Minecraft, bem como o planeamento para o Dashboard de Gestão.

## 1. Configuração Inicial do K3s para o Terraform
O K3s guarda o ficheiro de configuração com privilégios de `root`. Para que o Terraform consiga interagir com o cluster sem necessitar de permissões de administrador constantes, copie a configuração para o seu perfil:

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
```

> **Verificação:** Para garantir que resultou, execute `kubectl get nodes`. Deve conseguir ver o seu nó local sem erros.

---

## 2. Compilar e Importar a Imagem Docker (com os seus scripts)
Os seus scripts (que transferem a versão correta do Minecraft, aceitam o EULA e gerem a RAM) foram empacotados através de um `Dockerfile`. O K3s usa o `containerd`, pelo que a imagem construída localmente precisa de ser importada.

Execute os seguintes passos:
```bash
# Entrar na pasta clonada com os seus scripts
cd /home/luis/Documents/proxmox/mineKubernetes/create-minecraft-server

# Construir a imagem localmente (chamada local/minecraft-server:latest)
docker build -t local/minecraft-server:latest .

# Guardar a imagem e importá-la diretamente para o K3s
docker save local/minecraft-server:latest | sudo k3s ctr images import -
```

---

## 3. Lançamento da Infraestrutura com Terraform
Com o Kubernetes acessível e a imagem carregada, o Terraform já tem tudo o que necessita para levantar o ambiente.

```bash
# Volte para a pasta principal onde está o main.tf
cd /home/luis/Documents/proxmox/mineKubernetes

# Inicie o Terraform (só é necessário correr uma vez para baixar plugins)
terraform init

# Verifique as alterações e aplique (digite 'yes' quando solicitado)
terraform apply
```

O Terraform irá:
- Criar o namespace `teste-terraform`.
- Fazer deploy do container rodando os seus scripts.
- Expor o servidor na porta NodePort `30065`. Poderá conectar-se ao jogo usando `IP_DO_COMPUTADOR:30065`.

---

## 4. O Dashboard de Gestão (Próximos Passos)

Como escolheu a primeira opção (um Dashboard para gestão completa do servidor e dos mundos), avançaremos para o **MCSManager** ou **Crafty Controller**.

Estes Dashboards funcionam perfeitamente em Kubernetes. O grande benefício (sobretudo do **MCSManager**) é que ele é leve e permite "abraçar" os seus scripts Bash. 

**O que vai acontecer na próxima etapa (quando estiver preparado):**
1. Vamos atualizar o `main.tf` para fazer também o deploy do Dashboard.
2. Em vez do contentor arrancar o Minecraft diretamente, o K8s vai arrancar o Dashboard.
3. Acederemos ao painel de controlo no browser.
4. Pelo painel, iremos apontar para a sua pasta de scripts `/minecraft` (já presente dentro da imagem) para que o clique no botão "Iniciar" execute o seu `init-server.sh`.
5. Com isto ganha: acesso a um terminal Web (Console), visualização de gráficos de CPU e Gestor de Ficheiros do Mundo diretamente na Web!
