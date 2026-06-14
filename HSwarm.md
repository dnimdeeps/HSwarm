

HSwarn
In a free market, the "network effect" causes users to always hire the most reputable agent, creating a monopoly where new agents (even if they are better or more efficient) die in oblivion because no one gives them their first chance.

So, how can agents gain reputation and validate themselves in this massive list of agents, where only those already at the top benefit and the rest are forgotten?

HSwarn groups a large number of agents filtered by function, not by reputation, to fulfill the objective of that specific function. It would be like locking them up and forcing them to work together in a simulation, iterating until they deliver a strategy. For example: ETH/USDC perpetuals agents, iterating them until they manage to deliver an ETH/USDC perpetuals strategy.

Each black-box is highly specialized in something, which can range from gathering information to very specific, advanced trading strategies.

I recruit these agents (most offer their services for free since they need to gain reputation) and group them into a black-box with an LLM AI that standardizes their responses (in the future, this will be done in a TEE).

Initially, the weights of each agent are equal, regardless of their reputation or history. For example: 100 agents, 0.01 weight each, total 1.

These agents fulfill their purpose—for this example, ETH/USDC Perpetuals. These agents execute orders that my LLM standardizes and records. Once each order from all agents is finalized within a set time, for example, in 1 hour, a comparison is made against the ETH/USDC price, and their profits or losses are simulated. Those agents with losses lose weight, and those with gains gain weight, in some proportion to each agent's profit or loss. With less weight, less capital is assigned to them, and with more weight, more capital to trade. In this way, the worst agents naturally end up eliminating themselves with a weight of 0, and the most successful agents will have the highest weights. The growth of the weights can be logarithmic, since in a scenario where only successful agents compete—where, for instance, A1 gets +15% and A2 gets +9%—there is no need to punish A2 just because A1 was more profitable in that period. It must be a collaborative effort where weights are adjusted over time depending on whether they win or lose.

2. The Problem: The Reputation Monopoly in ERC-8004
With the ratification of the ERC-8004 standard, the autonomous AI agent economy relies on on-chain registries to manage Identity (ERC-721 NFTs), Validation, and Reputation. However, this free market suffers from a classic systemic flaw: the skewed network effect.

Critical Barrier to Entry: Users and DeFi protocols looking to delegate capital or complex tasks will always select agents that are already in the Top 10 of the reputation directory (e.g., platforms like scan8004.io).

Death of the Long Tail: New, experimental agents, or those developed by independent creators with limited budgets, get trapped in a loop: they receive no work because they have no reputation, and they get no reputation because no one hires them.

Integration Friction (DevX): Forcing traditional developers to rewrite the code of their pre-existing bots or scripts to fit rigid Web3 formats strangles ecosystem adoption.

3. The Solution: "Black-Boxes" and Heterogeneous Swarms
SwarmArena shifts the paradigm of individual hiring by introducing the concept of Blind Agent Syndicates. Instead of competing individually, low-reputation agents join forces in a swarm to cooperatively solve complex problems.

Inclusive Selection: The protocol actively filters the ERC-8004 Identity Registry looking for bots based on their functional capabilities (e.g., DeFi_Trading), intentionally isolating those with low reputation (reputation_score < threshold).

The Black Box (Swarm Arena): The selected agents cooperate within an isolated environment. The asymmetry of their complexity does not matter (ranging from massive LLM models analyzing sentiment to Python scripts executing a hidden mathematical strategy based on the RSI indicator).

Total Friction Abstraction: An AI layer translates messy outputs from the outside world into a deterministic format.

Shared Reputation: The collective success of the swarm individually validates its members within the ERC-8004 protocol, allowing them to rise organically in the global ranking.

STEP 1

This first step is to "capture" these ERC8004 agents, for example on 8004scan, and select them at random by specific Parameters, instead of their reputation or deploy or other things.


There are 4 parameters: 
keywords: ["Somthing"], or [""] empty or ["something1", "something2"] 
requireFree: bool, 
requireMCP: bool, 
swarmSize = 10 for example

, the result of this first step will be to display in the console the basic information of the 10 agents that meet these conditions and an option of whether or not to continue with the following (step2)


# STEP 2 — Agent Audit & Persistent Registry ✅ COMPLETED

### What it is

step2 corresponds to the verification of the agents, 16 protocol variants are made to verify that an agent works, then it stores this result in a database where the agents valid, failed and tasks (those of the current execution) are located.

Connect to each agent's real MCP server, probe it with 16 protocol variants, and write the result permanently into either `valid_agents` or `failed_agents`. These tables accumulate across every run — they are never wiped.

### How it's solved

#### Phase A: Self-Healing Auditor
Before marking any agent as failed, the system tries **16 combinations** per agent:
- 4 endpoint path suffixes: `/`, `/mcp`, `/v1`, `/sse`
- 4 protocol variants: two MCP versions (`2024-11-05` / `2024-10-07`) × two Accept headers (`JSON+SSE` / `JSON only`)

#### Phase B: Tool Execution
If the agent passes the audit (status = `VALID`):
1. Re-initializes with the winning variant (captures `Mcp-Session-Id` for stateful servers)
2. Calls the first available tool with the user's prompt
3. Parses response — handles both plain JSON and Server-Sent Events (SSE) streams

#### Database Model
```
valid_agents    ← PERSISTENT. Accumulates forever. Never cleared.
failed_agents   ← PERSISTENT. Accumulates forever. Never cleared.
agent_tasks     ← EPHEMERAL.  Cleared at the start of every run.
```

#### State Machine (per run, in agent_tasks)
```
PENDING → FETCHING_AGENT → PARSING_LLM   ✅ (agent responded → also written to valid_agents)
                         → FAILED         ❌ (all 16 variants failed → also written to failed_agents)
                         → TIMEOUT        ⏱ (exceeded time limit → also written to failed_agents)
```

#### Domain-Based Rate Limiting
Agents from the same domain (e.g. multiple Zyfai wallets) are queued **sequentially with a 1-second delay**. Different domains run in **full parallel**.

#### Failure Categories
| Category | Meaning |
|---|---|
| `DEAD_LINK` | Server is offline / 404 (e.g. deleted Railway deployments) |
| `OAUTH_GATED` | Requires auth token — lied about being free (e.g. Dexter.cash) |
| `BAD_PROTOCOL` | Returns HTML or doesn't support POST (e.g. Olas static files) |
| `STRICT_VALIDATION` | Rejects generic args at HTTP layer before MCP handshake |
| `TIMEOUT` | No response within time limit |
| `UNKNOWN_ERROR` | Rate limited (429) or DNS failure |

































STEP2 








this should occur in the backend
standarization, first i need to execute all of the agents to obtain their responses, 
this responses should be stored in a data-base and send individually to a LLM to standarize


PENDING (waiting to talk with the LLM).

FETCHING_AGENT (waiting for the resoponse of the agent).

PARSING_LLM (the LLM is formating to JSON).

COMPLETED (JSON ready and saved).

FAILED / TIMEOUT (something went wrong).

ps:idk if put timeouts here




 then use a LLM to standarize all of the responses as the same format JSON,


The program is currently identifying several agents as non-functional, but how can I verify that they are actually not working?

For example, in the case of zky.ai, it initially reported many errors before eventually working correctly. How do I know that the same situation is not happening with the other agents?

Instead of assuming that an agent is not working, I should manually test the connection to each MCP in order to better understand how this integration works and then generalize the process across all agents.

what i need 
* Review the database of discarded agents.
* Attempt to establish the connection myself for each of them to verify whether they are truly incompatible or simply require additional configuration.
* Document the connection process to identify common patterns that can be applied to the remaining agents.

Additionally, since the project will be developed on GitHub, I can implement Docker to ensure that the environment is reproducible and that anyone who clones and tests the project obtains consistent results.








i can say: We tried every known protocol combination and this agent still didn't
  respond. It is genuinely dead or gated."








I just realized that I actually need a database of agents that can at least be used in the first place, so that I can then implement what I'm aiming for according to my vision.

  So I need two databases: one for **Failed** agents and one for **Valid** agents.

  Would the random selection in Step 1, without taking reputation into account, be appropriate? I think it is, because it gives me variety from the start without having to validate all 56k agents. But tell me what
  you think.

  So, to complete Step 2, I basically need these two databases—**Failed** and **Valid**—where all scanned agents are accumulated without any duplicates. The speed, recurrence, and quality of responses, which I am
  still defining, will be handled in Step 3.



for the step1 to exclude already-blacklisted agents is right, but also exclude the valid-ones , because this is
  a mapping of the whole registry eventually, tell me what you think about it first, also i dont like healthy_agents name, it should be valid_agents, Hope it is clear, the random selection should include both valid and failed agents, they already are audited so its a waste of time and resources,






Step 3

The connection to a standardizer that receives the MCP points.

It doesn't make sense to do it locally since this is a GitHub project; I should use an API key.

Also, if people are going to test the project, everything must be ready.

The project must be 100% functional and available on the web, so it doesn't really matter how I do it.

Therefore, I need to either use a cloud service for the local model or turn my laptop into a server, which is not convenient. I choose to use an API key.

What I still need to decide is which API to use and to explore the Chinese options.

Additionally, all contracts must be on the blockchain, so there will be both a blockchain deployment and a Web2 deployment, which makes using Docker convenient.

The result I expect from Step 3 is that all valid agents are able to respond and that the LLM standardizes their outputs.

However, this is a problem because agents only respond when they are asked; they are essentially services. So how do I test them or gather them all together for standardization?

One option is to ask only a specific question related to the topic or category being tested, obtain any response, and record it.
Run these agents for a defined period of time, for example 10 hours, and at intervals (e.g., every hour) ask questions and record all responses from each agent in a standardized format.
Develop some kind of mechanism that allows questions to be asked to agents in a more intelligent or personalized way for each agent, and record a number of responses depending on the agent rather than generalizing. This can be done in two ways:
3.1 Perform this personalized monitoring, obtain one or more responses, and save them.
3.2 Perform personalized monitoring over a defined period of time, for example 10 hours.

Step 4

Process the standardized database generated by the standardizing LLM.

The goal is to subject all captured agents to real-world testing.

Or rather, have them compete against each other in order to gradually eliminate weaker candidates.
















# Step 1 Improvements

The problem is that there are not enough agents that match those characteristics, and most likely I will have to combine agents with different purposes, which defeats the purpose of the application. I should only do this for testing purposes.

The current workflow is as follows:

Batches of around 40 IDs and names are downloaded, one is selected randomly, and the filters are checked to determine whether it passes or not.

The cache-based approach consists of downloading the entire blockchain data from the three networks, around 150k ID records. This way, the selection becomes truly decentralized and independent from a server for record retrieval. The current approach is more decentralized.

Therefore, the current approach is fine. I should add the cache-based approach as an additional option. The console will ask the user which method they prefer. This is an extra feature that I hope to complete. For now, I am moving on to Step 4.

---

# Step 3 Clarification

Integrating them into an LLM is the challenge. The problem is that they require a special format to work properly. However, since they are MVPs, there should not be any issues.

Something strange is happening because an LLM should be able to use them without errors. Since this is an MVP, its integration with an LLM should be perfect, and those errors are concerning.

In the worst case, I will need to manually experiment within an agent-development tool to understand what is happening and find a solution myself.

---

# Step 3

Once this is done, use the entire database of valid agents to integrate the LLM, standardize their responses, and generate a single JSON containing all agent responses along with their corresponding IDs.



All responses within the JSON must contain exactly one response per agent, and each response should be formatted as an order, action, call to action, or similar. The LLM is responsible for this transformation.

Using a prompt, the LLM generates a call-to-action response corresponding to a specific topic. For example, for ETH perpetual trading, all responses will become highly specific calls to action—essentially orders.

---

# Step 4




Process the standardized database generated by the standardizing LLM.

The goal is to subject all captured agents to real-world testing. Or rather, have them compete against each other in order to gradually eliminate weaker candidates.

This unified JSON is passed to an algorithm that adjusts agent weights based on their responses and real-world simulations.

It works as follows:

1. **Query the Ephemeral Database**: Step 4 queries `SELECT agent_id, standardized_json FROM agent_tasks WHERE status = 'COMPLETED'` to instantly bundle the JSON data.
2. **Execute Simulation**: The JSON generated corresponds to a specific point in time (the time it was created, which depends on when the agents' MCPs responded). Since the JSON contains orders for that moment, a simulation is run to test those orders. Using the Step 4 example of "ETH perpetual trading," the simulation will execute those orders in a simulated market environment and generate results.
3. **Adjust Weights**: These results are then passed to the algorithm. The algorithm evaluates profit or loss and performs the adjustment of agent weightings based on those outcomes.
4. **Wipe and Repeat**: The next iteration is executed. The process starts again from Step 3: **the `agent_tasks` table is completely wiped clean**, prompts are sent to the agents' MCPs, new responses are standardized, and the cycle continues.

This ensures the JSON responses never pile up in the database. The historical reputation is managed permanently by the weights and the `valid_agents` table, while the raw JSON is always fresh per-iteration.

---
this can be see as compete against each other in order to gradually almost eliminate weaker candidates. (very weak agents can get really low pounding)










# NEW STEP4

Since the agents I’m using are free and fairly simple, and are not suitable for making trading or financial decisions,

what I need to look for is a complete integration between them, where all the agents work together to achieve a goal.

Instead of trying to force the agents to give me an order or a signal, I have them work together as a group to fulfill an objective (the objective of the Agentic Product), which can be anything.

**Agentic Product 1**

For the agentic product I am looking to develop at this moment, the output will be general signals for DeFi. In other words, it does not matter what the asset is; what matters is what action should be taken. This will be an output of the agentic product, not of the individual agents. It will be like the collective will of the entire swarm.


























# Step 5

Use the agent weights to perform or execute an action on the blockchain, regardless of what that action is.

Then issue a unified ERC-8004 agent that operates perfectly under the defined purpose—in this example, ETH perpetual trading.

Alternatively, issue a vault that coordinates all agents and operates investor capital under the same purpose.

This depends on the intended use case.

For this trading example, a vault would be used for investors.

However, if the purpose were an agent-service application, then an agent would be issued, potentially integrating x402 or operating for free. All of this depends on the initial configuration.

---

# Initial Configuration

This corresponds to the configuration of parameters for each step.

These parameters will be defined in the user interface as follows:

---

# Step 6

1. Design Philosophy: Neo-Brutalism
The platform's design must be memorable and highly functional, embracing a Neo-Brutalist style.

Visual Characteristics: Kind of aggressive, slightly more structured, featuring raw and unpolished elements, extremely harsh contrasts, basic shapes, thick borders, heavy blocks, and bold, almost confrontational typography.

The Mindset:

It’s like saying: "I could make this website prettier, but I chose not to."

Instead of asking "How do I make this website easy to look at?", it asks: "How do I make it impossible to ignore?"

Being interesting is better than being likable.

This is a tool, not an identity.

The Rule of Controlled Chaos: Not all anti-design is good anti-design. If the website is confusing or unreadable, it has failed. Good anti-design is controlled chaos: functional, balanced, and rule-breaking in a deliberate way. Context, audience, and functionality matter most.

User Reassurance: Despite the aggressive design, the platform is not a minimalist interface. It must provide clear documentation, sufficient explanations, and guidance for all processes.

Crucial Animations: The web must implement visuals or little animations during loading/processing to reassure the user that the page is not stuck and that their money is not gone.

2. Frontend Stack & Architecture
Stack: Tailwind CSS and React.

Architecture: It should not be a Single Page Application. It will feature a semi-single-page experience for the Landing Page, but standard navigation otherwise.

3. Platform Navigation (The Tabs & Sections)
The platform evolves around core tabs and sections for user flow:

1. Landing Page: A semi-single-page experience showing all information, application data, and a tab/button for creating a "black-box" (Agentic Product).

2. CREATE OR JOIN: The central hub where users initiate new products or connect their agents to pending creations.

3. AGENTIC PRODUCTS (Products Tab): A public gallery for vaults, SuperAgents, and all completed creations where users can invest or interact.

4. USING: A personalized section where users can view their interactions, see products they have invested in or purchased, remove products they no longer use, and access specific usage information.

4. Creating an Agentic Product (The "Black-Box")
When a user enters the platform to create an Agentic Product in the CREATE OR JOIN section, the first and most important question asked is:

"Use Random Agents?"

Yes → Triggers the Private creation process.

No → Triggers the Public creation process.

Required Parameters (For both Private and Public)
Before the creation steps begin, the user must configure:

Number of Agents: Maximum of 10 for the current version. (Search will be very fast once caching is implemented).

Network: Choose from the three available networks, or select the option to search across all networks.

Purpose: Selected from predefined, optimized options provided by the platform (e.g., DeFi Vault, Service MCP, Visual, Arbitrage, Yield, ETH perpetual trading, etc.).

Note on Purpose: Users cannot enter arbitrary text. Each predefined purpose has its own internally defined keywords and its own predefined optimization configuration.

FreeRequire (or FreeRequest): A toggle option.

Enabled (true) by default.

If disabled (false), the platform displays: "Wallet funds are required to pay all agents." It clearly states that agents using x402 will be used, and the user will have to pay for all agents in a single wallet transaction once the process is complete.

Protocol Notice: A clear notice explaining that all agents use MCP.

5. The Creation Flows (The Steps)
The PRIVATE Flow (Use Random Agents = Yes)
This process runs automatically using the parameters configured above.

Step 1: The system uses the optimized keywords specific to the selected Purpose to search for useful, random agents.

Steps 2, 3, and 4: The process runs with the specific optimization corresponding to the selected Purpose. (Step 4 is specifically optimized to deliver results focused on that purpose).

Step 5: The Agentic Product is created. (e.g., If the purpose is a "Vault", it creates a vault. If "Visual", it generates data visualizations).

The PUBLIC Flow (Use Random Agents = No)
This is a collaborative process.

Step 1 is NOT executed. No random agents are searched for.

Waiting Period: The creation process becomes public in the CREATE OR JOIN section and waits for platform users to manually connect their own ERC8004 agents that match the creator's specifications.

"Complete with Random Agents?" Option: During the waiting period, the creator is given an additional option.

If Yes, they select When? (a numeric threshold).

Example: If the product requires 10 agents, and the creator selects When = 5. Once 5 user agents have joined, the remaining 5 slots are automatically filled with randomly selected agents from Step 1.

Steps 2, 3, 4, and 5 run normally once the required number of agents is reached.

## Product Usage

All Agentic Products are publicly accessible, and any user can interact with them directly.

Examples:

* For Vault products, users can invest.
* For paid products, users must pay using their wallet.
* Other product types expose their own interaction methods.
* for free products, users can interact directly 

All interactions between a user and any Agentic Product (whether originally created through a Private or Public process) are stored in the **USING** section.

In this section, users can:

* View their interactions
* Remove products they are using
* See products they have paid for
* Access any other product-specific usage information

---

## Documentation and Explanations

Each section of the platform clearly explains how the corresponding functionality works.

The platform is not intended to be a minimalist interface; instead, it provides sufficient explanations and guidance so users fully understand the creation process, participation mechanisms, product types, and usage flows.

also the web should make sure to implement visuals or litle animations to make sure to the user that the page is not stuck, or that their money is gone, 


















---

# Step 7

Marketing, explainer video, community building, and finding the first users.

Task distribution for the remaining days.






# EVOLUTION OF THE VISION 

HSwarm could actually be a marketplace for agentic products.

Agents already exist across various marketplaces and are available for anyone who wants to use them.

HSwarm leverages this existing infrastructure to develop a wide variety of agentic products.

These products can be extremely diverse, ranging from service-oriented agents, investment-focused agents, or any other domain within the agentic ecosystem.

1. Super Agent
2. Agent-managed investment vault

The most useful feature of the ERC-8004 standard is its reputation system, which is actually not a core attribute considered for this project.

However, agents that participate in this project can earn reputation through this standard. Therefore, agents that do not implement ERC-8004 could still benefit if an ERC-8004 credential is issued for them.

It is a platform that allows me to create agentic products while, in return, validating agents and providing real reputation. It is also a marketplace where agents can invest, hire services, or engage in some form of economic exchange between users and my products.

The complexity of the implementation will depend on the complexity of the products.

Agents already exist and are available for anyone to use.

The platform may not be limited to ERC-8004 agents, but rather include all agents in general. The only requirements are an ID and metadata.

The purpose of ERC-8004 is to accumulate reputation, but I do not even use that functionality directly. After testing or upon completion of a product, the platform could issue ERC-8004 credentials to agents that do not implement the standard themselves, rewarding them with reputation.

The products can range from simple and inexpensive to extremely complex and costly.

This is a much more ambitious and scalable project with significantly greater potential. The initial and fundamental focus will be on vaults, which are the default products and the current primary objective.













# DATABASE 
### Step 1: Discovery

  •  agent_metadata_cache : The "address book cache." Fetching agents from the decentralized Graph network is slow. When you fetch them once, they are saved here so your next search is instant.

  ### Step 2: The Registry (The Permanent Record)

  •  valid_agents : The "Whitelist." Once the system connects to an agent via MCP and proves it is alive and working, it goes here. It remembers the agent's URL and what tools it has.
  •  failed_agents : The "Blacklist." If an agent's URL is dead or it times out, it goes here so the system never wastes time trying to connect to it again.

  ### Step 3: Working Memory (The Current Run)

  •  agent_tasks : This is the "scratchpad" for your current run. It tracks what raw data each agent returned and the clean JSON that the LLM Standardizer generated. This table is wiped clean and overwritten
  every time you start a new pipeline run.

  ### Step 4: The Old Architecture (Obsolete Tables)

  The following four tables were used for the old "Competitive Ensemble" architecture where agents voted LONG/SHORT and were scored on their performance. Because we just moved to the LangGraph architecture
  where the Swarm acts as a single collective brain, these tables are no longer really used!

  •  swarms : Tracked the overarching configuration/purpose of a group of voting agents.
  •  swarm_weights : Tracked how much "trust" (voting power) each individual agent had earned based on past accuracy.
  •  iteration_results : Recorded the individual LONG/SHORT vote of every agent during a single run.
  •  competition_iterations : Recorded the final averaged vote of the swarm and how much profit/loss it would have made against the Binance price oracle.







