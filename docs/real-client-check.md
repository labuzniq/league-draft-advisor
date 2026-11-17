# Real client check

The app was built against a fake League client. This check runs it once against the real League of Legends client. It also saves one champion select to a file. We use that file to fix any field the real client names differently.

You need a Windows PC with League of Legends installed. You need about 30 minutes, including one ranked champion select.

## Before you start

1. Download the Windows installer from the build workflow (GitHub Actions) and install the app.
2. Open the app once, as normal. Enter your Anthropic API (Application Programming Interface) key in the setup screen. Close the app again.

## Record a champion select

1. Close the app if it is open.
2. Open the Start menu and type `cmd`. Open Command Prompt.
3. Start the app with the `--record` flag. Use the path where the installer put it. For example:

   ```
   "%LOCALAPPDATA%\Programs\@ldaapp\Draft Advisor.exe" --record
   ```

   If that path does not exist, find the app in the Start menu, right-click it, choose "Open file location", and use that path instead.
4. Leave the app window open. Start the League of Legends client.
5. Queue for one ranked game and play through the whole champion select (the ban and pick phase). Stay in the window until the game loads or the lobby closes.
6. When champion select ends, the app saves a file called `recording-<date and time>.json` on your Desktop. If you close the app in the middle of a champion select, it saves the file then.

## Check these four things

1. The app left the waiting screen by itself. You should not need to click anything.
2. The picks and bans in the app window matched the League client.
3. Suggestions arrived in time. They should appear while it is still your turn to pick.
4. The recording file was written to your Desktop.

Write down what you saw for each one, also when it was wrong.

## What the waiting messages mean

- **Waiting for League of Legends…** The app cannot find the League client. Start the League client and wait a few seconds. If the client is already open, close the app and start it again with `--record`. Then tell us, because the app may be looking in the wrong place for the client.
- **Found the League client but could not connect to it. Trying again…** The app found the League client on your PC, but the client did not answer, or its first answers failed. The app keeps trying every few seconds. If this stays on screen for more than a minute, close the app and send us the recording file if there is one. Tell us that this message was the one on screen.
- **Waiting for champion select…** The app is connected to the League client. It is waiting for you to enter champion select. Queue for a game. If you are already in champion select and this stays on screen, tell us.
- **Champion select could not be read. The League client may have changed.** The League client sent data the app does not understand. Keep playing the champion select to the end so the recording is saved, and send us the file. This one is the most useful for us.
- **Champion data could not be loaded. Check your internet connection.** The app could not download the champion list. Check that the PC is online. The app tries again by itself every few seconds.

## What is in the recording file

The file holds champion numbers and field names only. It does not hold player names, summoner names, or account IDs (identifiers). The app removes them before saving. The file also has a `sessionKeyPaths` list. It shows the names of all fields the League client sent, and never their values. Keys that look like an ID are written as `*`. You can open the file in Notepad and look at the whole file, also the `sessionKeyPaths` list, before you send it.

If League was restarted in the middle of champion select, the file only holds the part after the restart.

## Send the file back

Send us the `recording-<date and time>.json` file from your Desktop, together with your notes on the four checks. The file will be added to a public repository, which is why it holds no personal data.
