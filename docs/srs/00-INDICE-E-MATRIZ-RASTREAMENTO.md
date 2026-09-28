# Índice da Especificação de Requisitos & Matriz de Rastreabilidade F0

## 1. Visão Geral da Documentação Modular

A arquitetura do **MineKubernetes** está documentada de forma modular no diretório `docs/srs/`, cobrindo exaustivamente todas as dimensões de infraestrutura, rede, segurança e ciclo de vida:

| Módulo | Documento | Escopo e Responsabilidades Principais |
| :---: | :--- | :--- |
| **00** | [00-INDICE-E-MATRIZ-RASTREAMENTO.md](00-INDICE-E-MATRIZ-RASTREAMENTO.md) | Índice geral e matriz de rastreabilidade de todas as 43 issues da Milestone F0. |
| **01** | [01-ARQUITETURA-GERAL.md](01-ARQUITETURA-GERAL.md) | Visão executiva, topologia de cluster dedicado, namespace, runtimes (Rust + NestJS), máquina de estados canônica e dimensionamento de memória cgroups. |
| **02** | [02-GATEWAY-L7.md](02-GATEWAY-L7.md) | Gateway TCP reverso em Rust, decodificação de handshake (Intent 3 Transfer), suporte a DNS SRV aliases, smart kick e listeners de rede. |
| **03** | [03-DRIVER-RCON-LOGS.md](03-DRIVER-RCON-LOGS.md) | Driver RCON binário persistente, codec com limites separados (1446 / 4110 bytes), remontagem multi-packet, timeouts dinâmicos e logs de auditoria. |
| **04** | [04-SUBSISTEMA-TAILSCALE-IDENTIDADE.md](04-SUBSISTEMA-TAILSCALE-IDENTIDADE.md) | Integração Zero-Trust com Tailscale, política de tag única `tag:mc-player`, Funnel na porta 443, compensação de claim, schema de usuários e autenticação de API. |
| **05** | [05-STORAGE-MODPACKS-BACKUPS.md](05-STORAGE-MODPACKS-BACKUPS.md) | Armazenamento local-path, cotas via control plane, cache CAS no PostgreSQL, desacoplamento InstallerJob/Runner e hot backup com staging reflink atômico. |
| **06** | [06-CONTROL-PLANE-WEB-SPA.md](06-CONTROL-PLANE-WEB-SPA.md) | Control Plane NestJS, entidades TypeORM com FKs em cascata, segurança de arquivos contra Zip-Slip e especificação funcional da interface Angular SPA. |

---

## 2. Matriz de Rastreabilidade das 43 Issues de F0

A tabela a seguir comprova a resolução de cada uma das 43 issues abertas na Milestone F0:

### 2.1 Épico e Spikes de Infraestrutura
| Issue | Título da Issue | Módulo SRS | Seção / Resolução Canônica |
| :---: | :--- | :---: | :--- |
| **[#2](https://github.com/BGLuis/mineK8s/issues/2)** | Épico F0: Consolidar SRS | Todos | Resolução e consolidação de 100% dos itens da auditoria em documentação modular e consistente. |
| **[#44](https://github.com/BGLuis/mineK8s/issues/44)** | Definir topologia-alvo do cluster | **Módulo 01** | Seção 2: Cluster dedicado padrão k8s/k3s com cgroups v2, storage local-path NVMe e afinidade local. |

### 2.2 Premissas Desmentidas pela Documentação Oficial (`E-01` a `E-08`)
| Issue | Código | Módulo SRS | Resolução Canônica |
| :---: | :---: | :---: | :--- |
| **[#3](https://github.com/BGLuis/mineK8s/issues/3)** | `E-01` | **Módulo 03** | Seção 2: Codec com limites assimétricos: Encode comando $\le 1446$ bytes, Decode resposta $\le 4110$ bytes e remontagem multi-packet com pacote sentinela. |
| **[#4](https://github.com/BGLuis/mineK8s/issues/4)** | `E-02` | **Módulo 04** | Seção 2: Política de tag estática única `tag:mc-player` na policy huJSON; autorização granular por servidor transferida para o Gateway e Control Plane. |
| **[#5](https://github.com/BGLuis/mineK8s/issues/5)** | `E-03` | **Módulo 04** | Seção 3: Dimensionamento para o teto real de 50 nós tagged; Tailscale Funnel escutando na porta pública 443 e roteando localmente para a 3001. |
| **[#6](https://github.com/BGLuis/mineK8s/issues/6)** | `E-04` | **Módulo 04** | Seção 4: Tailcat postergado para F9; utilização prioritária do aplicativo oficial nativo Tailscale que preserva o IP CGNAT 100.64.0.0/10 e subdomínios. |
| **[#7](https://github.com/BGLuis/mineK8s/issues/7)** | `E-05` | **Módulo 04** | Seção 4: Remoção definitiva de CustomSkinLoader no servidor; suporte a skins em servidores offline através de plugins consolidados de servidor (SkinsRestorer). |
| **[#8](https://github.com/BGLuis/mineK8s/issues/8)** | `E-06` | **Módulo 02** | Seção 2 e 4: Handshake Intent 3 (Transfer) tratado como Login; Smart Kick executado via comando RCON `/kick` + encerramento com TCP RST. |
| **[#9](https://github.com/BGLuis/mineK8s/issues/9)** | `E-07` | **Módulo 02** | Seção 3: Suporte a múltiplos aliases e mapeamento do target de registros SRV na tabela de rotas de subdomínio do Gateway. |
| **[#10](https://github.com/BGLuis/mineK8s/issues/10)** | `E-08` | **Módulo 05** | Seção 1: Monitoramento contínuo de capacidade de disco pelo Control Plane com bloqueio de novos provisionamentos acima de 85% de uso. |

### 2.3 Algoritmos Quebrados de Backup e Restauração (`D-01` a `D-05`)
| Issue | Código | Módulo SRS | Resolução Canônica |
| :---: | :---: | :---: | :--- |
| **[#11](https://github.com/BGLuis/mineK8s/issues/11)** | `D-01` | **Módulo 05** | Seção 3: Compressão `tar` apontada estritamente para o diretório de staging `/data/.staging/`, sem empacotar o `/data` vivo. |
| **[#12](https://github.com/BGLuis/mineK8s/issues/12)** | `D-02` | **Módulo 05** | Seção 3: Staging captura todas as pastas de mundo (`world/`, `world_nether/`, `world_the_end/` e dimensões customizadas). |
| **[#13](https://github.com/BGLuis/mineK8s/issues/13)** | `D-03` | **Módulo 05** | Seção 3: Pipeline seguro com freeze RCON (`save-off`), cópia atômica (reflink em CoW ou cópia física rápida) e descongelamento imediato (`save-on`). |
| **[#14](https://github.com/BGLuis/mineK8s/issues/14)** | `D-04` | **Módulo 05** | Seção 3: Eliminação de arquivos de sinal inobserváveis; freeze orquestrado e cronometrado diretamente via RCON persistente. |
| **[#15](https://github.com/BGLuis/mineK8s/issues/15)** | `D-05` | **Módulo 05** | Seção 4: Script de restauração com `nodeAffinity`, checagem SHA-256, criação de backup `PRE_RESTORE`, preservação de `lost+found` e rollback automático. |

### 2.4 Contradições Unificadas entre Especificações (`C-01` a `C-19`)
| Issue | Código | Módulo SRS | Resolução Canônica |
| :---: | :---: | :---: | :--- |
| **[#16](https://github.com/BGLuis/mineK8s/issues/16)** | `C-01` | **Módulo 01** | Seção 4: Máquina de estados unificada em 8 estados declarativos; `is_maintenance` separado como flag booleana de política. |
| **[#17](https://github.com/BGLuis/mineK8s/issues/17)** | `C-02` | **Módulos 03 e 06** | Remoção integral de Prisma; consolidação em TypeORM com PostgreSQL. |
| **[#18](https://github.com/BGLuis/mineK8s/issues/18)** | `C-03` | **Módulo 04** | Seção 6: Esquema unificado da tabela `users` com `tailscale_user_id`, `node_id`, `minecraft_nickname` obrigatório e role. |
| **[#19](https://github.com/BGLuis/mineK8s/issues/19)** | `C-04` | **Módulo 04** | Seção 6: Nickname obrigatório no momento do resgate do convite (`claimInvite`); auto-adoção restrita ao admin inicial. |
| **[#20](https://github.com/BGLuis/mineK8s/issues/20)** | `C-05` | **Módulo 04** | Seção 6: `CreateInviteDTO` com multi-uso padronizado e URL de onboarding no formato `https://join.<dominio>/?token=...`. |
| **[#21](https://github.com/BGLuis/mineK8s/issues/21)** | `C-06` | **Módulo 02 e 04** | Regex canônica unificada em todos os componentes: `^[a-zA-Z0-9_]{3,16}$`. |
| **[#22](https://github.com/BGLuis/mineK8s/issues/22)** | `C-07` | **Módulo 02** | Seção 6: TTL do cache WhoIs padronizado em 120 segundos. |
| **[#23](https://github.com/BGLuis/mineK8s/issues/23)** | `C-08` | **Módulo 01** | Seção 5: `max-tick-time=60000` em Vanilla e `-1` em Modpacks, com Watchdog do Hypervisor cobrindo travamentos. |
| **[#24](https://github.com/BGLuis/mineK8s/issues/24)** | `C-09` | **Módulo 01** | Seção 5: Janela de Startup Probe diferenciada: até 3.25 min para Vanilla e até 15.5 min para Modpacks pesados. |
| **[#25](https://github.com/BGLuis/mineK8s/issues/25)** | `C-10` | **Módulo 04** | Seção 5: Caminho do socket LocalAPI configurável via `TAILSCALE_SOCKET_PATH` (padrão `/run/tailscale/tailscaled.sock`). |
| **[#26](https://github.com/BGLuis/mineK8s/issues/26)** | `C-11` | **Módulo 01** | Seção 2: Isolamento exclusivo em namespace único `minekubernetes`. |
| **[#27](https://github.com/BGLuis/mineK8s/issues/27)** | `C-12` | **Módulo 02** | Seção 5: Filtro `SEC-01` aplicado estritamente no listener Tailscale (100.64.0.0/10); listener público com regras independentes. |
| **[#28](https://github.com/BGLuis/mineK8s/issues/28)** | `C-13` | **Módulo 02** | Seção 4: Conexão duplicada do mesmo jogador derruba a sessão anterior e aceita a nova. |
| **[#29](https://github.com/BGLuis/mineK8s/issues/29)** | `C-14` | **Módulo 01** | Seção 5: Readiness Probe via Server List Ping (SLP) nativo na porta 25565, descartando TCP Ping bruto. |
| **[#30](https://github.com/BGLuis/mineK8s/issues/30)** | `C-15` | **Módulo 05** | Seção 2: Injeção de `enforce-secure-chat=false` diretamente no `server.properties` pelo InstallerJob. |
| **[#31](https://github.com/BGLuis/mineK8s/issues/31)** | `C-16` | **Módulo 03** | Seção 4: Enum `ExecutionSource` unificado: `['REST_API', 'TERMINAL_SESSION', 'SLEEP_MODE_WORKER', 'BACKUP_ROUTINE', 'HEALTH_BOT']`. |
| **[#32](https://github.com/BGLuis/mineK8s/issues/32)** | `C-17` | **Módulo 01** | Seção 5: Margem de container cgroups padronizada em `Heap (-Xmx) + 1.5 GiB`. |
| **[#33](https://github.com/BGLuis/mineK8s/issues/33)** | `C-18` | **Módulo 05** | Seção 2: Desacoplamento arquitetural: `InstallerJob` com CAS + Pod Runner com OpenJDK oficial limpo. |
| **[#34](https://github.com/BGLuis/mineK8s/issues/34)** | `C-19` | **Módulo 01** | Seção 3: Declaração oficial da arquitetura poliglota: Gateway em Rust e Control Plane em Node.js/NestJS. |

### 2.5 Lacunas Técnicas Preenchidas (`L-01` a `L-09`)
| Issue | Código | Módulo SRS | Resolução Canônica |
| :---: | :---: | :---: | :--- |
| **[#35](https://github.com/BGLuis/mineK8s/issues/35)** | `L-01` | **Módulo 04 e 06** | Especificação de auth via Tailscale WhoIs + JWT Bearer, com token efêmero de bootstrap para o primeiro admin. |
| **[#36](https://github.com/BGLuis/mineK8s/issues/36)** | `L-02` | **Módulo 06** | Seção 2: Integridade relacional formalizada com `ON DELETE CASCADE` em todas as tabelas de associação. |
| **[#37](https://github.com/BGLuis/mineK8s/issues/37)** | `L-03` | **Módulo 04** | Seção 5: Transação atômica de claim com chamada prévia à API do Tailscale e rollback seguro contra queima de cota. |
| **[#38](https://github.com/BGLuis/mineK8s/issues/38)** | `L-04` | **Módulo 06** | Seção 3: Prevenção de Zip-Slip via normalização de caminhos e bloqueio estrito de links simbólicos externos. |
| **[#39](https://github.com/BGLuis/mineK8s/issues/39)** | `L-05` | **Módulo 05** | Seção 1: Garantia de exclusividade de I/O por volume RWO + confirmação de terminação de Pod (`replicas: 0`). |
| **[#40](https://github.com/BGLuis/mineK8s/issues/40)** | `L-06` | **Módulo 05** | Seção 3: Nomenclatura determinística `{serverId}_{timestamp}_{type}.tar.zst` com hash salvo no banco. |
| **[#41](https://github.com/BGLuis/mineK8s/issues/41)** | `L-07` | **Módulo 05** | Seção 2: Índice LRU de modpacks centralizado no PostgreSQL, mantendo o volume `/cache` apenas para blobs SHA-256. |
| **[#42](https://github.com/BGLuis/mineK8s/issues/42)** | `L-08` | **Módulo 03** | Seção 3: Timeouts de RCON granulares por comando (5s para pings/listas e 60s+ para `save-all flush`). |
| **[#43](https://github.com/BGLuis/mineK8s/issues/43)** | `L-09` | **Módulo 06** | Seção 4: Especificação funcional completa das 7 telas essenciais da interface Web SPA em Angular. |
