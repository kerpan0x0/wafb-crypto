import { ADBCommands, CommandOptions } from ".";
import { Adb } from "../..";
import { ShellCommand } from "./shellCommand";
// TODO fix import 
import { BackupResult } from "../../forensics/acquisition/backup";

export interface BackupOptions extends CommandOptions {
  type: string;
  outputPath: string;
  useCompression: boolean;
}

export class GenerateBackupCommand implements ADBCommands<BackupResult> {
  constructor(private adb: Adb) { }

  async exec(options: BackupOptions): Promise<BackupResult> {
    const stdout = await new ShellCommand(this.adb, `bu backup -all -nosystem > ${options.outputPath}`).exec({ timeout: 1000000 });
    return { outputPath: options.outputPath };
  }
}
