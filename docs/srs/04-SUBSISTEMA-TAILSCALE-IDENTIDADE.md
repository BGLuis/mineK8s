# Especificação de Requisitos de Software & Arquitetura (SRS)
## Módulo 04: Subsistema Tailscale, Identidade & Controle de Acesso Zero-Trust

**Metadados do Documento:**
- **Sistema:** MineKubernetes — Next-Gen Game Server Hypervisor
- **Módulo:** 04 — Tailscale Mesh, ACLs, Onboarding e Gestão de Usuários
- **Fase de Referência:** F0 — Consolidar SRS
- **Issues Resolvidas:** [#4](https://github.com/BGLuis/mineK8s/issues/4) (E-02), [#5](https://github.com/BGLuis/mineK8s/issues/5) (E-03), [#6](https://github.com/BGLuis/mineK8s/issues/6) (E-04), [#7](https://github.com/BGLuis/mineK8s/issues/7) (E-05), [#18](https://github.com/BGLuis/mineK8s/issues/18) (C-03), [#19](https://github.com/BGLuis/mineK8s/issues/19) (C-04), [#20](https://github.com/BGLuis/mineK8s/issues/20) (C-05), [#25](https://github.com/BGLuis/mineK8s/issues/25) (C-10), [#35](https://github.com/BGLuis/mineK8s/issues/35) (L-01), [#37](https://github.com/BGLuis/mineK8s/issues/37) (L-03)

---

## 1. Arquitetura de Rede Zero-Trust

O acesso a todos os servidores de Minecraft hospedados no cluster é restrito por padrão à rede privada malhada (**Tailnet** do Tailscale). Nenhuma porta de jogo é exposta abertamente na internet pública sem autenticação.

```mermaid
flowchart TD
    subgraph Internet["Internet Pública"]
        Guest["Novo Jogador / Convidado"]
    end

    subgraph TailscaleCloud["Tailscale Control Plane (Cloud API)"]
        ACL["Policy File huJSON (Tag Estática tag:mc-player)"]
        AuthKeys["Pre-Auth Keys API"]
    end

    subgraph HypervisorHost["Cluster Kubernetes / Host"]
        Funnel["Tailscale Funnel (HTTPS :443)"]
        JoinSvc["Serviço de Onboarding & Claim (:3001)"]
        LocalAPI["Tailscale Daemon (LocalAPI /run/tailscale/tailscaled.sock)"]
        Gateway["Gateway Reverso TCP L7 (:25565)"]
        DB[("PostgreSQL: users & permissions")]
    end

    Guest -->|1. Acessa Link de Convite| Funnel
    Funnel -->|Proxy Local| JoinSvc
    JoinSvc -->|2. Valida Token & Cria Chave| AuthKeys
    Guest -->|3. Ativa Tailscale no Dispositivo| TailscaleCloud
    Guest -->|4. Conecta via IP CGNAT 100.64.0.0/10| Gateway
    Gateway -->|5. WhoIs(IP do Cliente)| LocalAPI
    Gateway -->|6. Valida Acesso ao Subdomínio| DB
```

---

## 2. Política de Tags e ACLs do Tailscale (Resolução [#4] / E-02)

### 2.1 O Problema dos Wildcards Inexistentes
As versões anteriores da documentação propunham atribuir tags dinâmicas como `tag:player-<nome>` e regras de ACL usando `tag:player-*`. 
**Fato Técnico:** O motor de ACL do Tailscale (huJSON) **não possui suporte a curingas (wildcards) em tags**. Toda tag deve ser declarada explicitamente no arquivo de política. Tentar atualizar a política de ACL do Tailnet via API a cada novo convite expõe o sistema a rate-limits da Cloud API e risco de interrupção da rede inteira por falha de parsing.

### 2.2 Política de Tag Única & Autorização em Camada de Aplicação
A solução arquitetural definitiva estabelece:
1. **Tag Estática Única na Policy:** Todos os convidados ingressam na Tailnet sob a tag compartilhada `tag:mc-player`.
2. **Regra de Rede no huJSON:** A política de rede concede permissão para `tag:mc-player` conectar-se às portas `25565` do Gateway L7 e `8080` do painel (área do jogador):
   ```json
   {
     "tagOwners": {
       "tag:mc-gateway": ["autogroup:admin"],
       "tag:mc-player":  ["tag:mc-gateway"]
     },
     "acls": [
       {
         "action": "accept",
         "src": ["tag:mc-player"],
         "dst": ["tag:mc-gateway:25565", "tag:mc-gateway:8080"]
       }
     ]
   }
   ```
3. **Autorização Granular na Aplicação:** A decisão sobre *qual servidor* o jogador pode acessar (ex.: `survival`, `hardcore`, `modpack`) é executada no **Gateway L7 e Control Plane**:
   - O Gateway captura o IP do cliente (`100.x.y.z`), consulta o Tailscale WhoIs para obter o `node_id` e o `tailscale_user_id`, e valida no PostgreSQL se o jogador associado tem permissão para a instância solicitada.

---

## 3. Limites de Dispositivos e Tailscale Funnel (Resolução [#5] / E-03)

- **Cota Real de Dispositivos:** O plano pessoal do Tailscale permite até 50 dispositivos com tags. O Control Plane monitora o número de nós ativos e rejeita emissão de novos convites caso a cota se aproxime do limite.
- **Portas Permitidas no Tailscale Funnel:** O Tailscale Funnel opera estritamente nas portas públicas `443`, `8443` e `10000`. O serviço de convite (`/join`) escuta internamente na porta `3001`, e o comando de inicialização do Funnel mapeia a porta pública `443` para o backend:
  ```bash
  tailscale funnel --bg --port 443 http://127.0.0.1:3001
  ```

---

## 4. Decisão sobre Tailcat & Restauração de Skins (Resolução [#6], [#7])

- **Tailcat ([#6] / E-04):** O utilitário `tailcat` (proxy userspace sem root) esconde o IP real do cliente (tráfego chega como `127.0.0.1`) e impede WhoIs e virtual hosting. **Decisão:** Postergar Tailcat para a Milestone F9. O cliente oficial da Tailscale (instalado no Windows, macOS, Linux, iOS ou Android) é o padrão oficial do projeto.
- **Skins em Servidores Offline ([#7] / E-05):** O mod `CustomSkinLoader` é puramente *client-side* e inoperante em servidores. Para restaurar skins oficiais da Mojang em servidores com contas offline/convidados, o Hypervisor utiliza plugins consolidados de servidor (ex.: `SkinsRestorer` em Paper/Purpur ou `FabricTailor` em modpacks Fabric).

---

## 5. LocalAPI Socket & Transação de Claim com Compensação (Resolução [#25], [#37])

### 5.1 Caminho do Socket da LocalAPI (Resolução [#25] / C-10)
O caminho do Unix socket é configurável via variável de ambiente:
- `TAILSCALE_SOCKET_PATH`: Padrão `/run/tailscale/tailscaled.sock` (com fallback automático para `/var/run/tailscale/tailscaled.sock`).

### 5.2 Transação de Claim com Compensação (Resolução [#37] / L-03)
No fluxo de resgate de convite (`claimInvite`), o cliente web envia o token de convite e seu nickname Minecraft. Para garantir atomicidade e evitar consumo de cota sem chave gerada:
1. O Control Plane abre uma transação no PostgreSQL e adquire lock na linha do convite (`SELECT ... FOR UPDATE`).
2. Verifica validade, expiração e se `used_count < max_uses`.
3. Executa a chamada HTTP para a API do Tailscale (`POST https://api.tailscale.com/api/v2/tailnet/.../keys`) solicitando a *AuthKey* pré-autenticada com `tag:mc-player`.
4. Se a chamada à API do Tailscale falhar, a transação do banco é revertida com `ROLLBACK` e nenhum uso é decrementado.
5. Se a chave for emitida com sucesso, o registro do usuário é criado/atualizado, `used_count` é incrementado em 1 e a transação é confirmada (`COMMIT`).
6. A AuthKey é retornada ao navegador do jogador com link de abertura direta no aplicativo do Tailscale (`tailscale://join-tailnet?key=...`).

---

## 6. Esquema Unificado de Usuários & Convites (Resolução [#18], [#19], [#20])

### 6.1 Tabela `users`
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tailscale_user_id VARCHAR(100) UNIQUE,
    tailscale_node_id VARCHAR(100) UNIQUE,
    minecraft_nickname VARCHAR(16) NOT NULL UNIQUE,
    minecraft_uuid UUID UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('ADMIN', 'PLAYER')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tailscale_node ON users(tailscale_node_id);
CREATE INDEX idx_users_nickname ON users(minecraft_nickname);
```

### 6.2 DTO de Convites (`CreateInviteDTO`)
```typescript
export interface CreateInviteDTO {
  name: string;                   // Identificador legível do convite
  maxUses: number;                // Limite de ativações permitidas
  expiresAt: string | null;       // Data de expiração (ISO-8601)
  allowedServerIds: string[];     // IDs das instâncias autorizadas
}
```

- **URL de Onboarding:** `https://join.<dominio-publico>/?token=<invite_secret>` (Resolução **C-05**).
- **Validação de Nickname Obrigatória no Claim:** O jogador deve obrigatoriamente preencher o nickname no momento do claim. A auto-adoção dinâmica de nick no primeiro handshake é restrita unicamente ao operador/admin inicial (Resolução **C-04**).

---

## 7. Autenticação da API & Bootstrap do Primeiro Admin (Resolução [#35] / L-01)

A API do Control Plane implementa dois mecanismos de autenticação:
1. **Autenticação Zero-Trust Tailscale (Painel Web na VPN):**
   - Requisições provenientes da interface Tailscale têm seu IP de origem inspecionado via LocalAPI (`WhoIs`).
   - Se o `tailscale_user_id` possuir o papel `role = 'ADMIN'` no banco, a sessão é autenticada automaticamente sem necessidade de login por senha.
2. **Tokens Bearer JWT:**
   - Utilizados para automações, rotinas de CLI e sessões onde a verificação de WhoIs não estiver disponível.
3. **Bootstrap do Primeiro Admin:**
   - Na primeira inicialização do sistema, caso a tabela `users` não possua nenhum usuário cadastrado com `role = 'ADMIN'`, o Control Plane gera um token criptográfico efêmero (`INITIAL_BOOTSTRAP_TOKEN`) exibido no log do container.
   - O operador utiliza este token no endpoint `POST /api/auth/bootstrap` para cadastrar o primeiro administrador com segurança.
