
/**
 * Legge un ReadableStream e ritorna il contenuto come stringa
 * Nota: Usiamo 'any' per il parametro readable per evitare conflitti tra 
 * i tipi ReadableStream del browser e quelli di @yume-chan/stream-extra.
 */
export async function readStreamAsText(readable: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (value) {
        // Gestisce sia il caso in cui value sia wrapped che unwrapped
        const data = (value as any).value || value;
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
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (value) {
        const data = (value as any).value || value;
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
