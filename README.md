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
