/**
 * Platform checks and save-target selection.
 *
 * WebUSB and direct file writing are checked separately: one being available
 * says nothing about the other. No Blob-download fallback is offered, because
 * it would buffer the whole archive in memory (and, for a backup, possibly
 * several GiB) — precisely the cases the streaming design must handle.
 */

export interface PreflightResult {
  secureContext: boolean;
  webUsb: boolean;
  fileSystemAccess: boolean;
  ok: boolean;
}

export function runPreflight(): PreflightResult {
  const secureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const webUsb = typeof navigator !== 'undefined' && 'usb' in navigator && !!(navigator as { usb?: unknown }).usb;
  const fileSystemAccess = typeof window !== 'undefined' && typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  return { secureContext, webUsb, fileSystemAccess, ok: secureContext && webUsb && fileSystemAccess };
}

export type PickResult =
  | { status: 'picked'; writable: WritableStream<Uint8Array>; fileName: string }
  | { status: 'dismissed' }
  | { status: 'error'; message: string };

interface SaveFilePickerWindow {
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<{ name: string; createWritable(): Promise<WritableStream<Uint8Array>> }>;
}

/**
 * Opens the browser save dialog. MUST be called directly from a click handler
 * with no `await` before it: browsers only open the picker as a consequence of
 * a user gesture. All checks on the recipient must therefore be done before
 * the button is enabled.
 *
 * Choosing a destination and being able to write to it are distinct: closing
 * the dialog is not an error ('dismissed'); failing to open the file is.
 */
export async function pickSaveTarget(suggestedName: string): Promise<PickResult> {
  const w = window as unknown as SaveFilePickerWindow;
  let handle: Awaited<ReturnType<SaveFilePickerWindow['showSaveFilePicker']>>;
  try {
    handle = await w.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return { status: 'dismissed' };
    return { status: 'error', message: (err as Error)?.message ?? 'save dialog failed' };
  }
  try {
    const writable = await handle.createWritable();
    return { status: 'picked', writable, fileName: handle.name };
  } catch (err) {
    return { status: 'error', message: (err as Error)?.message ?? 'cannot open file for writing' };
  }
}

export function suggestedArchiveName(prefix: string, caseRef?: string | null): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `${prefix}${caseRef ? `-${caseRef}` : ''}-${ts}.zip`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
