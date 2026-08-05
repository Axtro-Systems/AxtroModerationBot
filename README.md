<div align="center">

<img src="src/AxtroLogo.png" alt="Axtro Systems" width="220">

# AxtroModerationBot

**A full-featured Discord moderation & utility bot**

Built with **Discord.js v14** and **MongoDB** — persistent warning escalation, layered anti-nuke protection, TTL-based AutoMod, a complete ticket system, and an interactive appeals flow.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.en.html)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

</div>

---

## Key Systems

### Anti-Nuke Protection (Layered Detection)

Detection runs across multiple time windows so both fast attacks and slower, evasive ones get caught.

| Layer | Trigger | Window |
|---|---|---|
| 1 — Burst | 3+ channel deletions | 10s |
| 1 — Burst | 5+ channel creations | 10s |
| 2 — Medium | 5+ channel deletions | 60s |
| 2 — Medium | 8+ channel creations | 60s |
| 3 — Sustained | 10+ channel deletions | 5 min |
| 3 — Sustained | 15+ channel creations | 5 min |
| 4 — Combined | 8+ create/delete actions total | 30s |

Any triggered layer strips the offending member's roles and applies the configured punishment. Layers 1 and 2 also clean up any channels the offender created during the flood.

**Setup Mode** (`/setup-mode on duration:30m`) temporarily raises all thresholds by 5x, so staff can restructure a server without tripping false positives.

### Warning Escalation (Persistent, MongoDB-backed)

Warnings carry a point value based on severity (minor = 1 pt, severe = 2 pts) and accumulate per member. Escalation is automatic:

| Points | Action |
|---|---|
| 2 | 1-day timeout |
| 3 | 6-hour timeout |
| 4 | 3-day timeout |
| 5 | 28-day timeout + 1 strike, points reset to 0 |
| 5 (again, 2nd strike) | Permanent ban |

Warnings decay by -1 point after 14 days without a new infraction (checked daily).

### Appeals (`/appeal`)

- Works in both DMs and server channels.
- Shows the member their punishment details, current points, case date, and reason.
- Member submits an explanation via a modal form.
- Staff review and resolve appeals directly from the embed (Approve / Reject buttons), posted to a dedicated staff channel if one is configured.
- Approving an appeal automatically lifts the timeout, deactivates the related warning, clears AutoMod tracking, and unbans if applicable.

### AutoMod

Uses MongoDB TTL indexes (`expireAfterSeconds: 0`) to track spam and invite-link rate limits, so state survives bot restarts.

---

## Commands

<details>
<summary><b>General & Appeals</b></summary>

| Command | Description |
|---|---|
| `/start` | Show basic bot information |
| `/appeal` | Request an appeal for an active warning, timeout, or ban (DM or server) |
| `/status` | System status: CPU, RAM, MongoDB connection, config (admin only) |
| `/ask` | Query the AI chat integration |
| `/avatar` | Fetch a user's avatar |
| `/channelinfo` | Get details of a channel |
| `/roleinfo` | Get details of a role |
| `/serverinfo` | Get details of the server |
| `/userinfo`, `/whois` | Get details of a user |

</details>

<details>
<summary><b>AutoMod & Anti-Nuke</b></summary>

| Command | Description |
|---|---|
| `/setup-mode` | Toggle Setup Mode (`on`, `off`, `status`) — raises thresholds by 5x while building |
| `/automod` | Manage link, invite, caps, mention, and emoji filters |
| `/profanity` | Upload, clear, list, or edit custom profanity lists |
| `/antinuke-config` | Configure anti-nuke thresholds and actions |
| `/antinuke-enable` | Enable anti-nuke protection |
| `/antinuke-disable` | Disable anti-nuke protection |
| `/antinuke-status` | Check current anti-nuke status and logs |
| `/antinuke-whitelist` | Exempt trusted members from anti-nuke actions |
| `/raid` | Configure anti-raid controls |

</details>

<details>
<summary><b>Moderation</b></summary>

| Command | Description |
|---|---|
| `/warn` | Issue a weighted warning (minor/severe) to a member |
| `/warnings` | List active warnings for a member |
| `/delwarn` | Delete a specific warning by ID |
| `/clearwarnings` | Clear all warnings for a member |
| `/history` | View moderation history |
| `/note` | Attach a note to a member |
| `/cases` | List case indices |
| `/case` | Inspect a specific warning or case ID |
| `/mute` / `/unmute` | Mute / unmute a member |
| `/kick` | Kick a member |
| `/ban` / `/unban` | Ban / unban a member |
| `/tempban` | Temporarily ban a member |
| `/softban` | Kick a member and clear their messages |
| `/lock` / `/unlock` | Lock / unlock a channel |
| `/lockdown` / `/unlockdown` | Lock down / lift lockdown on major channels |
| `/purge` | Bulk delete messages in a channel |
| `/slowmode` | Set a channel's slowmode cooldown |
| `/modlog` | Configure the logging channel for moderator actions |

</details>

<details>
<summary><b>Tickets & Welcomer</b></summary>

| Command | Description |
|---|---|
| `/ticket setup` | Walk through the ticket system setup wizard |
| `/ticket panel` | Post, edit, list (auto-pruning), or delete ticket panels |
| `/welcome setup` | Configure the welcome channel and auto-roles |
| `/welcome toggle` | Turn the welcome greeting on or off |
| `/welcome message` | Customize the welcome message (`{user}`, `{username}`, `{server}`, `{membercount}`, `{rules}`) |
| `/welcome image` | Upload an attachment or set a welcome card image URL |
| `/welcome preview` | Preview the current welcome card and embed |

</details>

<details>
<summary><b>Giveaways & Utilities</b></summary>

| Command | Description |
|---|---|
| `/giveaway setup` | Open a modal to quickly create a giveaway |
| `/giveaway start` | Launch a giveaway with custom parameters (prize, duration, requirements) |
| `/giveaway end` | Force-end a running giveaway early |
| `/giveaway reroll` | Draw new winners for a completed giveaway |
| `/giveaway edit` | Modify prize, winners, or duration of an active giveaway |
| `/giveaway list` | Display active giveaways (auto-prunes deleted messages) |
| `/giveaway delete` | Cancel a giveaway and delete its message |
| `/giveaway pause` / `/giveaway resume` | Pause or resume a giveaway's countdown |
| `/giveaway stats` | Show giveaway stats or a user's participation history |
| `/giveaway template save` | Save entry requirements as a reusable template |
| `/giveaway template delete` | Remove a saved template |
| `/giveaway template list` | List all saved templates in the guild |
| `/restart` | Reboot the bot and clear in-memory caches (owner only) |

</details>

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Bot token from the Discord Developer Portal |
| `CLIENT_ID` | Application client ID |
| `GUILD_ID` | Main server ID — used to register slash commands instantly during development |
| `MONGO_URI` | MongoDB connection string (stores logs, cases, warnings, config) |
| `OWNER_ID` | Discord user ID of the primary bot owner — bypasses permission checks |

### Optional

| Variable | Description | Default |
|---|---|---|
| `LOG_LEVEL` | Console log verbosity (`info`, `debug`, `warn`) | `info` |
| `ALERT_CHANNEL_ID` | Channel for security & anti-nuke alerts | — |
| `ALERT_USER_IDS` | Comma-separated user IDs to ping on anti-nuke alerts | — |
| `APPEAL_CHANNEL_ID` | Channel where staff review appeals | — |
| `GROQ_API_KEY` | API key for the `/ask` AI integration | — |
| `BRANDING_NAME` | Bot name shown in embeds | `Axtro Systems` |
| `BRANDING_FOOTER` | Embed footer text | `Axtro Systems` |
| `LOGO_URL` | HTTPS image URL used as the embed logo | — |
| `WELCOME_TEMPLATE` | Default welcome message (`{user}`, `{username}`, `{server}`, `{membercount}`, `{rules}`) | — |
| `WELCOME_IMAGE_URL` | Default welcome card background image URL | — |

> Note: `GROQ_API_KEY` is required for `/ask` to function — the command will error out without it. `ALERT_CHANNEL_ID` and `APPEAL_CHANNEL_ID` are optional but recommended, since anti-nuke alerts and appeals have nowhere to post without them.

---

## Deployment

### VPS / Self-Hosted (recommended)
```bash
git clone https://github.com/Axtro-Systems/AxtroModerationBot.git
cd AxtroModerationBot
npm install
cp .env.example .env   # fill in your environment variables
npm start
```
For production, run the bot under a process manager like `pm2` or a `systemd` service so it restarts automatically on crash or reboot.

### Render
- **Build command:** `npm install`
- **Start command:** `node src/index.js`

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Axtro-Systems/AxtroModerationBot)

---

## Credits

- Built with [discord.js v14](https://github.com/discordjs/discord.js) and [Mongoose](https://mongoosejs.com)
- Developed by **Axtro Systems**

## License

Licensed under the [GNU AGPL v3.0](https://github.com/Axtro-Systems/AxtroModerationBot/blob/main/LICENSE).
