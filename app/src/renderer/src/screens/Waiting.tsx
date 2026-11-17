import type { AppView } from "../../../shared/types";

const MESSAGES = {
  "no-data": "Champion data could not be loaded. Check your internet connection.",
  "no-client": "Waiting for League of Legends…",
  "client-error": "Found the League client but could not connect to it. Trying again…",
  "no-champ-select": "Waiting for champion select…",
  unreadable: "Champion select could not be read. The League client may have changed.",
};

export function Waiting({ reason }: { reason: Extract<AppView, { screen: "waiting" }>["reason"] }) {
  return (
    <main className="waiting">
      <p>{MESSAGES[reason]}</p>
    </main>
  );
}
