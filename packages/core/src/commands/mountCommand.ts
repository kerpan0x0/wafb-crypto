import { DeviceCommand } from ".";
import { Device, ShellOptions } from "../adb";

export class ProcMountCommand implements DeviceCommand<string> {
    constructor(private device: Device) { }

    async exec(options?: ShellOptions): Promise<string> {
        return (await this.device.shell('cat /proc/mounts')).stdout;
    }
}

export class MountCommand implements DeviceCommand<string> {
    constructor(private device: Device) { }

    async exec(options?: ShellOptions): Promise<string> {
        return (await this.device.shell('mount')).stdout;
    }
}
