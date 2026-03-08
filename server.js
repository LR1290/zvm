const http = require('http');
const PORT = process.env.PORT || 3000;

const FULL_PERMISSIONS = [
  "create_flow","massive_dispatching","schedule_item",
  "send_flow","send_funnel","send_trigger"
];

const USAGE_LIMITS = {
  audio:        { sent: 0, max: 99999 },
  bulkMessages: { sent: 0, max: 99999 },
  document:     { sent: 0, max: 99999 },
  flow:         { sent: 0, max: 99999 },
  funnel:       { sent: 0, max: 99999 },
  media:        { sent: 0, max: 99999 },
  message:      { sent: 0, max: 99999 },
  scheduleItem: { sent: 0, max: 99999 }
};

const AUTH_DATA = {
  numberWarning: false,
  segments: [],
  data: {
    key: "lr1290-key",
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
};

function handleRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-date');

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

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

    // ========================
    // GET /extension/auth/
    // Login externo OAuth - redireciona de volta para a extensao
    // ========================
    if (path.startsWith('/extension/auth') && req.method === 'GET') {
      const callback = url.searchParams.get('callback');

      if (callback) {
        // Monta os dados de auth como query params no callback
        const callbackUrl = new URL(callback);
        callbackUrl.searchParams.set('key', AUTH_DATA.data.key);
        callbackUrl.searchParams.set('keyId', AUTH_DATA.data.keyId);
        callbackUrl.searchParams.set('ownerId', AUTH_DATA.data.ownerId);
        callbackUrl.searchParams.set('managerId', AUTH_DATA.data.managerId);
        callbackUrl.searchParams.set('isPremium', 'true');
        callbackUrl.searchParams.set('isLoggedIn', 'true');
        callbackUrl.searchParams.set('planName', AUTH_DATA.data.planName);
        callbackUrl.searchParams.set('marketplace', AUTH_DATA.data.marketplace);
        callbackUrl.searchParams.set('username', AUTH_DATA.data.username);
        callbackUrl.searchParams.set('email', AUTH_DATA.data.email);
        callbackUrl.searchParams.set('plan_id', AUTH_DATA.data.plan_id);
        callbackUrl.searchParams.set('permissions', FULL_PERMISSIONS.join(','));

        console.log('Redirecionando para callback:', callbackUrl.toString());
        res.writeHead(302, { 'Location': callbackUrl.toString() });
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.setHeader('Content-Type', 'application/json');

    // POST /extension/v3/key
    if (path === '/extension/v3/key' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify(AUTH_DATA));
      return;
    }

    // POST /extension/v3/usage
    if (path === '/extension/v3/usage' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, status: true, limits: USAGE_LIMITS }));
      return;
    }

    // POST /extension/v3/get-usage
    if (path === '/extension/v3/get-usage' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true, status: true, limits: USAGE_LIMITS,
        expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(),
        isExpired: false
      }));
      return;
    }

    // POST /extension/v3/sync-usage
    if (path === '/extension/v3/sync-usage' && req.method === 'POST') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, status: true, limits: USAGE_LIMITS }));
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
  console.log(`  GET  /extension/auth/`);
  console.log(`  POST /extension/v3/key`);
  console.log(`  POST /extension/v3/usage`);
  console.log(`  POST /extension/v3/get-usage`);
  console.log(`  POST /extension/v3/sync-usage`);
});
