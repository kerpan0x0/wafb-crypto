
/**
 * Legge un ReadableStream e ritorna il contenuto come stringa
 * Nota: Usiamo 'any' per il parametro readable per evitare conflitti tra 
 * i tipi ReadableStream del browser e quelli di @yume-chan/stream-extra.
 */
export async function readStreamAsText(readable: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (value) {
        // Gestisce sia il caso in cui value sia wrapped che unwrapped
        const data = (value).value || value;
        chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return new TextDecoder().decode(concatUint8Arrays(chunks));
}

/**
 * Legge un ReadableStream e ritorna il contenuto come Uint8Array
 */
export async function readStreamAsBytes(readable: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (value) {
        const data = (value).value || value;
        chunks.push(data instanceof Uint8Array ? data : new Uint8Array(data));
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return concatUint8Arrays(chunks);
}

/**
 * Concatena più Uint8Array in uno solo
 */
export function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.byteLength, 0);
  const result = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  
  return result;
}

/**
 * Utility generica per retry di operazioni asincrone
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    attempts: number;
    delay: number;
    onRetry?: (attempt: number, error: Error) => void;
  }
): Promise<T> {
  const { attempts, delay, onRetry } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Wraps a ReadableStream with an idle timeout: if no chunk arrives within
 * `ms` milliseconds the stream is closed gracefully.
 *
 * Used internally by ShellCommand.spawn() so devices that never send EOF
 * do not stall consumers like the ZIP writer indefinitely.
 */
export function wrapWithIdleTimeout(
  source: ReadableStream<Uint8Array>,
  ms: number
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idlePromise = new Promise<{ done: true; value: undefined }>(resolve => {
        idleTimer = setTimeout(() => resolve({ done: true, value: undefined }), ms);
      });
      const { done, value } = await Promise.race([reader.read(), idlePromise]);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (done) {
        reader.releaseLock();
        controller.close();
      } else if (value) {
        controller.enqueue(value);
      }
    },
    cancel() {
      reader.releaseLock();
    },
  });
}
