// jsdom supplies no SubtleCrypto. Use the real Node implementation for cryptographic contracts.
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
