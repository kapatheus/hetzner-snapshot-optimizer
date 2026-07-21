const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

export function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

export async function notify(message, { isError = false } = {}) {
  log(isError ? "ERROR:" : "INFO:", message);

  if (!WEBHOOK_URL) return;

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: message,
        username: "Hetzner Snapshot Optimizer",
      }),
    });
  } catch (err) {
    log("Failed to send Discord webhook:", err.message);
  }
}
