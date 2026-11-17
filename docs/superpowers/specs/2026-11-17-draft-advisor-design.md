# League Draft Advisor: design

Date: 2026-11-17
Status: waiting for approval

## Intent and why

A desktop window that acts like a coach during champion select in League of
Legends ranked games. It watches the draft live and suggests what to pick.

The point is coach-style advice, not a win-rate table. A coach knows what is
strong this patch, which champions work well together, what the team is
missing (a tank, magic damage, early power), and whether to balance the team
or go all in on one plan. Statistics feed the advice, and an AI (Artificial
Intelligence) model does the reasoning on top.

It is built for Martin and 3 to 4 friends. It should not block growing later,
but nothing is built for scale now.

## Goals

- Show 1 to 5 suggested picks for the player's role, each with 1 to 2
  sentences on why it is good in this draft.
- Show a one-line "team read": what the team has and what it lacks.
- Update as picks happen. Target: the first suggestion is on screen within
  5 seconds of a locked pick, counting the grouping pause. The full answer
  is done within about 10 seconds.
- Base advice on three things: current patch statistics, champion and spell
  data, and the AI's reasoning about matchups and team fit.
- Run as a normal installed app on Windows. Also run on macOS, because
  development happens there.
- Each person pays for their own AI use with their own Claude API
  (Application Programming Interface) key.

## Non-goals (this version)

- In-game advice. It is in the backlog.
- Ban advice.
- Our own matchup or duo statistics (champion A against champion B).
  The AI covers matchups by reasoning.
- Rune, item, or summoner spell advice.
- Automatic actions in the client (hovering, locking in, banning).
- Automatic app updates.
- Overwolf packaging.

## Anti-goals (would make it a failure even if it works)

- A plain list sorted by win rate with no reasoning about the team.
- Advice that arrives after the pick timer ran out.
- Breaking Riot's rules in a way that puts accounts at risk.
- Showing or looking up other players' names or stats in champion select.

## Constraints

### Riot

- Riot's official API gives raw match data only. It has no win rates.
  Limits for a personal key: 20 requests per second and 100 requests per
  2 minutes, counted per region. Development keys stop working every
  24 hours, so the stats job needs a personal key.
- A personal key needs a product registered in the Riot Developer Portal.
  Only Martin can do this.
- The League client's local API, called LCU (League Client Update) API, is
  "not officially supported" for third-party apps. It has no official
  documentation and can change without notice. Other draft tools use it.
- Riot policy: apps must not "dictate player decisions". Offering several
  picks with reasons fits. Wording in the app stays as suggestions.
- Riot policy: in ranked solo/duo champion select, names of players outside
  your party must stay hidden. The app shows champions and roles only, never
  player names.
- Any app serving players should be registered with Riot, even if it only
  uses the LCU API. Needed before the app goes beyond the friend group.

### Anthropic

- Apps may not sign in with a Claude plan login on behalf of their users.
  The app uses API keys only.
- Max, Ultra and Team plans include monthly API credits ($100 on Max) that
  work with an API key. Pro plans do not.

### Time

- A pick turn lasts about 30 seconds. Advice must be on screen in a few
  seconds, and the first suggestion should appear before the full answer is
  done.

## Approaches considered

### Where the statistics come from

1. **Hybrid (chosen by Martin).** A small job downloads a sample of
   high-rank matches each patch and computes win, pick and ban rates per
   champion and role. The AI handles matchups and team fit.
   Small, legal, fits the "coach, not a table" goal.
2. **AI only.** No match downloads. Simplest, but the AI can miss what is
   strong in the current patch.
3. **Full own database, like Porofessor.** Real matchup numbers, but needs
   a server running all the time and millions of matches. Too heavy for a
   few people.

Dropped: scraping statistics websites. It breaks their terms and breaks
often.

### How the AI is paid for

1. **Each person's own API key (chosen, my call).** Allowed, free for Max
   plan holders through monthly credits, and the only route that still
   works if the app grows.
2. **Running each person's installed Claude Code in the background.** Works
   with Pro plans, but it is slower to start and is not allowed for an app
   offered to other users.

### App shell

1. **Plain desktop app with Electron and TypeScript (chosen, my call).**
   Normal installer, runs on Windows and macOS, official Anthropic SDK
   (Software Development Kit) for TypeScript, and Overwolf offers an
   Electron-based route if we move there later.
2. **Tauri.** Smaller app, but needs Rust, and there is no official
   Anthropic SDK for Rust.
3. **Overwolf native app.** Built-in game overlay tools, but Windows only
   and needs Overwolf and Riot approval before friends can install it.

## Design

Two parts live in one repository:

- **The app**: the installed desktop program.
- **The stats job**: a scheduled job that builds one statistics file.

### The app

Built with Electron and TypeScript. Pieces, each with one job:

**Client connector.** Finds the running League client, connects to its
local API, and listens for champion select changes. When no client is
running, it waits and retries. It turns the client's raw session data into
a simple draft state.

**Draft state.** One plain object:

- the player's role
- ally picks, with role where known
- enemy picks
- bans
- whose turn it is, and whether the player has locked in
- champions the player owns, with how much they have played each

The client does not say which role each enemy plays. The app guesses enemy
roles from each champion's most common role in the stats file.

The assigned role exists only in queues with role selection. In other draft
queues the player picks their role from a dropdown in the window.

**Candidate filter.** Plain code, no AI. From all champions it keeps those
that:

- are played in the player's role (from the stats file)
- are not picked or banned
- the player owns, unless the "show all champions" switch is on

It ranks them by a mix of patch strength and how much the player plays
them, and keeps about 25. This keeps the AI request small and fast.

**Advisor.** Sends one request to Claude with:

- the draft state
- statistics for the candidates and for champions already picked
- short spell and kit data for the same champions
- fixed instructions on how a coach thinks: team needs, damage mix,
  frontline, engage, early or late power, combos between spells, counters

It asks for a structured answer:

- `teamRead`: one line
- `picks`: 1 to 5 items, each with a champion and a 1 to 2 sentence reason

Rules for calls:

- No requests during the ban phase. The first request starts when bans
  end.
- After that, a new request starts when a pick is locked, after a short
  pause so quick changes are grouped.
- The fixed part of the request (coach instructions, champion data for the
  candidates) is sent in a way that lets Anthropic's prompt caching reuse
  it, so repeat requests within one draft are cheaper and faster.
- A request still running for an older draft state is cancelled.
- The answer is streamed, so the first pick shows up early.
- An answer for a given draft state is kept, so the same state is never
  asked twice.
- No new requests after the player locks in.

Model: Claude Opus 5.5 (`claude-opus-5-5`) by default, at low effort for
speed. The model can be changed in settings. Uses the official
`@anthropic-ai/sdk` package.

Speed plan (decided by Martin): measure Opus 5.5 early in the build. If the
first suggestion takes more than 5 seconds, first make the request smaller
(fewer candidates, less spell text). If it is still too slow, the default
model becomes Claude Sonnet 5.5 (`claude-sonnet-5-5`). Opus 5.5 stays
available in settings.

Cost: a draft needs about 1 to 9 requests, 5 on average. Rough estimate on
Opus 5.5: 15 to 30 cents per draft. Not measured. Aim to stay under
25 cents per draft at the default model.

**Stats loader.** Downloads the current statistics file at start, keeps a
copy on disk, and uses the copy when offline.

**Champion data.** Champion names, roles, images and spell texts come from
Riot's Data Dragon (Riot's public file server for game data), downloaded per
patch and kept on disk.

**Window.** One screen during champion select:

```
┌ Draft Advisor ───────────── Patch 26.22 · You: Mid ┐
│ Allies:  Jarvan (Jungle) · Jinx (Bot) · ? · ?      │
│ Enemies: Ahri (Mid) · Leona (Support) · ?          │
│ Team read: no frontline yet, damage is all physical│
│                                                    │
│ 1. Orianna        52.1% win rate                   │
│    Her ball on Jarvan's dive is a ready-made combo.│
│    Safe into Ahri and adds magic damage.           │
│ 2. Galio          51.4% win rate                   │
│    Follows Jarvan's engage and gives a frontline.  │
│ 3. ...                                             │
└────────────────────────────────────────────────────┘
```

Other states:

- **Waiting**: no League client, or not in champion select.
- **Setup**: no API key yet. Explains where to get one.
- **Settings**: API key, model, "show all champions" switch.

**Settings storage.** The API key is stored with the operating system's
secure storage (Electron `safeStorage`). It never leaves the machine except
in requests to Anthropic.

**When things fail.**

- AI request fails or takes too long: the window shows the error in plain
  words and the candidate list ranked by statistics, without reasons, plus
  a retry button.
- Statistics file missing and no copy on disk: the app says so and the
  advisor runs without statistics, marked clearly in the window.

### The stats job

A script run once a day by GitHub Actions (free scheduled jobs on GitHub).

1. Gets a list of high-rank players from Riot's API.
2. Downloads their recent ranked matches from the current patch.
3. Skips matches it has already counted.
4. Adds to running totals per champion and role: games, wins, picks, bans.
5. Publishes one JSON (JavaScript Object Notation) file that the app
   downloads.

Details:

- Totals build up day by day within a patch and start fresh on a new patch.
- In the first days of a patch, numbers are thin. The file carries the game
  count per champion, and the previous patch's file stays available, so the
  app can lean on the old patch until the new one has enough games.
- Rough size: about 100 requests per 2 minutes gives around 15,000 matches
  per daily run per region, so about 200,000 matches over a two-week patch.
  This is an estimate, not measured. It is enough for champion and role
  rates, not for matchup numbers.
- "High rank" means Emerald and above. Regions: Europe West first. Both are
  settings of the job.
- The Riot key lives only in GitHub Actions secrets. Friends never need a
  Riot key.

### Testing

- **Recorded drafts.** Champion select sessions saved as files. A fake
  local client replays them, so the app can be built and tested on the Mac
  without a live game. The first files are written by hand from the known
  shape of the session data.
- **Real client check on Windows.** Martin plays on a Windows PC. Before
  any friend installs the app, Martin runs it there against the real
  client: it must find the client, follow one full champion select, and
  save that session with a small record command. The saved session then
  replaces the hand-written files. A real client check on macOS is not
  required.
- **Unit tests** for the draft state, the candidate filter and the
  statistics totals.
- **The advisor sits behind an interface**, so tests use a fake and never
  call the real API.
- Judging how good the advice is stays a manual check on a few saved drafts
  for now.

### Delivery

- Windows installer and macOS build, made by CI (Continuous Integration) on
  GitHub.
- No public download page (decided by Martin). The repository is public,
  so installers are not published as GitHub releases. Martin downloads the
  installer from the CI run and sends the file to friends himself.
- Builds are not code-signed at first, so Windows will show a warning on
  install. Acceptable for friends.

## Things only Martin can do

1. Register a personal product in the Riot Developer Portal and get a
   personal API key.
2. Add that key as a secret in the GitHub repository.
3. Create a Claude API key (and tell friends to do the same).
4. Run the real client check on the Windows PC and record one champion
   select session, once the record command exists.
5. Send the installer file to friends.

The app can be built and tested before steps 1, 2 and 4. The stats job
cannot produce real data before steps 1 and 2.

## Calls made by Claude (not decided by Martin)

- Electron and TypeScript, plain installer, not Overwolf.
- Each person brings their own Claude API key.
- Low effort setting for the model, and the 25 cent per draft aim.
- No requests during the ban phase.
- The 5 second target measures the first suggestion, pause included.
- Suggestions limited to owned champions by default, favoring ones the
  player plays a lot, with a switch to show all.
- About 25 candidates chosen by plain code before the AI is asked.
- Stats job on GitHub Actions, once a day, Emerald and above, Europe West.
- Statistics-only list shown when the AI request fails.
- Development on recorded drafts with a fake local client.
- No auto-update and no code signing in this version.

## Left to the builder

- Folder layout and build tooling.
- Where the statistics file is hosted (for example a GitHub release file or
  GitHub Pages) and how the job remembers which matches it has counted.
- Exact LCU endpoints and how the client is found on each operating system.
  These must be checked against a live client or a recorded session.
- The exact mix used to rank candidates.
- The wording of the coach instructions and how much spell text to send.
- The length of the pause before a request, and the timeout.
- Look and styling of the window beyond the sketch.

## Risks

- **Speed.** Whether Opus 5.5 at low effort answers within 5 seconds for
  this request size is not measured. Measure it early and follow the speed
  plan in the Advisor section.
- **Cost.** The 15 to 30 cents per draft figure is an estimate. Measure it
  together with speed.
- **LCU changes.** Riot can change the local API at any time. Keep all
  client-specific code inside the client connector.
- **Thin data early in a patch.** Covered by leaning on the previous patch.

## Backlog

- In-game advisor. Riot and Overwolf rules forbid notifications that tell
  the player what to do based on the live game state (their example:
  "go gank top lane"). This feature needs its own design and a rules check
  first.
- Ban advice.
- Matchup and duo statistics.
- Overwolf packaging, auto-update, code signing.
- Registering the app with Riot before sharing it more widely.
