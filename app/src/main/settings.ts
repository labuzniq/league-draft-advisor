import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MODEL, MODELS } from "../shared/models";
import type { Settings } from "../shared/types";

export interface KeyCipher { encrypt(text: string): Buffer; decrypt(data: Buffer): string }

interface StoredSettings { model: string; showAll: boolean; encryptedKey?: string }

const DEFAULTS: StoredSettings = { model: DEFAULT_MODEL, showAll: false };

export class SettingsStore {
  constructor(private readonly filePath: string, private readonly cipher: KeyCipher) {}

  get(): Settings {
    const { model, showAll } = this.read();
    return { model, showAll, hasApiKey: this.getApiKey() !== undefined };
  }

  set(patch: { model?: string; showAll?: boolean }): Settings {
    if (patch.model !== undefined && !(MODELS as readonly string[]).includes(patch.model)) {
      throw new Error(`Unknown model: ${patch.model}`);
    }
    const stored = this.read();
    this.write({
      ...stored,
      model: patch.model ?? stored.model,
      showAll: patch.showAll ?? stored.showAll,
    });
    return this.get();
  }

  setApiKey(key: string): void {
    const { model, showAll } = this.read();
    const trimmed = key.trim();
    this.write({ model, showAll, encryptedKey: trimmed ? this.cipher.encrypt(trimmed).toString("base64") : undefined });
  }

  getApiKey(): string | undefined {
    const { encryptedKey } = this.read();
    if (!encryptedKey) return undefined;
    try {
      return this.cipher.decrypt(Buffer.from(encryptedKey, "base64"));
    } catch {
      return undefined;
    }
  }

  private read(): StoredSettings {
    try {
      const data = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredSettings>;
      return {
        model: (MODELS as readonly string[]).includes(data.model ?? "") ? data.model! : DEFAULTS.model,
        showAll: typeof data.showAll === "boolean" ? data.showAll : DEFAULTS.showAll,
        encryptedKey: typeof data.encryptedKey === "string" ? data.encryptedKey : undefined,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private write(stored: StoredSettings): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(stored, null, 2));
  }
}
