<div align="center">

# AxtroModerationBot

**A premium, enterprise-grade Discord moderation & utility bot**

Built with **Discord.js v14** and **MongoDB** — persistent warning escalation, multi-layered sliding window anti-nuke protection, dynamic TTL AutoMod, full ticket lifecycle, and an interactive appeals system.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0.en.html)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

</div>

---

## ⚡ Key Systems & Logics

### 🛡️ Multi-Layered Anti-Nuke Engine (Sliding Windows)
* **Layer 1 (Burst Fast Nuke)**:
  * **Channel Deletions**: $\ge 3$ deletions in 10s $\rightarrow$ Instant Role Strip & Punishment.
  * **Channel Creations**: $\ge 5$ creations in 10s $\rightarrow$ Instant Role Strip & Creation Cleanup.
* **Layer 2 (Medium Pacing)**:
  * **Channel Deletions**: $\ge 5$ deletions in 60s $\rightarrow$ Instant Trigger.
  * **Channel Creations**: $\ge 8$ creations in 60s $\rightarrow$ Instant Trigger.
* **Layer 3 (Sustained Slow Nuke Evasion Catch)**:
  * **Channel Deletions**: $\ge 10$ deletions in 5m (300s) $\rightarrow$ Instant Trigger.
  * **Channel Creations**: $\ge 15$ creations in 5m (300s) $\rightarrow$ Instant Trigger.
* **Layer 4 (Combined Create + Delete Chaos)**:
  * **Combined Actions**: $\ge 8$ total create/delete actions combined in 30s $\rightarrow$ Instant Trigger.
* **Creation Flood Auto-Cleanup**: Automatically auto-deletes spam-created channels created by the offender in the last 5 minutes upon neutralization.
* **Setup Mode (`/setup-mode`)**: Admins can toggle Setup Mode (e.g. `/setup-mode on duration:30m`) to raise Anti-Nuke threshold limits by **5x** during intentional server restructuring without false positives.

### 🔨 Persistent Warning Escalation (MongoDB)
* **Point Accumulation (1-5 Points)**: Warnings accumulate weighted points based on infraction severity (Minor = 1 pt, Severe = 2 pts).
* **Automated Escalation Tiers**:
  * **2 Points**: Automatic **1-Day Timeout**.
  * **3 Points**: Automatic **6-Hour Timeout**.
  * **4 Points**: Automatic **3-Day Timeout**.
  * **5 Points**: Automatic **28-Day Timeout** + **1 Strike Flag** (warning counter resets to 0/5).
* **Strike-to-Ban System**: Reaching 5 points a second time (**2 Strike Flags**) triggers an **Automatic Permanent Ban**.
* **14-Day Warning Decay**: Active warnings automatically decay by -1 point after 14 days without new infractions via a daily cron schedule.

### 📬 Interactive Appeals Portal (`/appeal`)
* **DM & Guild Support**: Users can run `/appeal` in Direct Messages or in server channels.
* **Interactive Request Embed**: Renders user punishment details, active warning points, case date, and original reason.
* **Modal Explanation Form**: Users click **`[ 📝 Submit Explanation ]`** to type their appeal in a modal text box.
* **Dedicated Staff Review Channel**: Appeals post directly to the designated staff appeals channel if configured.
* **In-Place Embed Updates**: Staff click **`[ ✅ Approve Appeal ]`** or **`[ ❌ Reject Appeal ]`** to resolve the appeal in place.
* **Multi-Model Cleanup**: Approving an appeal automatically lifts timeouts, deactivates active warnings, clears AutoMod trackers, and unbans users.

### 🔍 Dynamic TTL AutoMod Engine
* **Restart-Proof Tracking**: Uses MongoDB `{ expireAfterSeconds: 0 }` TTL indexes to persist spam and invite link rate-limit state across bot reboots.

---

## ⚙️ Commands

<details>
<summary><b>General & Appeals</b></summary>

| Command | Description |
|---|---|
| `/start` | Show basic bot information |
| `/appeal` | Request an appeal for an active warning, timeout, or ban (Works in DM & Guilds) |
| `/status` | Advanced system status: CPU load, RAM, Mongo state, config (Admin only) |
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
| `/setup-mode` | Toggle server Setup Mode (`on`, `off`, `status`) to raise thresholds by 5x during server building |
| `/automod` | Manage link, invite, caps, mention, and emoji filters |
| `/profanity` | Upload, clear, list, or modify custom profanity lists |
| `/antinuke-config` | Configure anti-nuke thresholds and actions |
| `/antinuke-enable` | Enable anti-nuke protection |
| `/antinuke-disable` | Disable anti-nuke protection |
| `/antinuke-status` | Check current anti-nuke status and logs |
| `/antinuke-whitelist` | Whitelist trusted members from anti-nuke actions |
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
| `/ticket panel` | Post, edit, list (with auto-pruning), or delete ticket panels |
| `/welcome setup` | Configure the welcome channel and auto-roles |
| `/welcome toggle` | Turn the welcome greeting system on or off |
| `/welcome message` | Customize the welcome message template (supports `{user}`, `{username}`, `{server}`, `{membercount}`, `{rules}`) |
| `/welcome image` | Upload an image attachment or set a custom welcome template image URL |
| `/welcome preview` | Preview the current welcome card and embed |

</details>

<details>
<summary><b>Giveaways & Utilities</b></summary>

| Command | Description |
|---|---|
| `/giveaway setup` | Open the interactive modal to quickly create a giveaway |
| `/giveaway start` | Launch a giveaway with custom parameters (prize, duration, requirements) |
| `/giveaway end` | Force-end a running giveaway early |
| `/giveaway reroll` | Draw new winners for a completed giveaway |
| `/giveaway edit` | Modify prize, winners, or duration of an active giveaway |
| `/giveaway list` | Display active giveaways (auto-prunes deleted messages) |
| `/giveaway delete` | Cancel a giveaway and delete its message immediately |
| `/giveaway pause` / `/giveaway resume` | Pause or resume countdown schedules |
| `/giveaway stats` | Show statistics of a giveaway or check user participation history |
| `/giveaway template save` | Save entry requirements as a template preset |
| `/giveaway template delete` | Remove a template preset |
| `/giveaway template list` | List all saved templates in the guild |
| `/restart` | Reboot the bot and clear in-memory caches (Owner Only) |

</details>

---

## 📁 Environment Variables

### Required Variables

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Discord Bot Token from the Developer Portal |
| `CLIENT_ID` | Application Client ID |
| `GUILD_ID` | Main Discord Server ID (used for instant command registration) |
| `MONGO_URI` | MongoDB connection string (stores logs, cases, warnings, and configs) |
| `OWNER_ID` | Discord User ID of primary bot owner (bypasses bot permissions) |

### Optional Variables

| Variable | Description | Default |
|---|---|---|
| `LOG_LEVEL` | Console log verbosity level (`info`, `debug`, `warn`) | `info` |
| `ALERT_CHANNEL_ID` | Channel ID to receive security & Anti-Nuke alert embeds | — |
| `ALERT_USER_IDS` | Comma-separated User IDs to ping on Anti-Nuke alerts | — |
| `APPEAL_CHANNEL_ID` | Dedicated channel ID for staff to review user appeals | — |
| `GROQ_API_KEY` | API Key required for `/ask` AI chatbot integration | — |
| `BRANDING_NAME` | Custom bot title shown in embeds | `Axtro Systems` |
| `BRANDING_FOOTER` | Custom embed footer text | `Axtro Systems` |
| `LOGO_URL` | Direct HTTPS image link used as embed logo | — |
| `WELCOME_TEMPLATE` | Default welcome message template (supports `{user}`, `{username}`, `{server}`, `{membercount}`, `{rules}`) | — |
| `WELCOME_IMAGE_URL` | Default background image template URL for welcome card embeds | — |

---

## 🚀 Deployment

### Render
- **Build Command:** `npm install`
- **Start Command:** `node src/index.js`

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DevAstrro/DiscordModBot)

### VPS / Self-Hosted
```bash
git clone https://github.com/Axtro-Systems/AxtroModerationBot.git
cd AxtroModerationBot
npm install
cp .env.example .env   # populate environment variables
npm start
```

---

## 👑 Credits

- Built with [discord.js v14](https://github.com/discordjs/discord.js) and [Mongoose](https://mongoosejs.com)
- Developed by **Axtro Systems**

## 📄 License

Licensed under the [GNU AGPL v3.0](https://github.com/DevAstrro/DiscordModBot/blob/main/LICENSE).
