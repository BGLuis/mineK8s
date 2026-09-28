# MineKubernetes — Next-Gen Game Server Hypervisor

Hypervisor e Orquestrador de instâncias de Minecraft de alta performance com Gateway TCP L7 reverso, controle de acesso Zero-Trust via Tailscale e gestão autônoma de instâncias OCI.

---

## 📖 Documentação de Especificação e Arquitetura

O projeto está sendo reimplementado do zero seguindo rigorosos padrões de engenharia de software e infraestrutura de servidores de jogos. Toda a especificação funcional, contratos de API, máquina de estados do ciclo de vida, gerenciamento de I/O de processos e peculiaridades do Minecraft estão documentados em:

* **[Arquitetura Geral & Hypervisor (SRS)](docs/SRS-ARQUITETURA-HYPERVISOR.md)**: Ciclo de vida declarativo, pods OCI, probes de saúde, scale-to-zero e APIs de controle.
* **[Gateway Reverso TCP L7 & Protocolo Minecraft (SRS)](docs/SRS-GATEWAY-L7.md)**: Motor de rede assíncrono em Rust/Tokio, virtual hosting, Server List Ping / Rich MOTD dinâmico, auto-wake com retenção de socket e proteção contra impersonação.
* **[Driver RCON Binário, Pipeline de Logs & Control Plane (SRS)](docs/SRS-DRIVER-RCON-PIPELINE-LOGS.md)**: Conexão TCP persistente direta (anti-RCE), anel circular de 500 logs em memória, WebSockets e persistência TypeORM.
* **[Rede Mesh Tailscale & Identidade Zero-Trust (SRS)](docs/SRS-SUBSISTEMA-TAILSCALE.md)**: Autenticação por nó/tag, controle granular de acesso (Public, Group, Individual, Maintenance), portal `/join` e túneis userspace Tailcat.
* **[Gerenciador de Armazenamento, Backups Atômicos & Modpacks (SRS)](docs/SRS-STORAGE-MODPACKS-BACKUPS.md)**: Gestão de NVMe local com POSIX UID 1000, backup quente por hardlinks, restauração transacional com staging e motor declarativo CurseForge/Modrinth com cache CAS.

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
