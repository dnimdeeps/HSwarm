const Database = require('better-sqlite3');
const db = new Database('swarm_responses.db');
const rows = db.prepare("SELECT agent_id, status, standardized_json, raw_response FROM agent_tasks WHERE status = 'COMPLETED'").all();
console.log(`Found ${rows.length} COMPLETED tasks`);
rows.forEach(r => console.log(r.agent_id, r.standardized_json));
