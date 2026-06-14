import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class ProductBuilder {
    private db: Database.Database;
    private outputDir: string;

    constructor(db: Database.Database) {
        this.db = db;
        this.outputDir = path.join(process.cwd(), 'products');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    public buildLatestProduct() {
        console.log("\n=== STEP 5: Agentic Product Execution ===");
        
        // 1. Fetch the latest product from the database
        const row = this.db.prepare(`
            SELECT * FROM agentic_products 
            ORDER BY created_at DESC 
            LIMIT 1
        `).get() as any;

        if (!row) {
            console.log("No Agentic Products found in the database to build.");
            return;
        }

        console.log(`Found Product [${row.product_id}] with Purpose: ${row.purpose}`);
        console.log("Reading Blueprint JSON...");

        let blueprint: any;
        try {
            blueprint = this.repairAndParseJson(row.blueprint_json);
        } catch (e) {
            console.error("Failed to parse blueprint JSON even after repair attempt.");
            console.error(row.blueprint_json);
            return;
        }

        // 2. Route to the correct handler based on Purpose
        const purpose = row.purpose.toUpperCase();
        if (purpose === "VAULT" || purpose === "YIELD") {
            this.buildVaultExecutionScript(row.product_id, blueprint, purpose);
        } else if (purpose === "VISUAL") {
            this.buildVisualDashboard(row.product_id, blueprint);
        } else {
            console.log(`Unknown purpose: ${purpose}. No builder implemented yet.`);
        }
    }

    /**
     * Attempts to parse JSON that may be truncated by the LLM.
     * Closes any open arrays/objects before attempting to parse.
     */
    private repairAndParseJson(raw: string): any {
        // First, try to parse as-is
        try {
            return JSON.parse(raw);
        } catch (_) {}

        // Attempt to find the last complete entry and close all open brackets
        let repaired = raw.trimEnd();
        // Remove trailing comma if present
        repaired = repaired.replace(/,\s*$/, '');

        // Count open braces and brackets to determine what needs closing
        const openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;

        // Truncate at the last complete string/number value before unclosed structures
        // Find the last clean stopping point — last complete key-value pair
        const lastCompleteEntryMatch = repaired.match(/^([\s\S]*)("[^"]*"\s*:\s*(?:"[^"]*"|\d+\.?\d*|true|false|null))/m);
        if (lastCompleteEntryMatch) {
            const truncated = lastCompleteEntryMatch[1] + lastCompleteEntryMatch[2];
            // Recalculate open braces/brackets after truncation
            const ob = (truncated.match(/\{/g) || []).length - (truncated.match(/\}/g) || []).length;
            const obr = (truncated.match(/\[/g) || []).length - (truncated.match(/\]/g) || []).length;
            repaired = truncated + ']'.repeat(obr) + '}'.repeat(ob);
        } else {
            repaired = repaired + ']'.repeat(openBrackets) + '}'.repeat(openBraces);
        }

        console.log('[ProductBuilder] Blueprint JSON was truncated. Attempting repair...');
        return JSON.parse(repaired);
    }

    private buildVaultExecutionScript(productId: string, blueprint: any, purpose: string) {
        console.log(`\n⚙️  Generating Execution Script & Deploying ${purpose} product...`);
        
        // 1. Parse allocations
        let morphoBps = 0;
        let aaveBps = 0;
        const allocs = blueprint.allocations || [];
        for (const alloc of allocs) {
            const proto = (alloc.protocol || "").toLowerCase();
            const pct = alloc.target_pct_bps || 0;
            if (proto.includes("morpho")) morphoBps += pct;
            else if (proto.includes("aave")) aaveBps += pct;
        }

        // 2. Update .env
        const envPath = path.join(process.cwd(), '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

        const updates: Record<string, any> = {
            VAULT_STRATEGY_NAME: blueprint.strategy_name || "Conservative Vault",
            VAULT_REBALANCE_INTERVAL: (blueprint.rebalance_interval_hours || 24) * 3600,
            VAULT_MIN_APY_BPS: blueprint.min_apy_bps || 300,
            VAULT_MAX_SINGLE_PCT_BPS: blueprint.max_single_protocol_bps || 6000,
            VAULT_MORPHO_PCT_BPS: morphoBps,
            VAULT_AAVE_PCT_BPS: aaveBps,
            VAULT_MORPHO_VAULT_ADDRESS: "0x0000000000000000000000000000000000000001" // Default test address
        };

        for (const [key, val] of Object.entries(updates)) {
            // Quote string values so bash can source them safely
            const safeVal = typeof val === 'string' && val.includes(' ') ? `"${val}"` : val;
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${key}=${safeVal}`);
            } else {
                envContent += `\n${key}=${safeVal}`;
            }
        }
        fs.writeFileSync(envPath, envContent);
        console.log(`✅ .env updated with new swarm strategy parameters.`);

        // 3. Deployment is handled by LangGraph Runner via deployVault.ts
        console.log(`ℹ️  Smart contract deployment is handled by LangGraph Runner (deployVault.ts).
   The contract address will be saved to the database by the runner.`);
    }

    private buildVisualDashboard(productId: string, blueprint: any) {
        console.log(`📊 Generating Professional Quant Dashboard...`);
        
        const fileName = `visual_${productId}.html`;
        const filePath = path.join(this.outputDir, fileName);

        let consensusHtml = '';
        if (blueprint.consensus_decision) {
            consensusHtml = `
            <div class="consensus-card">
                <div class="consensus-header">MASTER SWARM CONSENSUS</div>
                <div class="consensus-body">
                    <div class="stat"><span class="label">Action</span><span class="value">${blueprint.consensus_decision.action}</span></div>
                    <div class="stat"><span class="label">Target</span><span class="value">${blueprint.consensus_decision.target_protocol} - ${blueprint.consensus_decision.target_pool}</span></div>
                    <div class="stat"><span class="label">Swarm Confidence</span><span class="value highlight">${blueprint.consensus_decision.confidence_score}%</span></div>
                </div>
            </div>`;
        }

        let chartScripts = '';
        const widgetsHtml = (blueprint.widgets || []).map((w: any, index: number) => {
            const canvasId = `chart_${index}`;
            
            // Map the data for Chart.js
            let chartConfig = '';
            if (w.type === 'scatter_plot') {
                const data = w.data_points.map((dp: any) => `{ x: ${dp.x_value || 0}, y: ${dp.y_value || 0}, r: 6 }`);
                const labels = w.data_points.map((dp: any) => `"${dp.label} (${dp.metadata || ''})"`);
                chartConfig = `
                type: 'bubble',
                data: {
                    labels: [${labels.join(',')}],
                    datasets: [{
                        label: '${w.title}',
                        data: [${data.join(',')}],
                        backgroundColor: 'rgba(56, 189, 248, 0.6)',
                        borderColor: 'rgba(56, 189, 248, 1)',
                    }]
                },
                options: { plugins: { legend: { display: false } }, scales: { x: { grid: { color: '#334155' } }, y: { grid: { color: '#334155' } } } }`;
            } else {
                // Default to Bar chart
                const labels = w.data_points.map((dp: any) => `"${dp.label}"`);
                const data = w.data_points.map((dp: any) => dp.y_value || dp.x_value || 0);
                chartConfig = `
                type: 'bar',
                data: {
                    labels: [${labels.join(',')}],
                    datasets: [{
                        label: '${w.title}',
                        data: [${data.join(',')}],
                        backgroundColor: 'rgba(167, 139, 250, 0.8)',
                    }]
                },
                options: { scales: { y: { beginAtZero: true, grid: { color: '#334155' } }, x: { grid: { display: false } } } }`;
            }

            chartScripts += `
            new Chart(document.getElementById('${canvasId}'), {
                ${chartConfig}
            });
            `;

            return `
            <div class="widget-card">
                <h3>${w.title}</h3>
                <p class="desc">${w.description}</p>
                <div class="chart-container">
                    <canvas id="${canvasId}"></canvas>
                </div>
            </div>`;
        }).join('');

        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HSP Quant Terminal</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --muted: #94a3b8; --accent: #38bdf8; --border: #334155; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 40px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 1px; color: var(--text); }
        .header .meta { color: var(--muted); font-size: 14px; font-family: monospace; }
        .terminal-feed { background: #000; color: #10b981; padding: 16px; font-family: monospace; font-size: 14px; border-radius: 6px; margin-bottom: 30px; border-left: 4px solid #10b981; }
        .consensus-card { background: var(--card); border: 1px solid var(--accent); border-radius: 8px; padding: 24px; margin-bottom: 40px; }
        .consensus-header { font-size: 12px; font-weight: bold; color: var(--accent); letter-spacing: 2px; margin-bottom: 16px; text-transform: uppercase; }
        .consensus-body { display: flex; gap: 40px; }
        .stat { display: flex; flex-direction: column; gap: 8px; }
        .stat .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
        .stat .value { font-size: 20px; font-weight: 500; }
        .stat .highlight { color: #10b981; font-weight: bold; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 24px; }
        .widget-card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 24px; }
        .widget-card h3 { margin: 0 0 8px 0; font-size: 16px; font-weight: 500; }
        .widget-card .desc { color: var(--muted); font-size: 14px; margin: 0 0 24px 0; }
        .chart-container { position: relative; height: 300px; width: 100%; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>HSP // QUANTITATIVE ANALYSIS</h1>
            <div class="meta">SESSION ID: ${productId}</div>
        </div>
        
        ${blueprint.terminal_feed ? `<div class="terminal-feed">> ${blueprint.terminal_feed}</div>` : ''}
        ${consensusHtml}
        
        <div class="grid">
            ${widgetsHtml}
        </div>
    </div>
    <script>
        // Initialize Charts
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.font.family = 'Inter';
        ${chartScripts}
    </script>
</body>
</html>`;

        fs.writeFileSync(filePath, htmlContent);
        console.log(`✅ Success! Professional Quant Dashboard generated at: ./products/${fileName}`);
    }
}
