/**
 * Join Server — Servidor HTTP mínimo na porta 3001
 * ─────────────────────────────────────────────────
 * Serve APENAS a página pública de convite (/join).
 * Este é o único processo exposto ao Tailscale Funnel.
 * O NestJS principal (porta 3000) permanece 100% privado.
 *
 * Inicie separadamente: npx ts-node src/join-server.ts
 * Ou adicione ao package.json: "start:join": "ts-node src/join-server.ts"
 */

import * as http from 'http';

const PORT = parseInt(process.env.JOIN_PORT ?? '3001', 10);
const FUNNEL_HOST = process.env.TAILSCALE_FUNNEL_HOST ?? 'localhost:3001';

// ─── Página HTML da tela de convite ──────────────────────────────────────────
function buildJoinPage(host: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Entrar no Servidor Minecraft 🎮</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #e2e8f0;
      padding: 24px;
    }

    .card {
      background: rgba(255,255,255,0.07);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      padding: 48px 40px;
      max-width: 520px;
      width: 100%;
      text-align: center;
      box-shadow: 0 32px 64px rgba(0,0,0,0.4);
    }

    .emoji { font-size: 64px; margin-bottom: 16px; }

    h1 {
      font-size: 1.8rem;
      font-weight: 700;
      margin-bottom: 8px;
      background: linear-gradient(90deg, #a78bfa, #60a5fa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      color: #94a3b8;
      margin-bottom: 40px;
      font-size: 0.95rem;
    }

    .steps { text-align: left; margin-bottom: 36px; }

    .step {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 16px 0;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .step:last-child { border-bottom: none; }

    .step-num {
      background: linear-gradient(135deg, #7c3aed, #2563eb);
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .step-content strong { display: block; margin-bottom: 4px; }
    .step-content span { color: #94a3b8; font-size: 0.88rem; }

    .download-links { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .dl-btn {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      color: #e2e8f0;
      padding: 4px 12px;
      border-radius: 8px;
      font-size: 0.8rem;
      text-decoration: none;
      transition: background 0.2s;
    }
    .dl-btn:hover { background: rgba(255,255,255,0.16); }

    .btn-connect {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #7c3aed, #2563eb);
      color: white;
      border: none;
      border-radius: 14px;
      font-size: 1.05rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
      margin-bottom: 12px;
    }
    .btn-connect:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-connect:active { transform: translateY(0); }

    .copy-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0,0,0,0.25);
      border-radius: 10px;
      padding: 10px 14px;
      margin-top: 8px;
    }
    .copy-row code {
      flex: 1;
      font-size: 0.78rem;
      color: #94a3b8;
      word-break: break-all;
      text-align: left;
    }
    .copy-btn {
      background: none;
      border: 1px solid rgba(255,255,255,0.2);
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      white-space: nowrap;
      transition: color 0.2s, border-color 0.2s;
    }
    .copy-btn:hover { color: white; border-color: white; }

    .expiry {
      margin-top: 24px;
      font-size: 0.8rem;
      color: #64748b;
    }

    .alert {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 12px;
      padding: 16px;
      color: #fca5a5;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <div class="card" id="card-loading">
    <div class="emoji">⏳</div>
    <h1>Carregando convite...</h1>
    <p class="subtitle">Verificando sua chave de acesso.</p>
  </div>

  <div class="card" id="card-main" style="display:none">
    <div class="emoji">🎮</div>
    <h1>Você foi convidado!</h1>
    <p class="subtitle">Siga 3 passos simples para entrar no servidor Minecraft.</p>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <strong>Instale o Tailscale <span style="color:#a78bfa">(1x na vida)</span></strong>
          <span>Aplicativo gratuito que cria a conexão segura.</span>
          <div class="download-links" id="download-links"></div>
        </div>
      </div>

      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <strong>Conecte com sua chave</strong>
          <span>Clique no botão abaixo — o app vai abrir e conectar automaticamente.</span>
        </div>
      </div>

      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <strong>Entre no Minecraft</strong>
          <span>Adicione o endereço do servidor no seu cliente Minecraft.</span>
        </div>
      </div>
    </div>

    <button class="btn-connect" id="btn-connect">
      🔗 Conectar Automaticamente
    </button>

    <div style="color:#64748b; font-size:0.82rem; margin-bottom:8px">
      Ou copie a chave manualmente:
    </div>
    <div class="copy-row">
      <code id="key-display">—</code>
      <button class="copy-btn" id="btn-copy">Copiar</button>
    </div>

    <p class="expiry" id="expiry-text"></p>
  </div>

  <div class="card" id="card-error" style="display:none">
    <div class="emoji">❌</div>
    <h1>Link inválido</h1>
    <p class="subtitle">Este link de convite está vazio ou foi mal formado.</p>
    <p style="color:#94a3b8; font-size:0.9rem; margin-top:16px">
      Peça um novo convite ao administrador do servidor.
    </p>
  </div>

  <script>
    // A chave de acesso fica no #hash da URL.
    // O hash NUNCA é enviado para o servidor — fica apenas no navegador.
    const authKey = window.location.hash.slice(1).trim();

    const cardLoading = document.getElementById('card-loading');
    const cardMain    = document.getElementById('card-main');
    const cardError   = document.getElementById('card-error');

    if (!authKey || !authKey.startsWith('tskey-')) {
      cardLoading.style.display = 'none';
      cardError.style.display   = 'block';
    } else {
      cardLoading.style.display = 'none';
      cardMain.style.display    = 'block';

      // Botão de conexão automática via deep link
      document.getElementById('btn-connect').addEventListener('click', () => {
        window.location.href = 'tailscale://connect?authkey=' + authKey;
      });

      // Exibe a chave (parcialmente mascarada)
      const masked = authKey.substring(0, 20) + '••••••••••••••••••';
      document.getElementById('key-display').textContent = masked;

      // Botão copiar
      document.getElementById('btn-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(authKey).then(() => {
          document.getElementById('btn-copy').textContent = '✓ Copiado!';
          setTimeout(() => document.getElementById('btn-copy').textContent = 'Copiar', 2000);
        });
      });

      // Links de download por plataforma
      const ua = navigator.userAgent.toLowerCase();
      const downloads = document.getElementById('download-links');
      const platforms = [
        { label: '🪟 Windows', url: 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe' },
        { label: '🍎 macOS',   url: 'https://apps.apple.com/app/tailscale/id1475387142' },
        { label: '🤖 Android', url: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn.android' },
        { label: '📱 iOS',     url: 'https://apps.apple.com/app/tailscale/id1470499037' },
        { label: '🐧 Linux',   url: 'https://tailscale.com/download/linux' },
      ];

      // Coloca a plataforma detectada primeiro
      let sorted = [...platforms];
      if (ua.includes('windows')) sorted = [sorted[0], ...sorted.slice(1)];
      else if (ua.includes('mac'))     sorted = [sorted[1], sorted[0], ...sorted.slice(2)];
      else if (ua.includes('android')) sorted = [sorted[2], ...sorted.slice(0,2), ...sorted.slice(3)];
      else if (ua.includes('iphone'))  sorted = [sorted[3], ...sorted.slice(0,3), sorted[4]];

      sorted.slice(0, 3).forEach(p => {
        const a = document.createElement('a');
        a.href = p.url;
        a.target = '_blank';
        a.className = 'dl-btn';
        a.textContent = p.label;
        downloads.appendChild(a);
      });
    }
  </script>
</body>
</html>`;
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // Health check (usado pelo Tailscale Funnel para verificar o serviço)
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Página de convite
  if (url.pathname === '/join') {
    const html = buildJoinPage(FUNNEL_HOST);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Redireciona raiz para /join (conveniência)
  if (url.pathname === '/') {
    res.writeHead(302, { Location: '/join' });
    res.end();
    return;
  }

  // Qualquer outra rota: 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[join-server] 🎟️  Servidor público de convites rodando na porta ${PORT}`);
  console.log(`[join-server] 🌐  URL pública esperada: https://${FUNNEL_HOST}/join`);
  console.log(`[join-server] 🔒  O NestJS principal permanece privado na porta 3000`);
});
