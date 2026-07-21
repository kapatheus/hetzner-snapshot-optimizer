import cron from "node-cron";
import "dotenv/config";

import {
  getAllServers,
  getPricing,
  getServerMonthlyPriceNet,
  getSnapshotPricePerGbNet,
  getBackupPercentage,
  getCurrency,
  createSnapshotAndWait,
  deleteImage,
  enableBackup,
  isBackupEnabled,
} from "./hetznerApi.js";
import { isExcluded, resolveServerSettings, resolvePriceOverride } from "./config.js";
import { loadState, saveState, getServerState, isSnapshotDue } from "./state.js";
import { calculateCosts } from "./costCalculator.js";
import { notify, log } from "./notifier.js";

const TOKEN = process.env.HETZNER_API_TOKEN;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "0 3 * * *";
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || process.env.TZ || "Europe/Helsinki";
// Whether to send a Discord notification every time a snapshot is taken (just the
// size, no cost breakdown - see the backup-switch notification for that). Always
// logged to console either way - this only controls the Discord message. Defaults
// to false since this is routine and can happen daily per server; set to "true" if
// you want a Discord ping for every snapshot too.
const NOTIFY_ON_SNAPSHOT = (process.env.NOTIFY_ON_SNAPSHOT ?? "false").toLowerCase() === "true";

if (!TOKEN) {
  console.error("HETZNER_API_TOKEN is missing from environment variables.");
  process.exit(1);
}

function formatMoney(amount, currency) {
  return `${amount.toFixed(3)} ${currency}`;
}

async function runOnce() {
  log("Run starting...");

  const [pricing, servers, state] = await Promise.all([
    getPricing(TOKEN),
    getAllServers(TOKEN),
    loadState(),
  ]);

  const snapshotPricePerGbNet = getSnapshotPricePerGbNet(pricing);
  const backupPercentage = getBackupPercentage(pricing);
  const currency = getCurrency(pricing);

  const summary = { snapshotsTaken: 0, backupsEnabled: 0, errors: 0 };

  for (const server of servers) {
    try {
      await processServer({
        server,
        pricing,
        snapshotPricePerGbNet,
        backupPercentage,
        currency,
        state,
        summary,
      });
    } catch (err) {
      summary.errors++;
      await notify(
        `⚠️ Error processing server **${server.name}**: ${err.message}`,
        { isError: true }
      );
    }
  }

  await saveState(state);
  await notify(
    `✅ Run finished: ${summary.snapshotsTaken} snapshot(s) taken, ` +
      `${summary.backupsEnabled} backup(s) enabled, ${summary.errors} error(s).`
  );
  log("Run finished.");
}

async function processServer({
  server,
  pricing,
  snapshotPricePerGbNet,
  backupPercentage,
  currency,
  state,
  summary,
}) {
  if (isExcluded(server)) {
    log(`${server.name}: skipped (snapshot-bot.enabled=false)`);
    return;
  }

  if (isBackupEnabled(server)) {
    log(`${server.name}: Backup already enabled, skipping snapshot.`);
    return;
  }

  const { rotation, intervalDays } = resolveServerSettings(server);
  const priceOverride = resolvePriceOverride(server);
  const serverMonthlyPriceNet =
    priceOverride !== null ? priceOverride : getServerMonthlyPriceNet(pricing, server);

  if (priceOverride !== null) {
    log(`${server.name}: using manual price override (${priceOverride} ${currency}/mo, server_type not in current /pricing)`);
  }

  const serverState = getServerState(state, server.id);

  if (!isSnapshotDue(serverState, intervalDays)) {
    log(`${server.name}: not due yet (intervalDays=${intervalDays}), skipping.`);
    return;
  }

  // Take a new snapshot
  const description = `snapshot-bot ${new Date().toISOString()}`;
  log(`${server.name}: taking snapshot...`);
  const image = await createSnapshotAndWait(TOKEN, server.id, description);
  const sizeGb = image.image_size; // compressed size in GB, same value Hetzner bills for

  serverState.snapshots.push({
    imageId: image.id,
    createdAt: new Date().toISOString(),
    sizeGb,
    description,
  });

  // Rotation: remove oldest snapshots beyond the retention limit
  while (serverState.snapshots.length > rotation) {
    const oldest = serverState.snapshots.shift();
    try {
      await deleteImage(TOKEN, oldest.imageId);
      log(`${server.name}: deleted old snapshot ${oldest.imageId}`);
    } catch (err) {
      log(`${server.name}: failed to delete old snapshot (${oldest.imageId}): ${err.message}`);
    }
  }

  // Cost calculation using the average of recent snapshot sizes
  const recentSizes = serverState.snapshots.map((s) => s.sizeGb);
  const costs = calculateCosts({
    serverMonthlyPriceNet,
    snapshotPricePerGbNet,
    backupPercentage,
    snapshotSizesGb: recentSizes,
    rotation,
  });

  const costSummary =
    `**${server.name}** - snapshot ${sizeGb.toFixed(2)}GB, rotation ${rotation}\n` +
    `Snapshot cost (${rotation}x): ${formatMoney(costs.totalSnapshotCost, currency)}/mo | ` +
    `Backup: ${formatMoney(costs.backupCost, currency)}/mo (${backupPercentage}%)`;

  log(costSummary);
  summary.snapshotsTaken++;

  if (NOTIFY_ON_SNAPSHOT) {
    await notify(`📸 **${server.name}**: snapshot taken (${sizeGb.toFixed(2)}GB, rotation ${rotation}).`);
  }

  if (costs.backupIsCheaper) {
    await notify(
      `🔄 **${server.name}**: Backup is now cheaper than ${rotation}x snapshots ` +
        `(${formatMoney(costs.backupCost, currency)}/mo vs ${formatMoney(costs.totalSnapshotCost, currency)}/mo, ` +
        `average size ${costs.avgSizeGb.toFixed(2)}GB, break-even ${costs.breakEvenGb.toFixed(2)}GB). ` +
        `Enabling Backup automatically and stopping snapshots for this server.`
    );

    await enableBackup(TOKEN, server.id);
    serverState.backupEnabledByBot = true;

    // Clean up the bot's own snapshots since Backup now handles protection
    for (const snap of serverState.snapshots) {
      try {
        await deleteImage(TOKEN, snap.imageId);
      } catch (err) {
        log(`${server.name}: failed to clean up snapshot (${snap.imageId}): ${err.message}`);
      }
    }
    serverState.snapshots = [];

    await notify(`✅ **${server.name}**: Backup is now enabled.`);
    summary.backupsEnabled++;
  }
}

const args = process.argv.slice(2);
if (args.includes("--once")) {
  runOnce()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  log(`Bot started. Cron schedule: ${CRON_SCHEDULE} (timezone: ${CRON_TIMEZONE})`);
  notify("🤖 Hetzner Snapshot Optimizer started.");

  cron.schedule(
    CRON_SCHEDULE,
    () => {
      runOnce().catch((err) => notify(`⚠️ Run failed: ${err.message}`, { isError: true }));
    },
    { timezone: CRON_TIMEZONE }
  );

  // Also run immediately on startup
  runOnce().catch((err) => notify(`⚠️ Run failed: ${err.message}`, { isError: true }));
}
