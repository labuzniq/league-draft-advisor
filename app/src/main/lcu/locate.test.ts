import { expect, test } from "vitest";
import { parseCommandLine } from "./locate";

test("parseCommandLine reads port and token", () => {
  expect(parseCommandLine('"LeagueClientUx.exe" --remoting-auth-token=abc123 --app-port=51234 --x')).toEqual({ port: 51234, token: "abc123" });
});

test("parseCommandLine gives undefined without them", () => {
  expect(parseCommandLine("notepad.exe")).toBeUndefined();
});
