import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadState() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return { servers: {} };
    throw err;
  }
}

export async function saveState(state) {
  await ensureDataDir();
  const tmp = `${STATE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tmp, STATE_FILE);
}

/**
 * Gets/creates the state entry for a single server by serverId.
 */
export function getServerState(state, serverId) {
  if (!state.servers[serverId]) {
    state.servers[serverId] = {
      snapshots: [], // { imageId, createdAt, sizeGb, description }
      backupEnabledByBot: false,
    };
  }
  return state.servers[serverId];
}

/**
 * Has the server's intervalDays elapsed since its most recent snapshot?
 * Returns true if there are no snapshots yet (first run).
 */
export function isSnapshotDue(serverState, intervalDays) {
  const last = serverState.snapshots.at(-1);
  if (!last) return true;

  const lastTime = new Date(last.createdAt).getTime();
  const elapsedDays = (Date.now() - lastTime) / (1000 * 60 * 60 * 24);

  // Small tolerance (5 min) for minor cron timing jitter. Kept small so it
  // still works correctly with sub-day intervals (e.g. hourly).
  const toleranceDays = 5 / (24 * 60);
  return elapsedDays >= intervalDays - toleranceDays;
}
