/**
 * HSwarm API Server
 * Reads from swarm_responses.db and exposes REST endpoints for the frontend.
 */

const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'swarm_responses.db');
const PORT = 3333;

function getDb() {
  return new Database(DB_PATH, { readonly: true });
}

function getDbW() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS public_formations (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    network TEXT NOT NULL,
    num_agents INTEGER NOT NULL,
    require_free INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS formation_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formation_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL,
    enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (formation_id) REFERENCES public_formations(id)
  )`);
  return db;
}

function sendJSON(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}


let activePipeline = {
  isRunning: false,
  logs: [],
  done: false,
  clients: []
};

let activeKeeper = {
  child: null,
  isRunning: false,
  logs: [],
};

function spawnKeeper() {
  if (activeKeeper.isRunning) return;
  const keeperInterval = process.env.KEEPER_INTERVAL_MS || '120000';
  const child = require('child_process').spawn('npx', ['ts-node', 'src/keeper/keeperRunner.ts', keeperInterval], {
    cwd: __dirname,
    env: process.env,
  });
  activeKeeper.child = child;
  activeKeeper.isRunning = true;
  activeKeeper.logs = [];
  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        activeKeeper.logs.push({ log: line, ts: new Date().toISOString() });
        console.log(`[Keeper] ${line}`);
      }
    }
  });
  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        activeKeeper.logs.push({ log: `[ERR] ${line}`, ts: new Date().toISOString() });
        console.error(`[Keeper] ${line}`);
      }
    }
  });
  child.on('close', (code) => {
    activeKeeper.isRunning = false;
    activeKeeper.child = null;
    activeKeeper.logs.push({ log: `[EXIT] Keeper process finished with code ${code}`, ts: new Date().toISOString() });
    console.log(`[Keeper] Process exited with code ${code}`);
  });
  return child;
}

function killKeeper() {
  if (activeKeeper.child) {
    activeKeeper.child.kill('SIGTERM');
    activeKeeper.isRunning = false;
    activeKeeper.child = null;
  }
}

function broadcastLog(dataObj) {
  activePipeline.logs.push(dataObj);
  if (dataObj.done) {
    activePipeline.done = true;
    activePipeline.isRunning = false;
  }
  const msg = `data: ${JSON.stringify(dataObj)}\n\n`;
  for (const client of activePipeline.clients) {
    client.write(msg);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  try {
    const db = getDb();

    // GET /api/registry - summary stats
    if (url === '/api/registry') {
      const valid = db.prepare('SELECT COUNT(*) as count FROM valid_agents').get().count;
      const failed = db.prepare('SELECT COUNT(*) as count FROM failed_agents').get().count;
      const byCategory = db.prepare('SELECT failure_category, COUNT(*) as count FROM failed_agents GROUP BY failure_category').all();
      const byNetwork = db.prepare('SELECT network, COUNT(*) as count FROM valid_agents GROUP BY network').all();
      db.close();
      return sendJSON(res, { valid, failed, total: valid + failed, byCategory, byNetwork });
    }

    // GET /api/agents/valid - list of valid agents (paginated)
    if (url.startsWith('/api/agents/valid')) {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      const limit = parseInt(params.get('limit') || '50');
      const offset = parseInt(params.get('offset') || '0');
      const network = params.get('network') || null;

      let query = 'SELECT * FROM valid_agents';
      const args = [];
      if (network) { query += ' WHERE network = ?'; args.push(network); }
      query += ' ORDER BY last_audited DESC LIMIT ? OFFSET ?';
      args.push(limit, offset);

      const agents = db.prepare(query).all(...args);
      const total = db.prepare(`SELECT COUNT(*) as count FROM valid_agents${network ? ' WHERE network = ?' : ''}`).get(...(network ? [network] : [])).count;
      db.close();
      return sendJSON(res, { agents: agents.map(a => ({ ...a, available_tools: JSON.parse(a.available_tools || '[]') })), total, limit, offset });
    }

    // GET /api/agents/failed - list of failed agents
    if (url.startsWith('/api/agents/failed')) {
      const params = new URLSearchParams(req.url.split('?')[1] || '');
      const limit = parseInt(params.get('limit') || '50');
      const offset = parseInt(params.get('offset') || '0');
      const agents = db.prepare('SELECT * FROM failed_agents ORDER BY first_seen DESC LIMIT ? OFFSET ?').all(limit, offset);
      const total = db.prepare('SELECT COUNT(*) as count FROM failed_agents').get().count;
      db.close();
      return sendJSON(res, { agents, total, limit, offset });
    }

    // GET /api/tasks - current run tasks
    if (url === '/api/tasks') {
      const tasks = db.prepare('SELECT * FROM agent_tasks ORDER BY updated_at DESC').all();
      const summary = db.prepare('SELECT status, COUNT(*) as count FROM agent_tasks GROUP BY status').all();
      db.close();
      return sendJSON(res, { tasks, summary });
    }

    // GET /api/products - agentic products from DB
    if (url === '/api/products') {
      const products = db.prepare('SELECT * FROM agentic_products ORDER BY created_at DESC').all();
      db.close();
      return sendJSON(res, { products: products.map(p => { try { return { ...p, blueprint_json: JSON.parse(p.blueprint_json || '{}') }; } catch { return { ...p, blueprint_json: {} }; } }) });
    }

    // GET /api/products/:id
    const productMatch = url.match(/^\/api\/products\/([^/]+)$/);
    if (productMatch) {
      const product = db.prepare('SELECT * FROM agentic_products WHERE product_id = ?').get(productMatch[1]);
      db.close();
      if (!product) return sendJSON(res, { error: 'Not found' }, 404);
      let parsed; try { parsed = JSON.parse(product.blueprint_json || '{}'); } catch { parsed = {}; }
      return sendJSON(res, { ...product, blueprint_json: parsed });
    }

    // GET /api/swarms - all swarms
    if (url === '/api/swarms') {
      const swarms = db.prepare('SELECT * FROM swarms ORDER BY created_at DESC').all();
      db.close();
      return sendJSON(res, { swarms: swarms.map(s => { try { return { ...s, config_json: JSON.parse(s.config_json || '{}') }; } catch { return { ...s, config_json: {} }; } }) });
    }

    // GET /api/weights/:swarmId - weights for a swarm
    const weightMatch = url.match(/^\/api\/weights\/([^/]+)$/);
    if (weightMatch) {
      const weights = db.prepare('SELECT * FROM swarm_weights WHERE swarm_id = ? ORDER BY weight DESC').all(weightMatch[1]);
      db.close();
      return sendJSON(res, { weights });
    }

    db.close();

    // ─── WRITABLE ENDPOINTS (use getDbW) ──────────────────────────────────────

    // GET /api/formations - list public formations
    if (url === '/api/formations' && req.method === 'GET') {
      const dbw = getDbW();
      const formations = dbw.prepare('SELECT * FROM public_formations ORDER BY created_at DESC').all();
      for (const f of formations) {
        f.enrolled_agents = dbw.prepare('SELECT * FROM formation_enrollments WHERE formation_id = ? ORDER BY enrolled_at').all(f.id);
      }
      dbw.close();
      return sendJSON(res, { formations });
    }

    // POST /api/formations - create a new public formation
    if (url === '/api/formations' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const id = `pub_${Math.random().toString(36).substring(2, 10)}`;
          const dbw = getDbW();
          dbw.prepare(`INSERT INTO public_formations (id, purpose, network, num_agents, require_free) VALUES (?, ?, ?, ?, ?)`).run(
            id, data.purpose, data.network, data.num_agents, data.require_free ? 1 : 0
          );
          dbw.close();
          return sendJSON(res, { id });
        } catch (e) {
          return sendJSON(res, { error: e.message }, 400);
        }
      });
      return;
    }

    // POST /api/formations/:id/enroll - enroll an agent
    const enrollMatch = url.match(/^\/api\/formations\/([^/]+)\/enroll$/);
    if (enrollMatch && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const dbw = getDbW();
          const formation = dbw.prepare('SELECT * FROM public_formations WHERE id = ?').get(enrollMatch[1]);
          if (!formation) { dbw.close(); return sendJSON(res, { error: 'Formation not found' }, 404); }
          const enrolledCount = dbw.prepare('SELECT COUNT(*) as c FROM formation_enrollments WHERE formation_id = ?').get(enrollMatch[1]).c;
          if (enrolledCount >= formation.num_agents) { dbw.close(); return sendJSON(res, { error: 'Formation is full' }, 400); }
          const existing = dbw.prepare('SELECT COUNT(*) as c FROM formation_enrollments WHERE formation_id = ? AND agent_id = ?').get(enrollMatch[1], data.agent_id).c;
          if (existing > 0) { dbw.close(); return sendJSON(res, { error: 'Agent already enrolled' }, 400); }
          dbw.prepare(`INSERT INTO formation_enrollments (formation_id, agent_id, agent_name, endpoint) VALUES (?, ?, ?, ?)`).run(
            enrollMatch[1], data.agent_id, data.agent_name || data.agent_id, data.endpoint
          );
          dbw.close();
          return sendJSON(res, { success: true });
        } catch (e) {
          return sendJSON(res, { error: e.message }, 400);
        }
      });
      return;
    }

    // GET /api/pipeline/status
    if (url === '/api/pipeline/status' && req.method === 'GET') {
      return sendJSON(res, {
        isRunning: activePipeline.isRunning,
        done: activePipeline.done,
        logs: activePipeline.logs
      });
    }

    // GET /api/pipeline/stream
    if (url === '/api/pipeline/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      activePipeline.clients.push(res);
      req.on('close', () => {
        activePipeline.clients = activePipeline.clients.filter(c => c !== res);
      });
      return;
    }

    // POST /api/pipeline/start
    if (url === '/api/pipeline/start' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body); } catch (e) {}

        if (activePipeline.isRunning) {
          return sendJSON(res, { error: 'Pipeline already running' }, 400);
        }

        activePipeline.isRunning = true;
        activePipeline.done = false;
        activePipeline.logs = [];

        // @ts-ignore
        const { spawn } = require('child_process');
        const child = spawn('npx', ['ts-node', 'src/run_auto.ts', payload.network || 'Arbitrum/Testnet', payload.purpose || 'VAULT', payload.numAgents || '10'], {
          cwd: __dirname,
          env: process.env
        });

        child.stdout.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) broadcastLog({ log: line });
          }
        });

        child.stderr.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) broadcastLog({ log: `[ERR] ${line}` });
          }
        });

        child.on('close', (code) => {
          broadcastLog({ log: `[EXIT] Process finished with code ${code}`, done: true });
        });

        sendJSON(res, { success: true });
      });
      return;
    }

    // ─── KEEPER ENDPOINTS ─────────────────────────────────────────────────────

    // GET /api/keeper/status
    if (url === '/api/keeper/status' && req.method === 'GET') {
      return sendJSON(res, {
        isRunning: activeKeeper.isRunning,
        logs: activeKeeper.logs.slice(-50),
      });
    }

    // POST /api/keeper/start
    if (url === '/api/keeper/start' && req.method === 'POST') {
      if (activeKeeper.isRunning) {
        return sendJSON(res, { error: 'Keeper already running' }, 400);
      }
      spawnKeeper();
      return sendJSON(res, { success: true });
    }

    // POST /api/keeper/stop
    if (url === '/api/keeper/stop' && req.method === 'POST') {
      killKeeper();
      return sendJSON(res, { success: true });
    }

    // GET /api/visual/:productId - serve generated visual dashboard HTML
    const visualMatch = url.match(/^\/api\/visual\/([^/]+)$/);
    if (visualMatch) {
      const visualPath = path.join(__dirname, 'products', `visual_${visualMatch[1]}.html`);
      if (fs.existsSync(visualPath)) {
        const html = fs.readFileSync(visualPath, 'utf-8');
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(html);
      } else {
        sendJSON(res, { error: 'Dashboard not found' }, 404);
      }
      return;
    }

    sendJSON(res, { error: 'Not found' }, 404);
  } catch (err) {
    console.error('[API Error]', err.message);
    sendJSON(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`[HSwarm API] Running at http://localhost:${PORT}`);
  console.log(`[HSwarm API] Database: ${DB_PATH}`);
  if (process.env.KEEPER_ENABLED === 'true') {
    console.log('[HSwarm API] KEEPER_ENABLED=true — auto-starting keeper loop...');
    spawnKeeper();
  }
});
