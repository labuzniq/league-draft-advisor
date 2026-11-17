import { useState, type FormEvent } from "react";

export function ApiKeyForm({ setApiKey, onSaved }: { setApiKey: (key: string) => Promise<void>; onSaved?: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      await setApiKey(key);
      setKey("");
      onSaved?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <form className="key-form" onSubmit={save}>
      <label className="field">
        Claude API key
        <input type="password" value={key} onChange={(event) => setKey(event.target.value)} />
      </label>
      <button type="submit" disabled={key.trim() === ""}>
        Save
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function Setup({ setApiKey }: { setApiKey: (key: string) => Promise<void> }) {
  return (
    <main className="setup">
      <h2>Add your Claude API key</h2>
      <p>
        You can create a key at platform.claude.com. If you have a Max plan, it includes monthly credits you can use
        for this app.
      </p>
      <ApiKeyForm setApiKey={setApiKey} />
    </main>
  );
}
