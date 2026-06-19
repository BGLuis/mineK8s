const mineflayer = require('mineflayer');

const serverHost = process.env.MC_HOST || '127.0.0.1';
const serverPort = parseInt(process.env.MC_PORT || '25565');
const botName = process.env.BOT_NAME || 'HealthBot';
const version = process.env.MC_VERSION || false; // false = auto

console.log(`[HealthBot] Inicializando... Tentando conectar em ${serverHost}:${serverPort} como ${botName}`);

const bot = mineflayer.createBot({
  host: serverHost,
  port: serverPort,
  username: botName,
  version: version, // Se false, o mineflayer tentará descobrir automaticamente
});

// Timeout global (se o bot não conseguir spawnar em 30 segundos, consideramos falha)
const timeout = setTimeout(() => {
  console.error('[HealthBot] [ERRO] Timeout alcançado. O bot não conseguiu entrar no servidor a tempo.');
  process.exit(1);
}, 30000);

bot.on('login', () => {
  console.log('[HealthBot] Login bem-sucedido! Autenticado no servidor.');
});

bot.on('spawn', () => {
  clearTimeout(timeout);
  console.log('[HealthBot] [SUCESSO] Bot spawnou com sucesso no mundo!');
  
  // Envia uma mensagem no chat (opcional, pode ser útil para debug)
  // bot.chat('Health check concluído! O servidor está saudável.');

  setTimeout(() => {
    console.log('[HealthBot] Desconectando e encerrando o processo (Testes passaram).');
    bot.quit();
    process.exit(0);
  }, 2000);
});

bot.on('error', (err) => {
  clearTimeout(timeout);
  console.error('[HealthBot] [ERRO] Falha na conexão ou erro interno:', err.message);
  process.exit(1);
});

bot.on('kicked', (reason, loggedIn) => {
  clearTimeout(timeout);
  console.error(`[HealthBot] [KICK] Bot foi kickado. Motivo: ${reason} (Logado: ${loggedIn})`);
  
  // Dependendo da lógica, ser kickado por whitelist ou por outro plugin pode
  // não ser uma falha de saúde do servidor (o servidor *respondeu* ao menos),
  // mas vamos tratar como falha para testes básicos.
  process.exit(1);
});

bot.on('end', (reason) => {
  console.log(`[HealthBot] Conexão encerrada. Motivo: ${reason}`);
});
