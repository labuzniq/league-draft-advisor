import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { DEFAULT_MODEL, MODELS } from "./advisor/advisor";
import { SettingsStore, type KeyCipher } from "./settings";

const reverse = (text: string) => [...text].reverse().join("");
const cipher: KeyCipher = {
  encrypt: (text) => Buffer.from(reverse(text)),
  decrypt: (data) => reverse(data.toString()),
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lda-settings-"));
  file = join(dir, "nested", "settings.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("returns the defaults when there is no file", () => {
  expect(new SettingsStore(file, cipher).get()).toEqual({ model: DEFAULT_MODEL, showAll: false, hasApiKey: false });
});

test("returns the defaults when the file is not valid JSON", () => {
  new SettingsStore(file, cipher).set({ showAll: true });
  writeFileSync(file, "{nope");
  expect(new SettingsStore(file, cipher).get()).toEqual({ model: DEFAULT_MODEL, showAll: false, hasApiKey: false });
});

test("set persists across a new store", () => {
  const model = MODELS[1];
  const result = new SettingsStore(file, cipher).set({ model, showAll: true });
  expect(result).toEqual({ model, showAll: true, hasApiKey: false });
  expect(new SettingsStore(file, cipher).get()).toEqual({ model, showAll: true, hasApiKey: false });
});

test("set rejects an unknown model and changes nothing on disk", () => {
  const store = new SettingsStore(file, cipher);
  store.set({ showAll: true });
  const before = readFileSync(file, "utf8");
  expect(() => store.set({ model: "not-a-model" })).toThrow(Error);
  expect(readFileSync(file, "utf8")).toBe(before);
});

test("setApiKey then getApiKey round-trips and hasApiKey is true", () => {
  const store = new SettingsStore(file, cipher);
  store.setApiKey("sk-ant-secret");
  expect(store.getApiKey()).toBe("sk-ant-secret");
  expect(store.get().hasApiKey).toBe(true);
  expect(new SettingsStore(file, cipher).getApiKey()).toBe("sk-ant-secret");
});

test("the file does not contain the plain key", () => {
  new SettingsStore(file, cipher).setApiKey("sk-ant-secret");
  expect(readFileSync(file, "utf8")).not.toContain("sk-ant-secret");
});

test("setApiKey with an empty string removes the key", () => {
  const store = new SettingsStore(file, cipher);
  store.setApiKey("sk-ant-secret");
  store.setApiKey("");
  expect(store.getApiKey()).toBeUndefined();
  expect(store.get().hasApiKey).toBe(false);
});

test("setApiKey trims white space and treats a blank key as removal", () => {
  const store = new SettingsStore(file, cipher);
  store.setApiKey("  sk-ant-secret\n");
  expect(store.getApiKey()).toBe("sk-ant-secret");
  store.setApiKey("   ");
  expect(store.getApiKey()).toBeUndefined();
});

test("a key the cipher cannot decrypt gives no key", () => {
  new SettingsStore(file, cipher).setApiKey("sk-ant-secret");
  const broken: KeyCipher = {
    encrypt: cipher.encrypt,
    decrypt: () => {
      throw new Error("bad data");
    },
  };
  const store = new SettingsStore(file, broken);
  expect(store.getApiKey()).toBeUndefined();
  expect(store.get().hasApiKey).toBe(false);
});

test("changing settings keeps the stored key", () => {
  const store = new SettingsStore(file, cipher);
  store.setApiKey("sk-ant-secret");
  store.set({ showAll: true });
  expect(store.getApiKey()).toBe("sk-ant-secret");
});
