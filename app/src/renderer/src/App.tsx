import { useEffect, useState } from "react";
import type { AppApi, AppView } from "../../shared/types";
import { Draft } from "./screens/Draft";
import { SettingsScreen } from "./screens/SettingsScreen";
import { Setup } from "./screens/Setup";
import { Waiting } from "./screens/Waiting";

declare global {
  interface Window {
    api: AppApi;
  }
}

const api = window.api;

function Screen({ view }: { view: AppView }) {
  switch (view.screen) {
    case "setup":
      return <Setup setApiKey={api.setApiKey} />;
    case "waiting":
      return <Waiting reason={view.reason} />;
    case "draft":
      return <Draft view={view} chooseRole={api.chooseRole} retry={api.retry} />;
  }
}

export function App() {
  const [view, setView] = useState<AppView>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => api.onView(setView), []);

  return (
    <div className="app">
      {!settingsOpen && (
        <button className="gear" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      )}
      {settingsOpen ? <SettingsScreen api={api} onClose={() => setSettingsOpen(false)} /> : view && <Screen view={view} />}
    </div>
  );
}
