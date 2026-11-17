import type { AppView } from "../../../shared/types";

const MESSAGES = {
  "no-data": "Champion data could not be loaded. Check your internet connection.",
  "no-client": "Waiting for League of Legends…",
  "no-champ-select": "Waiting for champion select…",
};

export function Waiting({ reason }: { reason: Extract<AppView, { screen: "waiting" }>["reason"] }) {
  return (
    <main className="waiting">
      <p>{MESSAGES[reason]}</p>
    </main>
  );
}
