import type { BugreportStatus } from '../../types';

interface ProgressBarProps {
  progress: number;
  status: BugreportStatus;
  message: string;
}

export function ProgressBar({ progress, status, message }: ProgressBarProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'success':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      case 'connecting':
      case 'connected':
        return 'bg-blue-500';
      case 'generating':
      case 'downloading':
        return 'bg-primary-500';
      default:
        return 'bg-gray-300';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'success':
        return '✓';
      case 'error':
        return '✗';
      case 'connecting':
      case 'connected':
        return '🔌';
      case 'generating':
        return '⚙️';
      case 'downloading':
        return '⬇️';
      default:
        return '⏸️';
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-gray-700">
          <span className="text-lg">{getStatusIcon()}</span>
          {message}
        </span>
        <span className="font-semibold text-gray-600">{progress}%</span>
      </div>
      
      <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full transition-all duration-500 ease-out ${getStatusColor()} ${
            status === 'generating' || status === 'downloading' ? 'animate-pulse' : ''
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}