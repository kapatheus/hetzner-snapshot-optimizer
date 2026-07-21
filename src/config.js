const DEFAULT_ROTATION = parseInt(process.env.DEFAULT_ROTATION || "7", 10);
const DEFAULT_INTERVAL_DAYS = parseFloat(process.env.DEFAULT_INTERVAL_DAYS || "1");

function getLabel(server, key) {
  return server.labels?.[key];
}

/**
 * Is this server excluded from bot management?
 * Label: snapshot-bot.enabled=false
 */
export function isExcluded(server) {
  return getLabel(server, "snapshot-bot.enabled") === "false";
}

/**
 * Resolves a manual monthly price override, in the same currency as Hetzner's
 * /pricing response, for servers whose server_type is no longer listed there
 * (e.g. legacy/discontinued plans still billed at a grandfathered price).
 * Label: snapshot-bot.price-override (must be the NET price, VAT excluded,
 * matching what /pricing returns for other servers).
 * Returns null if not set or not a valid number.
 */
export function resolvePriceOverride(server) {
  const label = getLabel(server, "snapshot-bot.price-override");
  if (!label) return null;
  const value = parseFloat(label);
  return isNaN(value) ? null : value;
}

/**
 * Resolves a server's settings purely from Hetzner labels:
 * - snapshot-bot.rotation        (how many snapshots to keep)
 * - snapshot-bot.interval-days   (how many days between snapshots)
 * Falls back to DEFAULT_ROTATION / DEFAULT_INTERVAL_DAYS env vars if a label is missing.
 */
export function resolveServerSettings(server) {
  const rotationLabel = getLabel(server, "snapshot-bot.rotation");
  const intervalLabel = getLabel(server, "snapshot-bot.interval-days");

  const rotation =
    rotationLabel && !isNaN(parseInt(rotationLabel, 10))
      ? parseInt(rotationLabel, 10)
      : DEFAULT_ROTATION;

  const intervalDays =
    intervalLabel && !isNaN(parseFloat(intervalLabel))
      ? parseFloat(intervalLabel)
      : DEFAULT_INTERVAL_DAYS;

  return { rotation, intervalDays };
}
