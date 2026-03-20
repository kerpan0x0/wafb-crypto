import { Adb } from "@yume-chan/adb";
import { ADBCommands, CommandOptions } from ".";
import { ShellCommand } from "./shellCommand";

// TODO move to own file, return a string, define an adapter 
export class GetPropCommand implements ADBCommands<Record<string, string>> {

    constructor(private adb: Adb) { }

    async exec(options: CommandOptions = {}): Promise<Record<string, string>> {
        const output = (await new ShellCommand(this.adb, 'getprop').exec(options)).stdout;
        const props: Record<string, string> = {};
        const regex = /\[([^\]]+)\]:\s*\[([^\]]*)\]/g;

        let match;
        while ((match = regex.exec(output)) !== null) {
            if (match[1] && match[2] !== undefined) {
                props[match[1]] = match[2];
            }
        }

        return props;
    }
}