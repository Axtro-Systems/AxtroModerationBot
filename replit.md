# AxtroMod

A Discord moderation bot built with discord.js v14 and MongoDB.

## Stack

- **Runtime:** Node.js (ESM)
- **Discord:** discord.js v14
- **Database:** MongoDB via Mongoose
- **Scheduler:** node-cron
- **Logging:** Winston

## How to run

```
npm start
```

The workflow `Start application` runs `npm start` automatically. The bot connects to MongoDB, loads all commands and events, deploys slash commands to the configured guild, and starts listening.

## Required secrets

| Secret | Description |
|--------|-------------|
| `BOT_TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application/client ID |
| `MONGO_URI` | MongoDB connection string |
| `GUILD_ID` | Discord server ID (for guild-scoped slash command deployment) |
| `OWNER_ID` | Bot owner's Discord user ID |

## Features

- Moderation: warn, mute, kick, ban, tempban, softban, purge, lock, lockdown
- Anti-Nuke protection with auto-restore
- Anti-Raid protection
- Auto-moderation (spam, invites, links, caps, mentions, emojis)
- Server backup/restore
- Welcome system with customizable messages and auto-role
- Ticket system with buttons, transcripts, and claiming

## Project structure

```
src/
  index.js          # Entry point — starts bot and schedules cron jobs
  config.js         # Env var validation and config object
  mongo.js          # MongoDB connection
  commands/         # Slash commands grouped by category
  events/           # Discord gateway event handlers
  handlers/         # Command, event, and ticket handlers
  models/           # Mongoose schemas
  utils/            # Logger, backup utilities, etc.
scripts/            # Utility scripts
```

## User preferences

- Keep the existing project structure and stack.
