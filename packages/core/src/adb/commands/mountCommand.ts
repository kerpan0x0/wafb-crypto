import { ADBCommands, CommandArgs, CommandOptions } from ".";
import { Adb } from "../..";
import { ShellCommand } from "./shellCommand";

export class ProcMountCommand implements ADBCommands<string> {
    constructor(private adb: Adb) {
    }

    async exec(_args?: CommandArgs, _options?: CommandOptions): Promise<string> {
        return await new ShellCommand(this.adb, 'cat /proc/mounts').exec();
    }
}

export class MountCommand implements ADBCommands<string> {
    constructor(private adb: Adb) {
    }

    async exec(_args?: CommandArgs, _options?: CommandOptions): Promise<string> {
        return await new ShellCommand(this.adb, 'mount').exec();
    }
}
