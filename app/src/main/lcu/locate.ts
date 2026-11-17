import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface LcuCredentials { port: number; token: string }

const run = promisify(execFile);

export function parseCommandLine(commandLine: string): LcuCredentials | undefined {
  const port = /--app-port=(\d+)/.exec(commandLine)?.[1];
  const token = /--remoting-auth-token=([^\s"]+)/.exec(commandLine)?.[1];
  return port && token ? { port: Number(port), token } : undefined;
}

async function readCommandLine(): Promise<string> {
  if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'").CommandLine`,
    ]);
    return stdout;
  }
  const { stdout } = await run("ps", ["-A", "-o", "args"], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").find((line) => line.includes("LeagueClientUx")) ?? "";
}

export async function locateClient(): Promise<LcuCredentials | undefined> {
  try {
    return parseCommandLine(await readCommandLine());
  } catch {
    return undefined;
  }
}
