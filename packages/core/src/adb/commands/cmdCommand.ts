import { ADBCommands, CommandOptions } from ".";
import { Adb } from "../..";
import { ShellCommand } from "./shellCommand";

export interface CmdOptions extends CommandOptions {
    namespace: string;
}

const validNamespaces = ['global', 'system', 'secure'];

export class CmdCommand implements ADBCommands<string> {
    constructor(private adb: Adb) {
    }


    async exec(options: CmdOptions): Promise<string> {
        validNamespaces.includes(options.namespace) || (() => { throw new Error(`Invalid namespace: ${options.namespace}`); })();
        return await new ShellCommand(this.adb, `settings list ${options.namespace}`).exec();
    }
}