import { Adb } from "@yume-chan/adb";
import { ShellCommand } from "./shellCommand";
import { ADBCommands } from ".";


export class IsRootedCommand implements ADBCommands<boolean> {
    constructor(private adb: Adb) { }

    async exec(): Promise<boolean> {
        try {
            const output = await new ShellCommand(this.adb, 'su -c "id"').exec();
            return output.includes('uid=0');
        } catch (error) {
            return false;
        }
    }
}   