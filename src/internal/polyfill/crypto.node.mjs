import * as mod from './crypto.node.js';
export const crypto = globalThis.crypto || mod.crypto;
