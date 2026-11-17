import { execFile, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

export interface LcuCredentials { port: number; token: string }

export type RunProcess = (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string }>;

interface LocateDeps {
  platform: NodeJS.Platform;
  runProcess: RunProcess;
}

const defaultDeps: LocateDeps = { platform: process.platform, runProcess: promisify(execFile) };

export function parseCommandLine(commandLine: string): LcuCredentials | undefined {
  const port = /--app-port=(\d+)/.exec(commandLine)?.[1];
  const token = /--remoting-auth-token=([^\s"]+)/.exec(commandLine)?.[1];
  return port && token ? { port: Number(port), token } : undefined;
}

async function readCommandLine({ platform, runProcess }: LocateDeps): Promise<string> {
  if (platform === "win32") {
    const { stdout } = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "name='LeagueClientUx.exe'").CommandLine`],
      { windowsHide: true },
    );
    return stdout;
  }
  const { stdout } = await runProcess("ps", ["-A", "-o", "args"], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").find((line) => line.includes("LeagueClientUx")) ?? "";
}

export async function locateClient(deps: LocateDeps = defaultDeps): Promise<LcuCredentials | undefined> {
  try {
    return parseCommandLine(await readCommandLine(deps));
  } catch {
    return undefined;
  }
}
