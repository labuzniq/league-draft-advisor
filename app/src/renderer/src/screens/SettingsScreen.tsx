import { useEffect, useState } from "react";
import { MODELS } from "../../../shared/models";
import type { AppApi, Settings } from "../../../shared/types";
import { ApiKeyForm } from "./Setup";

export function SettingsScreen({ api, onClose }: { api: AppApi; onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>();

  const load = () => {
    void api.getSettings().then(setSettings);
  };
  useEffect(load, [api]);

  const change = (patch: { model?: string; showAll?: boolean }) => {
    void api.setSettings(patch).then(setSettings);
  };

  return (
    <main className="settings">
      <header className="settings-header">
        <h2>Settings</h2>
        <button onClick={onClose}>Back</button>
      </header>
      {settings && (
        <>
          <p>API key: {settings.hasApiKey ? "saved" : "not saved"}</p>
          <ApiKeyForm setApiKey={api.setApiKey} onSaved={load} />
          <label className="field">
            Model
            <select value={settings.model} onChange={(event) => change({ model: event.target.value })}>
              {MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.showAll} onChange={(event) => change({ showAll: event.target.checked })} />
            Show all champions
          </label>
        </>
      )}
    </main>
  );
}
