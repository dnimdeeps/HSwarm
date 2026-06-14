import { openDatabase } from "../orchestrator/database";
import { SwarmKeeper } from "./swarmKeeper";

function main() {
  const intervalMs = parseInt(process.argv[2] || "120000", 10);
  console.log(`[KeeperRunner] Starting SwarmKeeper with interval ${intervalMs}ms...`);

  const db = openDatabase();
  const keeper = new SwarmKeeper(db, intervalMs);

  process.on("SIGINT", () => {
    console.log("[KeeperRunner] Shutting down...");
    keeper.stop();
    db.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("[KeeperRunner] Shutting down...");
    keeper.stop();
    db.close();
    process.exit(0);
  });

  keeper.start();

  // Periodically log status to stdout (consumed by parent process)
  setInterval(() => {
    console.log(`[KeeperRunner] status=${keeper.status} lastLog=${keeper.lastLog}`);
  }, 30_000);
}

main();
