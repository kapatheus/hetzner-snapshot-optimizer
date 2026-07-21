const API_BASE = "https://api.hetzner.cloud/v1";

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function hetznerFetch(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Hetzner API ${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }

  // 204 No Content responses have no body
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Fetches all servers (paginated, 50 per page).
 */
export async function getAllServers(token) {
  let servers = [];
  let page = 1;
  while (true) {
    const data = await hetznerFetch(token, `/servers?per_page=50&page=${page}`);
    servers = servers.concat(data.servers);
    if (!data.meta?.pagination?.next_page) break;
    page = data.meta.pagination.next_page;
  }
  return servers;
}

/**
 * Fetches the full price list (server_types, image/snapshot price, backup percentage).
 * Prices are returned in the Hetzner project owner's account currency and VAT rate
 * (see pricing.currency in the response) - do not assume EUR.
 */
export async function getPricing(token) {
  const data = await hetznerFetch(token, "/pricing");
  return data.pricing;
}

/**
 * Returns the server's monthly price (net, VAT excluded) for its server_type + location.
 */
export function getServerMonthlyPriceNet(pricing, server) {
  const serverTypeName = server.server_type.name;
  const locationName = server.datacenter.location.name;

  const typePricing = pricing.server_types.find((t) => t.name === serverTypeName);
  if (!typePricing) {
    throw new Error(`No pricing found for server_type ${serverTypeName}`);
  }
  const locPricing = typePricing.prices.find((p) => p.location === locationName);
  if (!locPricing) {
    throw new Error(`No pricing found for location ${locationName} (server_type ${serverTypeName})`);
  }
  return parseFloat(locPricing.price_monthly.net);
}

/**
 * Returns the snapshot price per GB/month (net, VAT excluded).
 */
export function getSnapshotPricePerGbNet(pricing) {
  return parseFloat(pricing.image.price_per_gb_month.net);
}

/**
 * Returns the Backup feature's percentage surcharge (e.g. 20 = 20%).
 */
export function getBackupPercentage(pricing) {
  return parseFloat(pricing.server_backup.percentage);
}

/**
 * Returns the currency code prices are expressed in (e.g. "EUR", "USD"),
 * based on the Hetzner project owner's account settings.
 */
export function getCurrency(pricing) {
  return pricing.currency;
}

/**
 * Creates a snapshot of a server and waits for the action to complete.
 * Returns the finished image object (including image_size).
 */
export async function createSnapshotAndWait(token, serverId, description) {
  const res = await hetznerFetch(token, `/servers/${serverId}/actions/create_image`, {
    method: "POST",
    body: JSON.stringify({ type: "snapshot", description }),
  });

  const imageId = res.image.id;
  await waitForAction(token, res.action.id);

  // image_size may not be ready immediately after compression finishes,
  // so fetch a fresh copy of the image
  const image = await hetznerFetch(token, `/images/${imageId}`);
  return image.image;
}

export async function waitForAction(token, actionId, { pollMs = 3000, timeoutMs = 15 * 60 * 1000 } = {}) {
  const start = Date.now();
  while (true) {
    const data = await hetznerFetch(token, `/actions/${actionId}`);
    const status = data.action.status;
    if (status === "success") return data.action;
    if (status === "error") {
      throw new Error(`Hetzner action ${actionId} failed: ${JSON.stringify(data.action.error)}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Hetzner action ${actionId} timed out`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export async function deleteImage(token, imageId) {
  await hetznerFetch(token, `/images/${imageId}`, { method: "DELETE" });
}

export async function enableBackup(token, serverId) {
  const res = await hetznerFetch(token, `/servers/${serverId}/actions/enable_backup`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  await waitForAction(token, res.action.id);
}

/**
 * A server has backup_window != null if the Backup feature is already enabled.
 */
export function isBackupEnabled(server) {
  return !!server.backup_window;
}
