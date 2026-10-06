import { Page, expect, test } from '@playwright/test';

import { BOOTSTRAP_TOKEN } from './env';
import { LIST_REPLY } from './fakes/minecraft';

const ADMIN_NICK = 'AdminE2E';
const SERVER_NAME = 'Mundo E2E';
const SUBDOMAIN = 'mundo-e2e';
const INVITE_NAME = 'Amigos E2E';

// One admin session walks the flows in order: each one needs what the previous one created.
test.describe.configure({ mode: 'serial' });

let page: Page;
let serverPath = '';
let joinUrl = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test('bootstrap do 1º admin e login pela VPN com a mesma identidade do Tailscale', async ({
  browser,
}) => {
  await page.goto('/login');
  await page.getByLabel('Token de instalação').fill(BOOTSTRAP_TOKEN);
  await page.getByLabel('Seu nick do Minecraft').fill(ADMIN_NICK);
  await page.getByRole('button', { name: 'Criar primeiro administrador' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // A new browser has no token: only the WhoIs link written by the bootstrap can sign it in.
  const vpn = await browser.newPage();
  await vpn.goto('/login');
  await vpn.getByRole('button', { name: 'Entrar como admin' }).click();
  await expect(vpn).toHaveURL(/\/$/);
  await vpn.close();
});

test('criar servidor Vanilla e ligá-lo até READY', async () => {
  await page.goto('/servers/new');
  await page.getByText('Vanilla', { exact: true }).click();
  await page.getByLabel('Versão do Minecraft').fill('1.21.1');
  await page.getByRole('button', { name: /Próximo|Continuar/ }).click();
  await page.getByRole('button', { name: /Próximo|Continuar/ }).click();
  await page.getByLabel('Nome do servidor').fill(SERVER_NAME);
  await page.getByLabel('Endereço (subdomínio)').fill(SUBDOMAIN);
  await page.getByRole('button', { name: /Próximo|Continuar|Revisar/ }).click();
  await page.getByRole('button', { name: 'Criar servidor' }).click();

  await expect(page).toHaveURL(/\/servers\/[0-9a-f-]{36}$/);
  serverPath = new URL(page.url()).pathname;
  await expect(page.getByRole('heading', { name: SERVER_NAME })).toBeVisible();
  // Resolved from the version metadata at creation (fakes/mojang.ts), not fixed by the runner image.
  await expect(page.getByText('Java 21', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ligar' }).click();
  // The reconciler promotes STARTING to READY only after a successful Server List Ping.
  await expect(page.getByRole('button', { name: 'Parar' })).toBeVisible({ timeout: 15_000 });
});

test('console: /list vai pelo RCON e a resposta volta por command_output', async () => {
  await page.goto(`${serverPath}/console`);
  await expect(page.getByRole('status').filter({ hasText: 'Conectado' })).toBeVisible();

  const input = page.getByPlaceholder('Digite um comando (↑/↓ histórico)');
  await input.fill('/list');
  await input.press('Enter');

  await expect(page.getByText('> list')).toBeVisible();
  await expect(page.getByText(LIST_REPLY.trim())).toBeVisible();
});

test('backup a quente com o servidor ligado aparece na lista', async () => {
  await page.goto(`${serverPath}/backups`);
  await page.getByRole('button', { name: 'Backup a quente agora' }).click();

  await expect(page.getByText('Backup a quente concluído.')).toBeVisible();
  // The row comes from GET /backups, i.e. from the server_backups table, not from the progress panel.
  await expect(page.getByRole('row', { name: /Agendado · quente .* Concluído/ })).toBeVisible();
});

test('criar convite para o servidor e validá-lo pelo link', async ({ browser }) => {
  await page.goto('/access');
  await page.getByLabel('Nome do convite').fill(INVITE_NAME);
  await page.getByRole('button', { name: SERVER_NAME, pressed: false }).click();
  await page.getByRole('button', { name: 'Gerar convite' }).click();

  joinUrl = await page.getByLabel('Link do convite').inputValue();
  expect(joinUrl).toMatch(/\/join\?token=/);

  // The guest has no panel session: the invite page is public.
  const guest = await browser.newPage();
  await guest.goto(joinUrl);
  await expect(guest.getByRole('heading', { name: 'Você foi convidado!' })).toBeVisible();
  await expect(guest.getByText(INVITE_NAME)).toBeVisible();
  await guest.close();
});

test('/join: o convidado faz o claim e recebe a chave do Tailscale', async ({ browser }) => {
  const guest = await browser.newPage();
  await guest.goto(joinUrl);
  await guest.getByLabel('Seu nome').fill('Lucas Convidado');
  await guest.getByLabel('Seu nick no Minecraft').fill('LucasCraft');
  await guest.getByRole('button', { name: 'Entrar na rede' }).click();

  await expect(guest.getByRole('heading', { name: 'Tudo pronto, Lucas!' })).toBeVisible();
  await expect(guest.getByLabel('Chave de acesso, parcialmente oculta')).toBeVisible();
  await guest.close();

  // The claim spent one use of the invite and created the player with a device waiting for Tailscale.
  await page.goto('/access');
  await expect(page.getByText(INVITE_NAME)).toBeVisible();
  await expect(page.getByText(/^1\/5 usos/)).toBeVisible();
  await expect(page.getByRole('row', { name: /LucasCraft/ })).toBeVisible();
});
