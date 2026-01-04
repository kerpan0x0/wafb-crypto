import { vi } from 'vitest';

// Mock WebUSB API globalmente per i test
global.navigator = {
  usb: {
    requestDevice: vi.fn(),
    getDevices: vi.fn().mockResolvedValue([])
  }
} as any;

// Mock TextEncoder/TextDecoder se necessario
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = require('util').TextEncoder;
}

if (typeof TextDecoder === 'undefined') {
  global.TextDecoder = require('util').TextDecoder;
}

// Mock crypto API per tests
if (typeof crypto === 'undefined') {
  global.crypto = {
    subtle: {
      digest: vi.fn().mockResolvedValue(new ArrayBuffer(32))
    }
  } as any;
}