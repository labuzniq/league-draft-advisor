import { expect, test, vi } from "vitest";
import { locateClient, parseCommandLine, type RunProcess } from "./locate";

test("parseCommandLine reads port and token", () => {
  expect(parseCommandLine('"LeagueClientUx.exe" --remoting-auth-token=abc123 --app-port=51234 --x')).toEqual({ port: 51234, token: "abc123" });
});

test("parseCommandLine gives undefined without them", () => {
  expect(parseCommandLine("notepad.exe")).toBeUndefined();
});

test("on Windows the client lookup runs PowerShell without showing a window", async () => {
  const runProcess = vi.fn<RunProcess>(async () => ({ stdout: '"LeagueClientUx.exe" --remoting-auth-token=abc123 --app-port=51234' }));
  await expect(locateClient({ platform: "win32", runProcess })).resolves.toEqual({ port: 51234, token: "abc123" });
  expect(runProcess).toHaveBeenCalledTimes(1);
  const [file, , options] = runProcess.mock.calls[0]!;
  expect(file).toBe("powershell.exe");
  expect(options).toMatchObject({ windowsHide: true });
});
