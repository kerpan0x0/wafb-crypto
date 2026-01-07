import React from 'react';
import { Smartphone, Info, Package, Hash } from 'lucide-react';
import type { DeviceProperties } from '@wafb/core';

interface DeviceInfoProps {
  device: DeviceProperties;
}

export function DeviceInfo({ device }: DeviceInfoProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-800">
        <Smartphone className="h-5 w-5 text-primary-500" />
        Connected Device
      </h3>
      
      <div className="space-y-3">
        <InfoRow
          icon={<Package className="h-4 w-4" />}
          label="Model"
          value={device.model}
        />
        <InfoRow
          icon={<Info className="h-4 w-4" />}
          label="Manufacturer"
          value={device.manufacturer}
        />
        <InfoRow
          icon={<Hash className="h-4 w-4" />}
          label="Android Version"
          value={`${device.androidVersion} (SDK ${device.sdkVersion})`}
        />
        <InfoRow
          icon={<Hash className="h-4 w-4" />}
          label="Build ID"
          value={device.buildId}
        />
        <InfoRow
          icon={<Hash className="h-4 w-4" />}
          label="Serial"
          value={device.serialNumber}
        />
      </div>
    </div>
  );
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-medium text-gray-500">{label}</div>
        <div className="font-semibold text-gray-800">{value}</div>
      </div>
    </div>
  );
}