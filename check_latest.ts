import Database from 'better-sqlite3';

const db = new Database('swarm_responses.db');
const latest = db.prepare('SELECT * FROM agentic_products ORDER BY created_at DESC LIMIT 1').get();
console.log(latest);
db.close();
