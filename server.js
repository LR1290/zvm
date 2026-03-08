const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;

// Permissoes completas
const FULL_PERMISSIONS = [
  "create_flow",
  "massive_dispatching", 
  "schedule_item",
  "send_flow",
  "send_funnel",
  "send_trigger"
];

// Limites generosos de uso
const USAGE_LIMITS = {
  audio:          { sent: 0, max: 99999 },
  bulkMessages:   { sent: 0, max: 99999 },
  document:       { sent: 0, max: 99999 },
  flow:           { sent: 0, max: 99999 },
  funnel:         { sent: 0, max: 99999 },
  media:          { sent: 0, max: 99999 },
  message:        { sent: 0, max: 99999 },
  scheduleItem:   { sent: 0, max: 99999 }
};

function handleRequest(req, res) {
  // CORS - necessario para extensao Chrome
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-date');
  res.setHeader('Content-Type', 'application/json');

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch {}

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, payload);

    // ========================
    // POST /extension/v3/key
    // Autenticacao da chave
    // ========================
    if (req.url === '/extension/v3/key' && req.method === 'POST') {
      const key = payload.authKey || 'unknown';
      res.writeHead(200);
      res.end(JSON.stringify({
        numberWarning: false,
        segments: [],
        data: {
          key: key,
          keyId: "lr1290-key-id",
          ownerId: "lr1290-owner-id",
          managerId: "lr1290-manager-id",
          permissions: FULL_PERMISSIONS,
          username: "LR1290 Premium",
          paymentUrl: null,
          marketplace: "premium",
          email: "lr1290@dfg.com.br",
          planName: "Pro",
          plan_id: "ZV_PRO",
          isLoggedIn: true,
          isPremium: true,
          isBasicPlan: false
        }
      }));
      return;
    }

    // ========================
    // POST /extension/v3/usage
    // Registrar uso
    // ========================
    if (req.url === '/extension/v3/usage' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        status: true,
        limits: USAGE_LIMITS
      }));
      return;
    }

    // ========================
    // POST /extension/v3/get-usage
    // Buscar uso atual
    // ========================
    if (req.url === '/extension/v3/get-usage' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        status: true,
        limits: USAGE_LIMITS,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isExpired: false
      }));
      return;
    }

    // ========================
    // POST /extension/v3/sync-usage
    // Sincronizar uso
    // ========================
    if (req.url === '/extension/v3/sync-usage' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        status: true,
        limits: USAGE_LIMITS
      }));
      return;
    }

    // ========================
    // POST /dmg/dashboard/events/customer/new
    // Eventos de tracking (ignorar)
    // ========================
    if (req.url.includes('/dmg/dashboard/events') && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Qualquer outra rota
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`ZapVoice API Server rodando na porta ${PORT}`);
  console.log(`Endpoints ativos:`);
  console.log(`  POST /extension/v3/key`);
  console.log(`  POST /extension/v3/usage`);
  console.log(`  POST /extension/v3/get-usage`);
  console.log(`  POST /extension/v3/sync-usage`);
});
