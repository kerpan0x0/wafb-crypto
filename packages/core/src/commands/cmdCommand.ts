import { DeviceCommand, ShellOptions } from ".";
import { Device } from "../adb";

export interface CmdOptions extends ShellOptions {
    namespace: string;
}

const validNamespaces = ['global', 'system', 'secure'];

export class CmdCommand implements DeviceCommand<string> {
    constructor(private device: Device) {
    }


    async exec(options: CmdOptions): Promise<string> {
        validNamespaces.includes(options.namespace) || (() => { throw new Error(`Invalid namespace: ${options.namespace}`); })();
        return (await this.device.shell(`cmd settings list ${options.namespace}`)).stdout;
    }
}