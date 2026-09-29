import { InviteSummaryDto } from '../dto/invite-summary.dto';

export function renderJoinPage(invite?: InviteSummaryDto, errorMsg?: string): string {
  const isError = !invite || !!errorMsg;

  return `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MineK8s — Acesso à Rede Privada</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 500: '#10b981', 600: '#059669', 700: '#047857' }
          }
        }
      }
    }
  </script>
  <style>
    @keyframes pulse-subtle { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
    .pulse-glow { animation: pulse-subtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center p-4 antialiased selection:bg-emerald-500 selection:text-white">
  <div class="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-emerald-950/20 backdrop-blur">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
        ⛏️
      </div>
      <div>
        <h1 class="text-xl font-bold tracking-tight text-white">MineK8s Private Network</h1>
        <p class="text-xs text-zinc-400 font-mono">Zero-Trust Tailnet Onboarding</p>
      </div>
    </div>

    ${
      isError
        ? `
      <div class="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-4 text-red-300">
        <div class="flex items-center gap-2 font-semibold text-sm mb-1">
          <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          Convite Inválido ou Esgotado
        </div>
        <p class="text-xs text-zinc-300">${errorMsg || 'Token de convite não encontrado ou inválido.'}</p>
      </div>
      <p class="text-xs text-zinc-400 text-center">Entre em contato com o administrador do cluster para solicitar um novo link de acesso.</p>
    `
        : `
      <!-- Detalhes do Convite -->
      <div class="bg-zinc-800/50 border border-zinc-800 rounded-xl p-4 mb-6">
        <div class="text-xs text-zinc-400 mb-1">Convite ativo para:</div>
        <div class="text-sm font-semibold text-emerald-400">${invite.name}</div>
        <div class="flex gap-4 mt-2 pt-2 border-t border-zinc-800/80 text-xs text-zinc-400">
          <div>Usos restantes: <span class="text-zinc-200 font-medium">${invite.maxUses - invite.usedCount}</span></div>
          <div>Expira em: <span class="text-zinc-200 font-medium">${new Date(invite.expiresAt).toLocaleDateString('pt-BR')}</span></div>
        </div>
      </div>

      <!-- Formulário de Cadastro -->
      <form id="claimForm" class="space-y-4">
        <input type="hidden" id="inviteToken" value="${invite.token}">

        <div>
          <label class="block text-xs font-medium text-zinc-300 mb-1" for="realName">Nome Real / Apelido Pessoal</label>
          <input type="text" id="realName" required minlength="2" maxlength="100" placeholder="Ex: Lucas Henrique"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition">
          <p class="text-[11px] text-zinc-500 mt-1">Usado para identificar quem você é perante o administrador.</p>
        </div>

        <div>
          <label class="block text-xs font-medium text-zinc-300 mb-1" for="minecraftNick">Nickname no Minecraft Vanilla</label>
          <input type="text" id="minecraftNick" required pattern="^[a-zA-Z0-9_]{2,16}$" maxlength="16" placeholder="Ex: LucasCraft"
            class="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition font-mono">
          <p class="text-[11px] text-zinc-500 mt-1">Entre 2 e 16 caracteres alfanuméricos ou sublinhado.</p>
        </div>

        <div id="errorContainer" class="hidden bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300"></div>

        <button type="submit" id="submitBtn"
          class="w-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-zinc-950 font-bold py-2.5 px-4 rounded-xl transition duration-150 flex items-center justify-center gap-2">
          <span>Resgatar Acesso e Gerar Chave</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>
      </form>

      <!-- Sucesso & Instruções de Conexão -->
      <div id="successContainer" class="hidden space-y-5">
        <div class="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
          <div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center text-xl mb-2">✓</div>
          <h2 class="font-bold text-white text-base">Acesso Liberado com Sucesso!</h2>
          <p class="text-xs text-zinc-300 mt-1">Bem-vindo, <span id="resNick" class="font-bold text-emerald-400"></span>!</p>
        </div>

        <div>
          <a id="deepLinkBtn" href="#"
            class="w-full bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold py-3 px-4 rounded-xl transition duration-150 flex items-center justify-center gap-2 text-sm shadow-lg shadow-emerald-500/20">
            <span>Conectar Tailscale (1-Clique)</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
          </a>
        </div>

        <div class="bg-zinc-950 border border-zinc-800 rounded-xl p-3">
          <div class="text-[11px] text-zinc-400 mb-1">Chave de Pré-Autenticação (AuthKey):</div>
          <div class="flex items-center gap-2">
            <input type="text" id="authKeyInput" readonly class="w-full bg-transparent text-xs font-mono text-emerald-400 select-all focus:outline-none">
            <button id="copyKeyBtn" type="button" class="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 rounded">Copiar</button>
          </div>
        </div>

        <div class="text-xs text-zinc-400 space-y-2 border-t border-zinc-800/80 pt-4">
          <div class="font-medium text-zinc-300">Como jogar no servidor:</div>
          <ol class="list-decimal list-inside space-y-1 text-zinc-400 text-[11px]">
            <li>Instale o cliente em <a href="https://tailscale.com/download" target="_blank" class="text-emerald-400 underline">tailscale.com</a> caso ainda não possua.</li>
            <li>Clique no botão de 1-Clique acima ou cole a AuthKey ao fazer login.</li>
            <li>Abra seu Minecraft e conecte ao endereço <span class="text-emerald-300 font-mono">survival.mine.lan</span>.</li>
          </ol>
        </div>
      </div>

      <script>
        const form = document.getElementById('claimForm');
        const submitBtn = document.getElementById('submitBtn');
        const errContainer = document.getElementById('errorContainer');
        const successContainer = document.getElementById('successContainer');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          errContainer.classList.add('hidden');
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Provisionando acesso...</span>';

          const token = document.getElementById('inviteToken').value;
          const realName = document.getElementById('realName').value.trim();
          const minecraftNick = document.getElementById('minecraftNick').value.trim();

          try {
            const resp = await fetch('/api/tailscale/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, realName, minecraftNick })
            });

            const data = await resp.json();

            if (!resp.ok) {
              throw new Error(data.message || 'Falha ao resgatar convite.');
            }

            form.classList.add('hidden');
            successContainer.classList.remove('hidden');

            document.getElementById('resNick').innerText = data.minecraftNick;
            document.getElementById('deepLinkBtn').href = data.deepLinkUrl;
            document.getElementById('authKeyInput').value = data.authKey;

            document.getElementById('copyKeyBtn').addEventListener('click', () => {
              navigator.clipboard.writeText(data.authKey);
              document.getElementById('copyKeyBtn').innerText = 'Copiado!';
              setTimeout(() => { document.getElementById('copyKeyBtn').innerText = 'Copiar'; }, 2000);
            });

          } catch (err) {
            errContainer.innerText = err.message;
            errContainer.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Tentar Novamente</span>';
          }
        });
      </script>
    `
    }
  </div>
</body>
</html>`;
}
