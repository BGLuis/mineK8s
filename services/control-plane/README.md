# mineK8s control plane

API NestJS e orquestrador. A especificação está em `docs/srs/` (autenticação e bootstrap: `docs/srs/04-SUBSISTEMA-TAILSCALE-IDENTIDADE.md`, seção 7).

## Operação

### Vincular um usuário existente ao Tailscale (`admin:link`)

O painel abre sessão por `POST /api/auth/session`, que consulta o WhoIs do tailscaled local para o IP de origem e procura o usuário com `users.tailscale_user_id` igual ao ID devolvido. Só o `POST /api/auth/bootstrap` grava esse campo. Admins criados antes do #126, admins adicionados depois do bootstrap e jogadores que precisem do painel ficam com o campo nulo e recebem `401 No account is linked to this Tailscale identity`. O comando abaixo grava o vínculo.

**Quem pode rodar.** O comando não usa JWT nem expõe endpoint: a autorização é ter acesso ao servidor onde o control plane roda (as mesmas variáveis `DB_*`, que dão acesso de escrita ao banco). Quem consegue rodá-lo já consegue editar `users` por SQL; ele só faz as checagens que o SQL manual não faz.

```bash
# pelo ID numérico do usuário no Tailscale
npm run admin:link -- --nick <nick> --tailscale-user-id <id>

# ou pelo IP tailnet de um dispositivo da pessoa; o ID vem do WhoIs do tailscaled local
npm run admin:link -- --nick <nick> --ip 100.x.y.z

# em produção, sem devDependencies, a partir do build
node dist/cli/admin-link.js --nick <nick> --ip 100.x.y.z
```

Precisa das mesmas variáveis de ambiente da API (`DB_*`, `JWT_SECRET`, e `TAILSCALE_SOCKET_PATH` para `--ip`). Com `--ip`, rode no host que tem o socket do tailscaled (padrão `/run/tailscale/tailscaled.sock`). Fora de produção o boot aplica as migrações pendentes, como a API.

Para descobrir o ID numérico sem `--ip`: `tailscale whois --json <ip-tailnet>` e o campo `UserProfile.ID`.

| Caso | Resultado | Saída |
| --- | --- | --- |
| usuário sem vínculo | grava | `Linked "<nick>" ...`, código 0 |
| mesmo par repetido | nada muda | `... nothing changed.`, código 0 |
| usuário já vinculado a outro ID | recusa; com `--force` substitui | código 1 sem `--force` |
| ID já vinculado a **outro** usuário | recusa, mesmo com `--force` | código 1 |
| nick inexistente, `--ip` sem WhoIs, tailscaled indisponível, IP de dispositivo com tag, ID que não é numérico | recusa | código 1 |
| argumentos inválidos | recusa e mostra o uso | código 2 |

Toda recusa acontece antes da escrita, então o banco não muda. O ID exigido é numérico: o login name (e-mail) não serve. Dispositivos com tag (`tag:...`) não têm conta pessoal, e vincular o dono "tagged-devices" daria o acesso a qualquer máquina com a tag.

Depois do comando a pessoa abre o painel normalmente; não precisa reiniciar a API.

### SQL de emergência

Só se o comando não puder rodar (por exemplo, sem Node no host). O índice único `uq_users_tailscale_user_id` recusa um ID que já pertence a outro usuário; nesse caso, descubra quem é o dono antes de mexer:

```sql
SELECT minecraft_nick FROM users WHERE tailscale_user_id = '<id>';  -- deve voltar vazio
UPDATE users SET tailscale_user_id = '<id>' WHERE minecraft_nick = '<nick>';
```

Se a migração `UniqueUserTailscaleId` abortar, o banco já tem IDs duplicados e a mensagem lista cada ID com os nicks que o usam. Deixe o ID em um só usuário, ponha `NULL` nos outros e rode as migrações de novo.

## Testes

```bash
npx jest --ci              # unidade
npm run test:e2e -- --ci   # HTTP com Nest real e repositórios falsos
```

Os specs `*.int.spec.ts` só rodam com um Postgres real (`TEST_DATABASE_URL`, instruções em `src/database/testing/integration-datasource.ts`):

```bash
docker run --rm -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=verify -p 55432:5432 postgres:16-alpine
TEST_DATABASE_URL=postgres://postgres:pw@localhost:55432/verify npx jest int.spec
```
