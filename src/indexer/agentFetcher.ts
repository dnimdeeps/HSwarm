import { GraphQLClient, gql } from 'graphql-request';

export interface AgentFilter {
    keywords: string[];
    requireFree: boolean;
    requireMCP: boolean;
}

export interface SubgraphConfig {
    network: string;
    url: string;
}

export interface ERC8004Agent {
    network: string;
    discovery_keyword: string; // The specific keyword that found this agent
    id: string;
    owner: string;
    agentURI: string;
    name?: string;
    description?: string;
    functionality?: string;
    status?: string;
    x402Support?: boolean;
    has_mcp?: boolean;
    is_free?: boolean;
    services?: Array<{ name: string; endpoint: string; version?: string }>;
    rawMetadata?: string;
}

export class AgentFetcher {
    private subgraphs: SubgraphConfig[];

    constructor(subgraphs: SubgraphConfig[]) {
        this.subgraphs = subgraphs;
    }

    async fetchAgentsByFilter(
        filter: AgentFilter,
        limit: number = 10,
        excludedIds: Set<string> = new Set() // Format: "NetworkName_agentId"
    ): Promise<ERC8004Agent[]> {
        console.log(`\n[Subgraph] Fetching all agent IDs from ${this.subgraphs.length} network(s) for randomization...`);

        const rawAgentArrays = await Promise.all(this.subgraphs.map(async ({ network, url }) => {
            const client = new GraphQLClient(url);
            let networkAgents: ERC8004Agent[] = [];

            // The Graph's `id` field is a String, so id_gt uses lexicographic order.
            // '9' > '10000' lexicographically, so we use skip + createdAt windowing instead.
            // Strategy: fetch 1000 at a time with skip, re-anchor on createdAt every 5000 records.
            let createdAtGte = "0";
            let skip = 0;
            let hasMore = true;

            while (hasMore) {
                const query = gql`
                    query GetAgents($createdAtGte: String!, $skip: Int!) {
                        agents(
                            first: 1000,
                            skip: $skip,
                            where: { createdAt_gte: $createdAtGte },
                            orderBy: createdAt,
                            orderDirection: asc
                        ) {
                            id
                            owner
                            agentURI
                            createdAt
                        }
                    }
                `;
                try {
                    const data = await client.request<{ agents: any[] }>(query, { createdAtGte, skip });
                    if (data.agents.length > 0) {
                        const mapped = data.agents.map(a => ({
                            ...a,
                            network,
                            discovery_keyword: "random"
                        }));
                        networkAgents.push(...mapped);

                        // Re-anchor when approaching the 5000 skip limit
                        skip += data.agents.length;
                        if (skip >= 4000) {
                            // Move the createdAt window forward to avoid skip overflow
                            const lastCreatedAt = data.agents[data.agents.length - 1].createdAt;
                            createdAtGte = lastCreatedAt;
                            skip = 0;
                        }

                        if (data.agents.length < 1000) hasMore = false;
                    } else {
                        hasMore = false;
                    }
                } catch (err) {
                    console.error(`Error querying ${network}:`, err);
                    hasMore = false;
                }
            }
            console.log(`[Subgraph] ${network}: fetched ${networkAgents.length} total agent IDs`);
            return networkAgents;
        }));

        const allRawAgents = rawAgentArrays.flat();

        // Deduplicate by network+id (boundary duplicates from createdAt_gte re-anchoring)
        const seenKeys = new Set<string>();
        const dedupedAgents = allRawAgents.filter(a => {
            const key = `${a.network}_${a.id}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });
        if (dedupedAgents.length < allRawAgents.length)
            console.log(`[Subgraph] Removed ${allRawAgents.length - dedupedAgents.length} pagination duplicates.`);

        const unaudited = dedupedAgents.filter(a => !excludedIds.has(`${a.network}_${a.id}`));
        const skipped = dedupedAgents.length - unaudited.length;
        if (skipped > 0) console.log(`[Registry] Skipped ${skipped} previously audited agents.`);

        // True randomization: Fisher-Yates Shuffle
        const shuffled = [...unaudited];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        
        console.log(`[Off-Chain] Verifying IPFS metadata in parallel to find ${limit} matches...`);

        const BATCH_SIZE = 40;
        const matched: ERC8004Agent[] = [];

        for (let i = 0; i < shuffled.length; i += BATCH_SIZE) {
            if (matched.length >= limit) break;

            const batch = shuffled.slice(i, i + BATCH_SIZE);
            process.stdout.write(`\rScanning batch ${Math.floor(i / BATCH_SIZE) + 1}... Matches: ${matched.length}/${limit}`);

            const processed = await Promise.all(batch.map(async (a) => {
                let url = a.agentURI;
                if (!url || !url.startsWith("http") && !url.startsWith("ipfs://")) return null;
                if (url.startsWith("ipfs://")) url = url.replace("ipfs://", "https://ipfs.io/ipfs/");

                let agentMeta: any = { ...a };
                let timeoutId: any;
                
                try {
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 4000);
                    const res = await fetch(url, { signal: controller.signal as any });
                    
                    const bodyText = await res.text(); // ALWAYS drain the body to free the Node.js socket!
                    
                    if (res.ok) {
                        const metadata = JSON.parse(bodyText);
                        agentMeta.name        = metadata.name || "Unknown";
                        agentMeta.description = metadata.description || "";
                        agentMeta.status      = metadata.active ? "Active" : "Inactive";
                        agentMeta.x402Support = metadata.x402Support ?? false;
                        agentMeta.services    = metadata.services || [];
                        agentMeta.rawMetadata = bodyText;
                        
                        agentMeta.has_mcp = agentMeta.services?.some((s: any) => s.name?.toLowerCase() === "mcp") ?? false;
                        agentMeta.is_free = agentMeta.x402Support === false;
                        
                        return agentMeta;
                    }
                } catch {
                    // Ignore IPFS timeouts
                } finally {
                    if (timeoutId) clearTimeout(timeoutId);
                }
                return null;
            }));

            for (const agentMeta of processed) {
                if (!agentMeta) continue;
                if (matched.length >= limit) break;

                let isMatch = false;
                if (agentMeta.status === "Active") {
                    let keywordPassed = true;
                    if (filter.keywords && filter.keywords.length > 0) {
                        const text = (agentMeta.rawMetadata || "").toLowerCase();
                        const foundKw = filter.keywords.find(kw => text.includes(kw.toLowerCase()));
                        if (!foundKw) keywordPassed = false;
                        else agentMeta.discovery_keyword = foundKw;
                    }

                    const freePassed = filter.requireFree ? agentMeta.is_free : true;
                    const mcpPassed = filter.requireMCP ? agentMeta.has_mcp : true;

                    if (keywordPassed && freePassed && mcpPassed) {
                        isMatch = true;
                    }
                }

                if (isMatch) {
                    matched.push(agentMeta);
                    process.stdout.write(`\rFound match: ${matched.length}/${limit}    `);
                }
            }
        }
        
        console.log(`\n[Fetcher] Successfully found ${matched.length} matching agents.`);
        return matched;
    }

    // ─── CACHE-BASED DISCOVERY ──────────────────────────────────────────────────

    async buildCache(db: any) {
        console.log(`\n[Cache Sync] Fetching all agent IDs from ${this.subgraphs.length} network(s)...`);
        
        const rawAgentArrays = await Promise.all(this.subgraphs.map(async ({ network, url }) => {
            const client = new GraphQLClient(url);
            let networkAgents: any[] = [];

            // Same skip+createdAt anchor strategy to fetch all agents correctly
            let createdAtGte = "0";
            let skip = 0;
            let hasMore = true;

            while (hasMore) {
                const query = gql`
                    query GetAgents($createdAtGte: String!, $skip: Int!) {
                        agents(
                            first: 1000,
                            skip: $skip,
                            where: { createdAt_gte: $createdAtGte },
                            orderBy: createdAt,
                            orderDirection: asc
                        ) {
                            id
                            owner
                            agentURI
                            createdAt
                        }
                    }
                `;
                try {
                    const data = await client.request<{ agents: any[] }>(query, { createdAtGte, skip });
                    if (data.agents.length > 0) {
                        const mapped = data.agents.map(a => ({ ...a, network }));
                        networkAgents.push(...mapped);

                        skip += data.agents.length;
                        if (skip >= 4000) {
                            const lastCreatedAt = data.agents[data.agents.length - 1].createdAt;
                            createdAtGte = lastCreatedAt;
                            skip = 0;
                        }

                        if (data.agents.length < 1000) hasMore = false;
                    } else {
                        hasMore = false;
                    }
                } catch (err) {
                    console.error(`Error querying ${network}:`, err);
                    hasMore = false;
                }
            }
            console.log(`[Cache Sync] ${network}: found ${networkAgents.length} agent IDs`);
            return networkAgents;
        }));

        const allRawAgents = rawAgentArrays.flat();

        // Deduplicate by network+id before fetching IPFS to avoid redundant requests
        const seenKeys = new Set<string>();
        const dedupedRaw = allRawAgents.filter(a => {
            const key = `${a.network}_${a.id}`;
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });
        console.log(`[Cache Sync] Found ${dedupedRaw.length} unique IDs (${allRawAgents.length - dedupedRaw.length} duplicates removed). Syncing IPFS metadata...`);

        const BATCH_SIZE = 50;
        let syncedCount = 0;

        for (let i = 0; i < dedupedRaw.length; i += BATCH_SIZE) {
            const batch = dedupedRaw.slice(i, i + BATCH_SIZE);
            process.stdout.write(`\rSyncing batch ${Math.floor(i / BATCH_SIZE) + 1}... (${syncedCount}/${dedupedRaw.length} synced)`);

            await Promise.all(batch.map(async (a) => {
                let url = a.agentURI;
                if (!url || !url.startsWith("http") && !url.startsWith("ipfs://")) return;
                if (url.startsWith("ipfs://")) url = url.replace("ipfs://", "https://ipfs.io/ipfs/");

                let timeoutId: any;
                try {
                    const controller = new AbortController();
                    timeoutId = setTimeout(() => controller.abort(), 4000);
                    const res = await fetch(url, { signal: controller.signal as any });
                    
                    const bodyText = await res.text();
                    
                    if (res.ok) {
                        const metadata = JSON.parse(bodyText);
                        const services = metadata.services || [];
                        const has_mcp = services.some((s: any) => s.name?.toLowerCase() === "mcp") ? 1 : 0;
                        const is_free = metadata.x402Support === false ? 1 : 0;

                        db.prepare(`
                            INSERT INTO agent_metadata_cache (network, agent_id, agent_uri, name, description, status, x402Support, has_mcp, is_free, rawMetadata, last_synced)
                            VALUES (@network, @agent_id, @agent_uri, @name, @description, @status, @x402Support, @has_mcp, @is_free, @rawMetadata, datetime('now'))
                            ON CONFLICT(network, agent_id) DO UPDATE SET
                                agent_uri    = excluded.agent_uri,
                                name         = excluded.name,
                                description  = excluded.description,
                                status       = excluded.status,
                                x402Support  = excluded.x402Support,
                                has_mcp      = excluded.has_mcp,
                                is_free      = excluded.is_free,
                                rawMetadata  = excluded.rawMetadata,
                                last_synced  = datetime('now')
                        `).run({
                            network: a.network,
                            agent_id: a.id,
                            agent_uri: a.agentURI,
                            name: metadata.name || "Unknown",
                            description: metadata.description || "",
                            status: metadata.active ? "Active" : "Inactive",
                            x402Support: metadata.x402Support ? 1 : 0,
                            has_mcp,
                            is_free,
                            rawMetadata: bodyText
                        });
                        syncedCount++;
                    }
                } catch {
                    // Ignore failures, we just don't cache them
                } finally {
                    if (timeoutId) clearTimeout(timeoutId);
                }
            }));
        }
        
        console.log(`\n[Cache Sync] Completed. Synced ${syncedCount} agents to local database.`);
    }

    async fetchAgentsFromCache(
        db: any,
        filter: AgentFilter,
        limit: number = 10,
        excludedIds: Set<string> = new Set()
    ): Promise<ERC8004Agent[]> {
        console.log(`\n[Cache] Querying SQLite for ${limit} agents...`);
        
        // Build SQL query
        let query = `SELECT * FROM agent_metadata_cache WHERE status = 'Active'`;
        const params: any = {};

        if (filter.requireFree) {
            query += ` AND is_free = 1`;
        }
        if (filter.requireMCP) {
            query += ` AND has_mcp = 1`;
        }

        // We fetch all matching from DB to shuffle them in TS, avoiding random() biases in SQLite
        const rows = db.prepare(query).all();
        
        let validRows = rows.filter((r: any) => !excludedIds.has(`${r.network}_${r.agent_id}`));

        if (filter.keywords && filter.keywords.length > 0) {
            validRows = validRows.filter((r: any) => {
                const text = (r.rawMetadata || "").toLowerCase();
                return filter.keywords!.some(kw => text.includes(kw.toLowerCase()));
            });
        }

        // Fisher-Yates shuffle
        const shuffled = [...validRows];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const selected = shuffled.slice(0, limit);
        
        console.log(`[Cache] Found ${selected.length} matching agents in local database.`);
        
        return selected.map(r => {
            // Parse rawMetadata to restore the real services array (including MCP endpoint).
            // Without this, services is [] and the auditor immediately fails every agent
            // with "No MCP endpoint registered".
            let services: Array<{ name: string; endpoint: string; version?: string }> = [];
            try {
                const meta = JSON.parse(r.rawMetadata || "{}");
                services = meta.services || [];
            } catch { /* ignore bad JSON */ }

            return {
                id: r.agent_id,
                owner: "",
                agentURI: r.agent_uri,
                network: r.network,
                name: r.name,
                description: r.description,
                status: r.status,
                x402Support: r.x402Support === 1,
                services,
                has_mcp: r.has_mcp === 1,
                is_free: r.is_free === 1,
                discovery_keyword: "cache_search",
                rawMetadata: r.rawMetadata
            };
        });
    }

    selectRandomAgents(agents: ERC8004Agent[], count: number): ERC8004Agent[] {
        if (agents.length <= count) return agents;
        const shuffled = [...agents].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }
}
