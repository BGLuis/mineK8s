# Relatório Técnico — Spike Tailcat (Issue #88 / Risco E-04)

| Campo | Valor |
|---|---|
| **Issue** | [#88 — Modo Tailcat para jogadores sem privilégio de administrador](https://github.com/BGLuis/mineK8s/issues/88) |
| **Milestone** | F9 — Tailcat e Health Bot |
| **Tipo** | Spike Investigativo de Arquitetura (`type:spike`, `area:identity`) |
| **Risco Catalogado** | ⚠️ **E-04** ([INVENTARIO-REQUISITOS-HYPERVISOR.md](INVENTARIO-REQUISITOS-HYPERVISOR.md#seção-4-análise-de-riscos-e-impedimentos-técnicos)) |
| **Veredito** | ❌ **Rejeitado por Inviabilidade Arquitetural** (Quebra de Zero-Trust e VirtualHost) |
| **Decisão de Projeto** | Manutenção exclusiva do cliente nativo oficial Tailscale via Pre-Auth Keys temporárias (`/join`) |

---

## 1. Contexto & Motivação Original

A especificação inicial em [SRS-SUBSISTEMA-TAILSCALE.md](../SRS-SUBSISTEMA-TAILSCALE.md) (§3.1–§3.3) propunha um "Modo B" de Ingress baseado no utilitário de código aberto [`tailscale/tailcat`](https://github.com/tailscale/tailcat), com o objetivo de permitir que amigos casuais e familiares sem direitos administrativos no sistema operacional (UAC/root) pudessem conectar a servidores MineK8s sem instalar drivers de rede virtual (`TUN/Wintun`).

A proposta original previa:
1. O Hypervisor executaria `tailcat serve 25565`.
2. O jogador executaria um binário portátil sem privilégios com o comando hipotético `tailcat forward <endereço> 25565:25565`.
3. O jogador abriria seu Minecraft Java Edition nativo e conectaria em `localhost:25565`.

O critério de aceite fixado para a issue [#88](https://github.com/BGLuis/mineK8s/issues/88) determinou:
> **"Só avança se E-04 tiver solução de identidade."**

---

## 2. A Realidade Técnica do Utilitário `tailcat`

A investigação técnica aprofundada revelou divergências fundamentais entre a premissa da SRS e o funcionamento real do `tailcat`:

1. **CLI e Semântica de Operação:**
   - A sintaxe real do utilitário é `tailcat serve <porta>` para o servidor e `tailcat <endereço> <porta>` para o cliente. Não existe o subcomando `tailcat forward`.
   - Trata-se de uma ferramenta experimental em Go concebida como substituto moderno e ponto-a-ponto para o `netcat`, utilizando a biblioteca `tsnet` em userspace sem coordenação central.

2. **Ausência de Coordenação / Tailnet:**
   - O `tailcat` gera pares de chaves efêmeros e estabelece um canal direto via DERP/Magicsock, **sem registrar o nó na Tailnet gerenciada**.
   - Consequentemente, o nó do cliente **não recebe um endereço IP CGNAT `100.64.0.0/10`** e **não é reconhecido pela API do Tailscale**.

---

## 3. Bloqueadores Arquiteturais Insuperáveis (E-04)

```
+---------------------------+             +--------------------------------------+
| Minecraft Client          |             | Gateway L7 (MineK8s)                 |
| Conecta em: localhost     |             | Recebe conexão vinda de: 127.0.0.1   |
| Handshake: "localhost"    |             |                                      |
+-------------+-------------+             +-------------------+------------------+
              |                                               ^
              v                                               |
+-------------+-------------+    Túnel P2P (Userspace)        |
| tailcat client            |========================> [ tailcat serve ]
| (sem IP na Tailnet)       |   (sem PROXY Protocol)          |
+---------------------------+                                 +
```

### 3.1 Quebra da Identidade Zero-Trust e Anti-Impersonation (RF-ARQ-21 / RF-TS-02)
- **Como funciona o MineK8s Oficial:** Quando um jogador conecta pelo cliente Tailscale oficial, o socket TCP atinge o Gateway L7 carregando seu IP `100.x.y.z`. O Gateway consulta a LocalAPI (`/run/tailscale/tailscaled.sock`) via `whois_driver.query_whois(ip)` e obtém a identidade comprovada (`login_name`, `display_name`, `node_id`). Em seguida, o `AccessDecisionEngine` valida se o nick declarado no pacote `LoginStart` coincide com a conta autorizada.
- **O que ocorre com Tailcat:** A conexão TCP sai do processo `tailcat serve` e atinge o listener do Gateway L7 localmente via `127.0.0.1`.
  - A consulta `tailscale whois 127.0.0.1` retorna `None` ou erro, pois `127.0.0.1` não é um endereço da Tailnet.
  - O Gateway fica cego quanto à procedência do usuário na camada de rede.
  - **Vulnerabilidade de Impersonation:** Para permitir a entrada, o Gateway teria que confiar exclusivamente na string de username enviada pelo cliente no pacote `Login Start`. Qualquer usuário poderia conectar informando o nickname de um administrador ou de outro jogador, anulando a segurança Zero-Trust do sistema.

### 3.2 Incompatibilidade com o Roteamento VirtualHost L7 (RF-GW-01 / RF-GW-02)
- O Gateway L7 unifica todos os mundos Minecraft na porta padrão `25565`. O direcionamento para o Pod correto depende do campo `server_address` inspecionado no pacote `Handshake` (ex.: `survival.mine.internal` ou `creative.mine.internal`).
- Ao utilizar o Tailcat, o cliente local do jogador conecta em `localhost:25565`. O pacote nativo do jogo envia `server_address: "localhost"`.
- A tabela de rotas (`route_table.lookup_virtual_host(25565, "localhost")`) não encontra correspondência e rejeita a conexão com `Servidor não encontrado`.
- **A única mitigação teórica seria:** Alocar uma porta TCP e um processo `tailcat` individual para cada servidor provisionado (ex.: porta 25566 para survival, 25567 para skyblock), o que violaria o requisito de listener unificado e criaria complexidade severa de ciclo de vida de daemons no host.

### 3.3 Ausência de Encapsulamento PROXY Protocol v2 (RF-GW-06)
- O `tailcat` não possui suporte para prefixar o fluxo TCP com cabeçalhos PROXY Protocol v2 contendo o endereço remoto real do cliente. Ele atua como um proxy TCP cego de bytes.

---

## 4. Matriz Comparativa Definitiva

| Dimensão Técnica | Modo Oficial Tailscale (`tag:mc-player`) | Modo Proposto Tailcat (Userspace P2P) |
|---|---|---|
| **Segurança Zero-Trust** | ✅ **Preservada:** WhoIs local mapeia IP $\rightarrow$ Usuário Tailscale | ❌ **Quebrada:** Tráfego chega como `127.0.0.1`, sem identidade criptográfica |
| **Anti-Impersonation (RF-ARQ-21)** | ✅ **Garantido:** Nick do jogo é estritamente validado contra a Tailnet | ❌ **Inoperante:** Nick vira o único identificador, vulnerável a spoofing |
| **Roteamento por Subdomínio (L7)** | ✅ **Suportado:** Cliente conecta em `mundo.mine.internal` via MagicDNS | ❌ **Incompatível:** Cliente conecta em `localhost`, quebrando o VirtualHost |
| **Porta de Conexão** | ✅ **Unificada:** Porta padrão única `25565` para todos os mundos | ⚠️ **Fragmentada:** Exigiria 1 porta e 1 daemon Tailcat por instância |
| **Estabilidade de Software** | ✅ **Produção:** Cliente oficial estável em Windows, macOS, Linux, Android, iOS | ❌ **Experimental:** Utilitário CLI sem garantias de API ou daemon service |
| **Experiência do Jogador** | ✅ **Automática:** Deep-link no portal `/join` autentica o Tailscale em 1 clique | ⚠️ **Manual:** Requer baixar binário, abrir terminal/prompt e rodar comando |

---

## 5. Veredito e Resolução Formal

Em consonância com o critério de aceite estipulado na issue [#88](https://github.com/BGLuis/mineK8s/issues/88) (*"Só avança se E-04 tiver solução de identidade"*), o Spike conclui:

1. **Inviabilidade:** O risco **E-04 não possui solução tecnicamente segura ou viável** sem comprometer os alicerces de Zero-Trust e roteamento do MineK8s.
2. **Resolução:** A issue [#88](https://github.com/BGLuis/mineK8s/issues/88) deve ser **encerrada como Rejeitada/Concluída (Spike finalizado com resultado negativo)**.
3. **Padrão Arquitetural Mantido:** A integração oficial via **Tailscale Pre-Auth Keys temporárias e automáticas (resolução #18, #19, #20, #37 em F5)** é o padrão único e definitivo para acesso de convidados privados ao Hypervisor.
