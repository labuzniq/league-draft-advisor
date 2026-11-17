# Draft Advisor

Draft Advisor is a desktop app for League of Legends. It watches your champion select (the ban and pick phase before a game). It then suggests champions to pick, using the Claude AI (Artificial Intelligence) model.

## What you need

- League of Legends, installed on the same computer.
- A Claude API (Application Programming Interface) key. You can create one at [platform.claude.com](https://platform.claude.com). If you have a Claude Max plan, it includes monthly API credits that you can use for this app.
- Node.js 24 and npm, if you want to run or build the app from the source code.

## Run in development

```
npm ci
npm run dev -w app
```

The app opens in a window. On first start it asks for your Claude API key.

## Run the tests

```
npm test
npm run typecheck
npm run lint
```

## Build an installer

On your own computer:

```
npm ci
npm run dist -w app
```

The installer is written to `app/release/`. You get a `.dmg` file on macOS and an `.exe` file on Windows. You can only build for the system you are on.

With GitHub: open the Actions tab, choose "Build installers", and press "Run workflow". The workflow builds both installers. When it ends, download them from the "Artifacts" section of the run. They are kept for a limited time.

Installers are not published as releases and there is no public download page. Share the files by hand with the people you want to use the app. The app does not update itself. Send a new installer when there is a new version.

## Statistics job

The statistics job collects ranked match data from the Riot API (Application Programming Interface). It counts champion picks, wins and bans, and builds two files: `current.json` for the newest patch and `previous.json` for the patch before it. The files hold champion numbers only.

The job runs every day at 03:00 UTC (Coordinated Universal Time) in GitHub Actions. It runs for up to 330 minutes. Each run takes a new sample of players and closes its time window, even when it stops at the time limit. The next run starts where the last one ended.

The files are published on a GitHub release named `stats`:

- https://github.com/labuzniq/league-draft-advisor/releases/download/stats/current.json
- https://github.com/labuzniq/league-draft-advisor/releases/download/stats/previous.json

The `stats` release holds these two data files only. No installers are published there.

### Riot API key

1. Sign in at [developer.riotgames.com](https://developer.riotgames.com) with your Riot account.
2. Register a personal API key for this project.
3. In GitHub, open `Settings > Secrets and variables > Actions` and add a secret named `RIOT_API_KEY` with the key as its value.

The job reads the key only from the `RIOT_API_KEY` environment variable. It never writes the key or player IDs to a file or a log.

### Start a run by hand

When the workflow is on the main branch, you can start a short test run of 5 minutes:

```
gh workflow run stats.yml -f run_minutes=5
```

### Scheduled runs can stop

GitHub turns scheduled jobs off after 60 days without activity in the repository. If that happens, open the Actions tab and enable the workflow again.

## Windows warning

The installers are not signed with a code signing certificate. Windows may show a blue "Windows protected your PC" window (SmartScreen). Choose "More info", then "Run anyway". Only do this for an installer you got from someone you trust.

On macOS, the first start of an unsigned app may also be blocked. Open the app with a right click and choose "Open".

## Check it against the real League client

See [docs/real-client-check.md](docs/real-client-check.md).

## Not endorsed by Riot Games

Draft Advisor is not endorsed by Riot Games. It only reads data from the League client on your computer. It does not change the game and does not send anything to the League client.
