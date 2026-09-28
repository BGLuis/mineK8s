# Especificação de Requisitos de Software & Arquitetura (SRS)
## Módulo 03: Driver RCON & Pipeline de Logs

**Metadados do Documento:**
- **Sistema:** MineKubernetes — Next-Gen Game Server Hypervisor
- **Módulo:** 03 — Driver RCON Binário, Sessões Interativas e Auditoria
- **Fase de Referência:** F0 — Consolidar SRS
- **Issues Resolvidas:** [#3](https://github.com/BGLuis/mineK8s/issues/3) (E-01), [#17](https://github.com/BGLuis/mineK8s/issues/17) (C-02), [#31](https://github.com/BGLuis/mineK8s/issues/31) (C-16), [#42](https://github.com/BGLuis/mineK8s/issues/42) (L-08)

---

## 1. Eliminação de RCE & Comunicação Segura de Processos

A implementação legada do sistema executava comandos administrativos via interpolação de strings em shell (`child_process.exec("kubectl exec ... -- rcon-cli \"" + cmd + "\"")`), gerando vetores críticos de **Execução Remota de Código (RCE)** e consumindo milhares de execuções de processos por dia.

A nova arquitetura estabelece comunicação direta via soquetes TCP persistentes utilizando o protocolo binário **Source RCON (Valve / Minecraft RCON)**. O Control Plane atua como cliente TCP direto do serviço RCON interno de cada Pod de Minecraft, sem intermediários de shell ou processos externos.

---

## 2. Codec RCON Binário & Limites de Buffer (Resolução [#3] / E-01)

A estrutura do pacote binário RCON em conformidade com o protocolo oficial é:

```
+------------------------------------+
| Packet Length (4 bytes, int32-LE)   |
+------------------------------------+
| Request ID    (4 bytes, int32-LE)   |
+------------------------------------+
| Packet Type   (4 bytes, int32-LE)   |
+------------------------------------+
| Payload Body  (Variável, UTF-8)     |
+------------------------------------+
| Null Pad 1    (1 byte, 0x00)        |
+------------------------------------+
| Null Pad 2    (1 byte, 0x00)        |
+------------------------------------+
```

### 2.1 Limites de Enquadramento no Fio
As especificações anteriores aplicavam um teto arbitrário e simétrico de 4096 bytes para decodificação, causando quebras de conexão quando o servidor Minecraft respondia com saídas extensas. Os limites canônicos adotados são:

| Sentido do Pacote | Limite Máximo de Payload | Limite Total no Fio | Justificativa Técnica |
| :--- | :--- | :--- | :--- |
| **Cliente $\rightarrow$ Servidor (C $\rightarrow$ S)** | **1.446 bytes** | **1.460 bytes** | Garante que comandos enviados pelo Control Plane caibam integralmente em um único segmento TCP padrão (MTU 1500 bytes - 40 bytes cabeçalhos IP/TCP - 14 bytes RCON). |
| **Servidor $\rightarrow$ Cliente (S $\rightarrow$ C)** | **4.096 bytes** | **4.110 bytes** | O servidor Minecraft gera chunks de resposta de até 4096 bytes de corpo + 14 bytes de cabeçalhos. O decodificador aceita quadros de até 4110 bytes sem fechar o socket. |

### 2.2 Algoritmo de Remontagem Multi-Packet
Quando uma resposta excede 4096 bytes (ex.: comando `help` em modpack com centenas de comandos, ou dumps de inventário), o servidor Minecraft divide a mensagem em múltiplos pacotes RCON sequenciais.

Como o protocolo RCON do Minecraft não inclui um marcador nativo de "fim de transmissão", o driver implementa o padrão canônico da indústria:
1. Ao enviar um comando longo, o driver enfileira um segundo pacote "sentinela" dummy com tipo `EXECCOMMAND` e corpo vazio (`""`).
2. O servidor Minecraft processa a resposta completa do comando principal (emitindo 1 ou mais pacotes de até 4096 bytes) e, ao terminar, responde ao pacote sentinela com uma resposta vazia.
3. Ao receber a resposta correspondente ao ID do pacote sentinela, o driver tem garantia determinística de que o fluxo do comando principal foi concluído, concatenando os buffers em UTF-8 antes de entregar à camada de aplicação.

---

## 3. Timeouts Granulares por Tipo de Comando (Resolução [#42] / L-08)

Um timeout estático curto (como 5 segundos) bloqueia a execução de comandos legítimos que realizam I/O pesado de disco. O driver adota políticas de timeout parametrizadas:

```typescript
export interface RconCommandPolicy {
  commandPrefix: string;
  timeoutMs: number;
}

export const RCON_TIMEOUT_POLICIES: RconCommandPolicy[] = [
  { commandPrefix: 'save-all', timeoutMs: 60_000 },    // Flush completo de chunks em disco
  { commandPrefix: 'save-off', timeoutMs: 15_000 },    // Congelamento de escrita
  { commandPrefix: 'save-on',  timeoutMs: 15_000 },    // Descongelamento
  { commandPrefix: 'chunky',   timeoutMs: 120_000 },   // Pré-geração de terreno
  { commandPrefix: 'list',     timeoutMs: 5_000 },     // Consulta instantânea de jogadores
  { commandPrefix: 'default',  timeoutMs: 8_000 },     // Demais comandos administrativos
];
```

---

## 4. Tabela de Auditoria & Enum `execution_source` (Resolução [#17], [#31])

Todo comando executado no console RCON de qualquer servidor é registrado de forma imutável para conformidade, segurança e auditoria forense.

### 4.1 Entidade TypeORM (`RconAuditLog`)
```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ExecutionSource {
  REST_API = 'REST_API',
  TERMINAL_SESSION = 'TERMINAL_SESSION',
  SLEEP_MODE_WORKER = 'SLEEP_MODE_WORKER',
  BACKUP_ROUTINE = 'BACKUP_ROUTINE',
  HEALTH_BOT = 'HEALTH_BOT',
}

@Entity('rcon_audit_logs')
export class RconAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  serverId: string;

  @Column({ type: 'enum', enum: ExecutionSource })
  executionSource: ExecutionSource;

  @Column({ type: 'varchar', length: 100, nullable: true })
  executedByUserId: string | null;

  @Column({ type: 'text' })
  command: string;

  @Column({ type: 'text', nullable: true })
  responseExcerpt: string | null;

  @Column({ type: 'int' })
  latencyMs: number;

  @Column({ type: 'boolean' })
  isSuccess: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
```

---

## 5. Console Interativo em Tempo Real (WebSockets)

Para permitir que administradores usem a UI para interagir com o servidor:
1. **Gateway WebSocket:** Conexão autenticada via token JWT no endpoint `/ws/servers/:id/terminal`.
2. **Buffer Circular em Memória (Ring Buffer):** Cada instância ativa no Control Plane mantém os últimos 500 registros de logs e comandos em memória para fornecer histórico instantâneo ao abrir a aba de console.
3. **Controle de Vazão:** Comandos emitidos pela UI sofrem rate-limiting (máximo 5 comandos/segundo por sessão administrativa) para prevenir ataques de negação de serviço na JVM.
