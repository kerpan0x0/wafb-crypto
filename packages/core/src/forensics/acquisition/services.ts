import type { ADBDevice } from '../../adb';
import { Acquirer } from './acquirer';
import type {
  AcquisitionConfig,
  AcquisitionProgress,
  AcquisitionResult
} from '.';
import { DumpsysCommand } from '../../adb/commands/';

export interface ServicesConfig extends AcquisitionConfig {
  includeSystemServices?: boolean;
  includeUserServices?: boolean;
  includeServiceDetails?: boolean;
}

export interface ServiceInfo {
  name: string;
  pid?: number;
  user?: string;
  state: 'running' | 'stopped' | 'unknown';
  description?: string;
  className?: string;
  processName?: string;
}

export interface ServicesData {
  totalServices: number;
  runningServices: number;
  stoppedServices: number;
  systemServices: number;
  userServices: number;
  services: ServiceInfo[];
  deviceInfo: any;
  acquisitionTime: string;
  timestamp: number;
}

export class ServicesAcquirer extends Acquirer {
  constructor(
    device: ADBDevice,
    private servicesConfig: ServicesConfig = {}
  ) {
    super(device, servicesConfig, 'services' as any);
  }

  async acquire(
    onProgress?: (progress: AcquisitionProgress) => void
  ): Promise<AcquisitionResult> {
    const startTime = new Date();

    try {
      this.logger.info('Starting services acquisition');

      this.notifyProgress(onProgress, 10, 'Reading device information...', 'running');
      const deviceInfo = await this.device.getProperties();

      this.notifyProgress(
        onProgress,
        20,
        `Connected to ${deviceInfo.model}`,
        'running',
        deviceInfo
      );

      this.notifyProgress(onProgress, 40, 'Collecting services information...', 'running');
      const services = await this.getServicesList();

      this.logger.info(`Collected ${services.length} services`);

      if (this.servicesConfig.includeServiceDetails !== false) {
        this.notifyProgress(
          onProgress,
          70,
          `Analyzing ${services.length} services...`,
          'running'
        );

        await this.enrichServicesWithDetails(services);
      }

      const runningCount = services.filter(s => s.state === 'running').length;
      const stoppedCount = services.filter(s => s.state === 'stopped').length;
      const systemCount = this.countSystemServices(services);
      const userCount = services.length - systemCount;

      this.notifyProgress(onProgress, 90, 'Preparing export...', 'running');

      const servicesData: ServicesData = {
        totalServices: services.length,
        runningServices: runningCount,
        stoppedServices: stoppedCount,
        systemServices: systemCount,
        userServices: userCount,
        services,
        deviceInfo,
        acquisitionTime: new Date().toISOString(),
        timestamp: Date.now()
      };

      const jsonData = JSON.stringify(servicesData, null, 2);
      const jsonBytes = new TextEncoder().encode(jsonData);

      const blob = new Blob([jsonBytes], { type: 'application/json' });
      const fileName = this.generateFileName('services', 'json', deviceInfo.model);

      this.downloadBlob(blob, fileName);

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.notifyProgress(onProgress, 100, 'Services acquisition completed!', 'completed');

      const result: AcquisitionResult = {
        success: true,
        type: 'services' as any,
        fileName,
        fileSize: jsonBytes.length,
        startTime,
        endTime,
        duration,
        data: {
          totalServices: services.length,
          runningServices: runningCount,
          stoppedServices: stoppedCount,
          systemServices: systemCount,
          userServices: userCount,
          deviceInfo
        }
      };

      if (this.config.computeHash) {
        result.hash = await this.computeHash(jsonBytes);
      }

      this.logger.info('Services acquisition completed', {
        fileName,
        totalServices: services.length,
        duration
      });

      return result;

    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Services acquisition failed', error);
      this.notifyProgress(onProgress, 0, `Error: ${errorMessage}`, 'failed');

      return {
        success: false,
        type: 'services' as any,
        startTime,
        endTime,
        duration,
        error: errorMessage
      };
    }
  }

  private async getServicesList(): Promise<ServiceInfo[]> {
    const output = await new DumpsysCommand(this.device.adb).exec({
      args: ['-l'],
      timeout: 30000
    });

    return this.parseServicesList(output);
  }

  private async enrichServicesWithDetails(services: ServiceInfo[]): Promise<void> {
    try {
      const activityOutput = await new DumpsysCommand(this.device.adb).exec({ service: 'activity', args: ["services"], timeout: 300000 });
 
      this.parseServiceDetails(services, activityOutput);
    } catch (error) {
      this.logger.warn('Failed to get service details', error);
    }
  }

  //TODO: Move to ServicesAdapter when adapter layer is ready)
  private parseServicesList(output: string): ServiceInfo[] {
    const services: ServiceInfo[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Currently running services:')) {
        continue;
      }

      const serviceName = trimmed;
      
      if (!this.shouldIncludeService(serviceName)) {
        continue;
      }

      services.push({
        name: serviceName,
        state: 'unknown'
      });
    }

    return services;
  }

  private parseServiceDetails(services: ServiceInfo[], output: string): void {
    const lines = output.split('\n');
    let currentService: ServiceInfo | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Look for service entries like "ServiceRecord{...}"
      const serviceMatch = line.match(/ServiceRecord\{[a-f0-9]+ u\d+ ([^\}\/]+)\/([^\}]+)\}/);
      if (serviceMatch) {
        const packageName = serviceMatch[1];
        const className = serviceMatch[2];
        
        // Find matching service in our list
        currentService = services.find(s => s.name.includes(packageName)) || null;
        if (currentService) {
          currentService.className = className;
          currentService.processName = packageName;
        }
        continue;
      }

      if (currentService) {
        // Extract process info
        const processMatch = line.match(/app=ProcessRecord\{[a-f0-9]+ (\d+):([^\/]+)/);
        if (processMatch) {
          currentService.pid = parseInt(processMatch[1], 10);
          currentService.user = processMatch[2];
        }

        // Check if service is running
        if (line.includes('(nothing)') || line.includes('app=null')) {
          currentService.state = 'stopped';
        } else if (line.includes('app=ProcessRecord')) {
          currentService.state = 'running';
        }
      }
    }

    // Mark services without details as running (they're listed in dumpsys -l)
    services.forEach(service => {
      if (service.state === 'unknown') {
        service.state = 'running';
      }
    });
  }

  private shouldIncludeService(serviceName: string): boolean {
    const isSystem = this.isSystemService(serviceName);
    
    if (isSystem && this.servicesConfig.includeSystemServices === false) {
      return false;
    }
    
    if (!isSystem && this.servicesConfig.includeUserServices === false) {
      return false;
    }
    
    return true;
  }

  private isSystemService(serviceName: string): boolean {
    const systemPatterns = [
      /^android\./,
      /^com\.android\./,
      /^com\.google\.android\./,
      /^activity$/,
      /^package$/,
      /^window$/,
      /^alarm$/,
      /^power$/,
      /^battery$/,
      /^connectivity$/,
      /^wifi$/,
      /^telephony/,
      /^location$/,
      /^notification$/,
      /^input$/,
      /^media\./,
      /^sensor$/,
      /^statusbar$/,
      /^wallpaper$/,
      /^clipboard$/,
      /^device_policy$/,
      /^display$/,
      /^user$/,
      /^account$/,
      /^permission$/
    ];

    return systemPatterns.some(pattern => pattern.test(serviceName));
  }

  private countSystemServices(services: ServiceInfo[]): number {
    return services.filter(s => this.isSystemService(s.name)).length;
  }
}