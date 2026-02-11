import { ADBCommands, CommandOptions } from ".";
import { Adb, Logger } from "../..";
import { ShellCommand } from "./shellCommand";

export interface PmOptions extends CommandOptions {
    includeSystem?: boolean;
}

export class PmCommand implements ADBCommands<string> {

    constructor(private adb: Adb) {
    }

    async exec(options: PmOptions = {}): Promise<string> {
        const { includeSystem = true, timeout = 30000 } = options;
        const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
        return await new ShellCommand(this.adb, command).exec({ timeout });
    }
}
