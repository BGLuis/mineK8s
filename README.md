# MineKubernetes — Next-Gen Game Server Hypervisor

Hypervisor e Orquestrador de instâncias de Minecraft de alta performance com Gateway TCP L7 reverso, controle de acesso Zero-Trust via Tailscale e gestão autônoma de instâncias OCI.

---

## 📖 Documentação de Especificação e Arquitetura (SRS Consolidada)

O projeto está sendo reimplementado do zero seguindo rigorosos padrões de engenharia de software e infraestrutura de servidores de jogos. Toda a especificação funcional, contratos de API, máquina de estados do ciclo de vida, gerenciamento de I/O de processos e peculiaridades do Minecraft estão documentados nos módulos da SRS:

* 📑 **[00 — Índice Geral & Matriz de Rastreabilidade F0](docs/srs/00-INDICE-E-MATRIZ-RASTREAMENTO.md)**
* 🏗️ **[01 — Arquitetura Geral, Topologia e Ciclo de Vida](docs/srs/01-ARQUITETURA-GERAL.md)**
* 🌐 **[02 — Gateway TCP L7 & Virtual Hosting](docs/srs/02-GATEWAY-L7.md)**
* 💻 **[03 — Driver RCON Binário & Auditoria](docs/srs/03-DRIVER-RCON-LOGS.md)**
* 🔒 **[04 — Subsistema Tailscale, Identidade & Zero-Trust](docs/srs/04-SUBSISTEMA-TAILSCALE-IDENTIDADE.md)**
* 💾 **[05 — Storage Local, Modpacks & Backups Atômicos](docs/srs/05-STORAGE-MODPACKS-BACKUPS.md)**
* 🖥️ **[06 — Control Plane API & Interface Web SPA](docs/srs/06-CONTROL-PLANE-WEB-SPA.md)**

> **Documentação de Origem e Auditoria:**
> - [Inventário de Requisitos e Auditoria (Relatório)](docs/reports/INVENTARIO-REQUISITOS-HYPERVISOR.md)
> - Documentos base de especificação: `docs/SRS-*.md`

---

## 🏷️ Histórico do Projeto & Branch Legacy

A implementação legada (v1) foi arquivada e preservada integralmente na branch:
```bash
git checkout legacy
```

---

## 🎯 Pilares da Nova Arquitetura

1. **Gateway TCP L7 de Baixa Latência:** Terminação única na porta `25565`, decodificação de handshake com virtual hosting por subdomínio e proteção contra impersonação no pacote `Login Start`.
2. **Ciclo de Vida Declarativo:** Máquina de estados com sondas desacopladas (*Startup*, *Readiness* e *Liveness/Watchdog*), suporte a *Scale-to-Zero* (hibernação por inatividade) e *Graceful Shutdown* (`save-all flush` + `stop`).
3. **Comunicação Segura de Processos:** Protocolo binário RCON direto sobre soquetes TCP persistentes, eliminando interpolação de comandos em shells e vetores de RCE.
4. **Armazenamento de Alta Performance:** Volumes locais dedicados NVMe/local-path com rotinas de backup e restauração atômica.

---

## 🐳 Imagens de container

As duas imagens são construídas a partir da raiz do repositório (o `.dockerignore` é uma allowlist):

```bash
docker build -f services/control-plane/Dockerfile -t minekubernetes/control-plane .   # API + SPA + gRPC
docker build -f crates/gateway/Dockerfile -t minekubernetes/gateway .                 # Gateway L7
```

Ambas rodam como `nonroot` (UID 65532) sobre distroless, sem shell.

**Control plane** (`3000` API e SPA, `50051` gRPC do gateway). Com `NODE_ENV=production` (padrão da imagem) o boot **não** aplica migrações; rode-as antes de cada versão nova, por exemplo num init container:

```bash
docker run --rm --env-file .env minekubernetes/control-plane \
  services/control-plane/node_modules/typeorm/cli.js migration:run -d services/control-plane/dist/database/data-source.js
```

O `admin:link` fica em `services/control-plane/dist/cli/admin-link.js` (mesmo formato de argumentos de `services/control-plane/README.md`). Defina `NODE_OPTIONS=--max-old-space-size=<~75% do limite de memória em MiB>`: o V8 dimensiona o heap pelo limite do cgroup sem folga e o kernel mata o processo antes do GC reagir. Em repouso usa ~115 MiB; `512Mi` com `--max-old-space-size=384` é um ponto de partida. Os diretórios de escrita padrão (`/app/storage/servers`, `/backups`, `/cache`) já pertencem ao UID 65532.

**Gateway** (`25565` Minecraft, `9090` `/metrics` e `/healthz`). Precisa do socket do `tailscaled` montado em `TAILSCALE_SOCKET_PATH` e de `CONTROL_PLANE_GRPC_URL` (por exemplo `http://control-plane:50051`). Em repouso usa ~1,5 MiB. A imagem declara `STOPSIGNAL SIGINT` porque o binário só encerra com Ctrl+C.
