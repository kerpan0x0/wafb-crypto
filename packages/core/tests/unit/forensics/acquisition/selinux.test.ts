import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SELinuxAcquirer } from '../../../../src/forensics/acquisition/selinux';
import type { SELinuxConfig } from '../../../../src/forensics/acquisition/selinux';
import {
  createMockDeviceForAcquirer,
  setupAcquirerDOMMocks,
  createMockProgressCallback,
  createMockSync,
  makeShellResult,
  readStream,
} from '../../../helpers/test-helpers';
import type { MockDevice } from '../../../helpers/test-helpers';

async function drainAndHash(result: any, fileIndex = 0): Promise<string | undefined> {
  const file = result.files?.[fileIndex] ?? result.files![fileIndex];
  if (!file?.hashPromise) return undefined;
  // Drain the stream so TransformStream.flush() fires and hashPromise resolves
  if (file.stream) {
    const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
    while (!(await reader.read()).done) {}
  }
  return file.hashPromise;
}


// ── Fixtures ────────────────────────────────────────────────────────────────

const PROCESS_CONTEXTS = `LABEL                          USER     PID   PPID     VSZ    RSS WCHAN            ADDR S NAME
u:r:init:s0                        root       1      0   17936   2048 0                   0 S init
u:r:system_server:s0               system  1234      1 3456789  98765 0                   0 S system_server
u:r:surfaceflinger:s0              system  2345      1  123456   5678 0                   0 S surfaceflinger`;

const FILE_CONTEXTS = `u:object_r:system_file:s0 /system/bin/app_process
u:object_r:system_file:s0 /system/bin/linker`;

const DENIAL_LINE = '01-01 10:00:00.000  123  456 W audit: type=1400 audit(1234567890.123:456): avc: denied { read } for pid=1234 comm="untrusted_app" name="test" dev="sda" ino=12345 scontext=u:r:untrusted_app:s0 tcontext=u:object_r:system_file:s0 tclass=file permissive=0';

const GETPROP_OUTPUT = (policyVersion = '30') =>
  `[ro.build.version.release]: [13]
[ro.build.id]: [TP1A.220905.004]
[ro.product.model]: [Test Device]
[ro.product.manufacturer]: [Test Manufacturer]
[ro.product.brand]: [Test]
[ro.build.version.sdk]: [33]
[ro.build.selinux]: [${policyVersion}]`;

// ── Factory ──────────────────────────────────────────────────────────────────

interface SELinuxMockOptions {
  getenforce?: string;
  policyVersion?: string;
  processContexts?: string;
  fileContexts?: string;
  denials?: string;
  throwOnGetenforce?: boolean;
  throwOnFileRead?: boolean;
  throwOnPs?: boolean;
  throwOnDeviceInfo?: boolean;
}

function createSELinuxDevice(options: SELinuxMockOptions = {}): MockDevice {
  const {
    getenforce = 'Enforcing',
    policyVersion = '30',
    processContexts = PROCESS_CONTEXTS,
    fileContexts = FILE_CONTEXTS,
    denials = DENIAL_LINE,
    throwOnGetenforce = false,
    throwOnFileRead = false,
    throwOnPs = false,
    throwOnDeviceInfo = false,
  } = options;

  const device = createMockDeviceForAcquirer();

  device.shell.mockImplementation(async (cmd: string) => {
    if (cmd === 'getenforce') {
      if (throwOnGetenforce) throw new Error('getenforce failed');
      return makeShellResult(getenforce);
    }
    if (cmd.includes('ps') && cmd.includes('-A') && cmd.includes('-Z')) {
      if (throwOnPs) throw new Error('ps failed');
      return makeShellResult(processContexts);
    }
    if (cmd.includes('ls') && cmd.includes('-Z')) {
      return makeShellResult(fileContexts);
    }
    if (cmd.includes('logcat') && cmd.includes('-d') && cmd.includes('-b all')) {
      return makeShellResult(denials);
    }
    if (cmd === 'getprop') {
      return makeShellResult(GETPROP_OUTPUT(policyVersion));
    }
    return makeShellResult('');
  });

  if (throwOnFileRead) {
    device.sync.mockRejectedValue(new Error('File read failed'));
  } else {
    const bootContent = new TextEncoder().encode(
      `androidboot.selinux=enforcing policy_version=${policyVersion}`
    );
    device.sync.mockResolvedValue(createMockSync(bootContent));
  }

  if (throwOnDeviceInfo) {
    device.getProperties.mockRejectedValue(new Error('Failed to get device info'));
  }

  return device;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SELinuxAcquirer', () => {
  let device: MockDevice;
  let acquirer: SELinuxAcquirer;
  let domMocks: ReturnType<typeof setupAcquirerDOMMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    domMocks = setupAcquirerDOMMocks();
    device = createSELinuxDevice();
    acquirer = new SELinuxAcquirer(device as any);
  });

  afterEach(() => {
    domMocks.cleanup();
  });

  describe('Basic Acquisition', () => {
    it('should successfully acquire SELinux information', async () => {
      const { callback, getLastProgress } = createMockProgressCallback();
      const result = await acquirer.acquire(callback);

      expect(result.success).toBe(true);
      expect(result.type).toBe('selinux');
      expect(result.files[0].fileName).toBeTruthy();
      expect(result.files[0].fileSize).toBeGreaterThan(0);
      expect(getLastProgress()?.status).toBe('completed');
      expect(getLastProgress()?.progress).toBe(100);
    });

    it('should include mode information', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('mode');
      expect(result.data?.mode).toBe('Enforcing');
    });

    it('should include policy version', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('policyVersion');
    });
  });

  describe('SELinux Mode Detection', () => {
    it('should detect Enforcing mode', async () => {
      expect((await acquirer.acquire()).data?.mode).toBe('Enforcing');
    });

    it('should detect Permissive mode', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ getenforce: 'Permissive' }) as any);
      expect((await acquirer.acquire()).data?.mode).toBe('Permissive');
    });

    it('should handle unknown mode gracefully', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ getenforce: 'InvalidMode' }) as any);
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('Process Contexts', () => {
    it('should collect process contexts when enabled', async () => {
      acquirer = new SELinuxAcquirer(device as any, { includeContexts: true });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.processContextsCount).toBeGreaterThan(0);
    });

    it('should skip process contexts when disabled', async () => {
      acquirer = new SELinuxAcquirer(device as any, { includeContexts: false });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.processContextsCount).toBe(0);
    });

    it('should handle ps command failure gracefully', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ throwOnPs: true }) as any);
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.processContextsCount).toBe(0);
    });
  });

  describe('File Contexts', () => {
    it('should collect file contexts when enabled', async () => {
      acquirer = new SELinuxAcquirer(device as any, { includeFileContexts: true });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.fileContextsCount).toBeGreaterThan(0);
    });

    it('should format file contexts as separate lines', async () => {
      const d = createSELinuxDevice({
        fileContexts: 'u:object_r:system_file:s0 bin\nu:object_r:system_file:s0 lib\nu:object_r:system_file:s0 etc',
      });
      acquirer = new SELinuxAcquirer(d as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      expect(result.files[0].stream).toBeInstanceOf(ReadableStream);

      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(Array.isArray(data.fileContexts)).toBe(true);
      expect(
        data.fileContexts.some((line: string) =>
          line.includes('u:object_r:system_file:s0') && !line.includes('\n')
        )
      ).toBe(true);
    });

    it('should include path headers in file contexts', async () => {
      const d = createSELinuxDevice({ fileContexts: 'u:object_r:system_file:s0 bin' });
      acquirer = new SELinuxAcquirer(d as any);
      const result = await acquirer.acquire();

      expect(result.success).toBe(true);
      const data = JSON.parse(await readStream(result.files[0].stream!));
      expect(data.fileContexts.some((line: string) => line.startsWith('# /'))).toBe(true);
    });

    it('should skip file contexts when disabled', async () => {
      acquirer = new SELinuxAcquirer(device as any, { includeFileContexts: false });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.fileContextsCount).toBe(0);
    });

    it('should handle empty output for non-existent paths', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ fileContexts: '' }) as any);
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });
  });

  describe('SELinux Denials', () => {
    it('should collect denials when enabled', async () => {
      acquirer = new SELinuxAcquirer(device as any, { includeDenials: true });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.denialsCount).toBeGreaterThan(0);
    });

    it('should skip denials when disabled', async () => {
      acquirer = new SELinuxAcquirer(device as any, { includeDenials: false });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.denialsCount).toBe(0);
    });

    it('should respect maxDenialLines limit', async () => {
      const manyDenials = Array(50).fill(DENIAL_LINE).join('\n');
      const d = createSELinuxDevice({ denials: manyDenials });
      acquirer = new SELinuxAcquirer(d as any, { includeDenials: true, maxDenialLines: 10 });

      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.denialsCount).toBeLessThanOrEqual(10);
    });

    it('should parse denial lines correctly', async () => {
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(result.data?.denialsCount).toBeGreaterThan(0);
    });
  });

  describe('Progress Reporting', () => {
    it('should report progress at key milestones', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const history = getProgressHistory();
      expect(history.length).toBeGreaterThan(5);
      expect(history.some(p => p.message.includes('device information'))).toBe(true);
      expect(history.some(p => p.message.includes('SELinux mode'))).toBe(true);
      expect(history.some(p => p.message.includes('completed'))).toBe(true);
    });

    it('should report correct progress percentages', async () => {
      const { callback, getProgressHistory } = createMockProgressCallback();
      await acquirer.acquire(callback);

      const progressValues = getProgressHistory().map(p => p.progress);
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }
      expect(progressValues[progressValues.length - 1]).toBe(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle getenforce command failure', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ throwOnGetenforce: true }) as any);
      const result = await acquirer.acquire();
      expect(result.success).toBe(true); // unknown mode, still succeeds
    });

    it('should handle file read failures gracefully', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ throwOnFileRead: true }) as any);
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
    });

    it('should report acquisition failure on critical error', async () => {
      acquirer = new SELinuxAcquirer(createSELinuxDevice({ throwOnDeviceInfo: true }) as any);
      const result = await acquirer.acquire();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('Hash Computation', () => {
    it('should compute hash when requested', async () => {
      acquirer = new SELinuxAcquirer(device as any, { computeHash: true });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      const hash = await drainAndHash(result, 0);
      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64);
    });

    it('should not compute hash when not requested', async () => {
      acquirer = new SELinuxAcquirer(device as any, { computeHash: false });
      const result = await acquirer.acquire();
      expect(result.success).toBe(true);
      expect(await result.files[0].hashPromise).toBeUndefined();
    });
  });

  describe('Output Format', () => {
    it('should generate valid filename', async () => {
      expect((await acquirer.acquire()).files[0].fileName).toBe('selinux.json');
    });

    it('should create downloadable blob', async () => {
      expect((await acquirer.acquire()).files[0].stream).toBeInstanceOf(ReadableStream);
    });
  });
});