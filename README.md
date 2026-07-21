# Hetzner Snapshot Optimizer

Takes Hetzner Cloud snapshots on a schedule, compares the cost against Hetzner's
Backup feature, and automatically enables Backup when it turns out to be cheaper.

## How it works

1. Fetches all servers and current pricing from the Hetzner API (`/pricing`).
2. Goes through servers that don't already have Backup enabled and aren't excluded.
3. Checks the server's own `interval-days` label to see if it's due for a snapshot -
   if not, skips it this run.
4. Takes a new snapshot, and prunes the oldest ones once the rotation limit is exceeded.
5. Calculates `rotation x average size(GB) x snapshot price/GB` vs `server price x backup %`.
6. If Backup is cheaper: sends a Discord + log notification, enables Backup via the API,
   and cleans up the snapshots the bot took (Backup now handles protection).
7. Servers that already have Backup enabled are automatically skipped on future runs.

All prices are net (VAT excluded), fetched live from Hetzner's `/pricing` endpoint,
so they stay accurate even if Hetzner changes prices. Prices (and the currency they're
shown in) follow your Hetzner project owner's account settings - the bot reads the
currency from the API response rather than assuming EUR, so it also works correctly
on USD-billed accounts.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `HETZNER_API_TOKEN`: a Hetzner Cloud project API token with **Read & Write**
     permissions (the bot creates/deletes images and enables Backup)
   - `DISCORD_WEBHOOK_URL`: webhook URL for notifications. **Optional** - leave it
     empty to only log to stdout (`docker logs`) without Discord notifications
   - `DEFAULT_ROTATION` / `DEFAULT_INTERVAL_DAYS`: defaults for servers that don't
     have their own labels
   - `CRON_SCHEDULE`: how often the bot checks servers (cron syntax, e.g.
     `0 3 * * *` = 03:00 daily - this is just the check frequency, not each
     server's own snapshot interval, see below)
   - `CRON_TIMEZONE`: which timezone `CRON_SCHEDULE` is interpreted in (default
     `Europe/Helsinki`, passed explicitly to node-cron rather than relying on the
     container's system time - only needs to be set once, `TZ` for the container
     is derived from it automatically in `docker-compose.yml`)

2. **Per-server settings are handled entirely through Hetzner labels** - no separate
   config file needed. In the Hetzner Console, open a server and go to its Labels
   section, then add:

   | Label | Meaning | Example |
   |---|---|---|
   | `snapshot-bot.rotation` | how many snapshots to keep | `7` |
   | `snapshot-bot.interval-days` | days between snapshots (decimals allowed) | `1`, `2`, `7` |
   | `snapshot-bot.enabled` | `false` = bot ignores this server entirely | `false` |
   | `snapshot-bot.price-override` | manual monthly price for legacy server types no longer listed in `/pricing` (see below) | `5.49` |

   The label box works as a key/value pair editor: type the key, then press Enter or
   type `=` to switch to the value part, then Enter again to confirm. You can also
   paste several labels at once, comma- or space-separated, e.g. pasting
   `snapshot-bot.rotation=7,snapshot-bot.interval-days=1` creates both labels in one go.

   If a server has no `snapshot-bot.rotation` / `snapshot-bot.interval-days` label,
   it falls back to `.env`'s `DEFAULT_ROTATION` / `DEFAULT_INTERVAL_DAYS`. The bot
   itself runs on the `CRON_SCHEDULE` cadence (e.g. daily), but only takes a snapshot
   once that server's own `interval-days` has elapsed since its last one - so
   different servers can run on completely different schedules even though the bot
   checks in more often.

   Example for 10 servers with different needs:
   - Servers 1-5: `snapshot-bot.interval-days=1`, `snapshot-bot.rotation=7`
   - Servers 6-8: `snapshot-bot.interval-days=2`, `snapshot-bot.rotation=4`
   - Servers 9-10: `snapshot-bot.interval-days=7`, `snapshot-bot.rotation=4`

   (Total across all 10 in this example: 5x7 + 3x4 + 2x4 = 35+12+8 = 55 images -
   remember to check this sum against Hetzner's project image limit, see below.)

3. Adjust the `docker-compose.yml` volume path if you want state stored somewhere
   other than `./data`.
4. Deploy with Docker Compose (or your container platform of choice).

## Notes before you deploy

- **Automatically enabling Backup is irreversible** without a manual step in the bot -
  it immediately starts billing 20% of the server price. If you'd rather confirm by
  hand first, remove the automatic `enableBackup(...)` call in `index.js` and keep
  only the Discord notification, then enable Backup yourself from the Hetzner Console
  after seeing the alert.
- Hetzner has a **default limit of 10 images per project**. This limit applies to the
  whole project, not per server - so add up the `rotation` values across *all* servers
  the bot manages (e.g. 10 servers x `rotation=1` = 10, right at the limit; 10 servers
  x `rotation=7` = 70, far over it). If the sum exceeds 10, either lower your rotation
  counts or ask Hetzner support to raise the project's image limit.
- The first run only compares cost using a single snapshot's size (one data point),
  since there's no history yet. Accuracy improves after a few runs once the rotation
  window fills up.
- `create_image` may briefly pause a running server **unless** live snapshots are
  supported for that setup; Hetzner generally takes live snapshots without downtime
  nowadays, but double check for your server type if any interruption is critical
  (e.g. a game server with players online).
- Prices and currency come directly from the Hetzner API and reflect your account's
  billing currency and VAT rate - no assumptions are hardcoded.
- **Legacy / discontinued server types**: Hetzner's `/pricing` endpoint only lists
  server types currently on sale. If you have older servers on grandfathered plans
  (e.g. an old `cx21` no longer offered to new customers), the bot can't look up
  their price automatically and will log an error for them instead of silently
  guessing. Use `snapshot-bot.price-override` to give the bot that server's actual
  monthly price by hand. **Important:** enter the NET price (VAT excluded), matching
  what `/pricing` returns for every other server - not the VAT-inclusive price you
  might see as a consumer in the Hetzner Console. If your account is VAT-registered
  (net prices shown by default), you can usually copy the price straight from the
  console; otherwise divide the displayed price by `(1 + VAT rate / 100)`.

## Development / manual run

```bash
npm install
cp .env.example .env   # fill in values
node --env-file=.env src/index.js --once
```

## License

MIT
