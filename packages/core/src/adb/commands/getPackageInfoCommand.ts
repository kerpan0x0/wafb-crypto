import { ADBCommands, CommandOptions } from ".";
import { Adb, Logger } from "../..";
import { ShellCommand } from "./shellCommand";

export interface PackageInfoOptions extends CommandOptions {
    packageName: string;
}

export class GetPackageInfoCommand implements ADBCommands<string> {
    private logger: Logger;

    constructor(private adb: Adb) {
        this.logger = new Logger('GetPackageInfoCommand');
    }

    async exec(
        options: PackageInfoOptions
    ): Promise<string> {
        const { timeout } = options;
        const packageName = options.packageName.toString();

        try {
            return await new ShellCommand(this.adb, `dumpsys package ${packageName}`).exec({ timeout });
        } catch (error) {
            this.logger.debug('Failed to get package info', { packageName, error });
            return '';
        }
    }
}

export interface ListPackageOptions extends CommandOptions {
    includeSystem?: boolean;
}

export class ListPackageCommand implements ADBCommands<string> {

    constructor(private adb: Adb) {
    }

    async exec(options: ListPackageOptions = {}): Promise<string> {
        const { includeSystem = true, timeout = 30000 } = options;
        const command = includeSystem ? 'pm list packages' : 'pm list packages -3';
        return await new ShellCommand(this.adb, command).exec({ timeout });
    }
}
