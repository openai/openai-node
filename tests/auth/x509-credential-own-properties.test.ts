import { createPrivateKey } from 'node:crypto';
import OpenAI from 'openai';
import { fromX509 } from 'openai/auth/x509-transport';
import { createX509TestLab } from '../utils/x509-test-lab';

const lab = createX509TestLab();
const passphrase = 'synthetic-encrypted-key-passphrase';
const privateKey = createPrivateKey(lab.firstClient.privateKey)
  .export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase })
  .toString();

const options = {
  certificateChain: lab.firstClient.certificate.toString(),
  privateKey,
  passphrase,
  identityProviderId: 'synthetic-own-property-provider',
  serviceAccountId: 'synthetic-own-property-account',
  refreshBufferSeconds: 0,
  ca: lab.certificateAuthority.toString(),
  proxy: {
    url: 'https://synthetic-user:synthetic-password@localhost:8443',
    mode: 'https-connect' as const,
    ca: lab.proxyCertificateAuthority.toString(),
  },
};

describe.each(['passphrase', 'auth', 'proxyTls', 'ca', 'refreshBufferSeconds'])(
  'X.509 credential own %s properties',
  (name) => {
    test.each(['setter', 'readonly'] as const)('bypasses an inherited %s', async (descriptorKind) => {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, name);
      let setterCalls = 0;
      let credential: ReturnType<typeof fromX509> | undefined;
      const descriptor: PropertyDescriptor =
        descriptorKind === 'setter'
          ? {
              configurable: true,
              set() {
                setterCalls += 1;
              },
            }
          : { configurable: true, value: undefined, writable: false };
      // oxlint-disable-next-line no-extend-native -- Exercise inherited setters and readonly fields only during synchronous credential construction, then restore the prototype.
      Object.defineProperty(Object.prototype, name, descriptor);
      try {
        try {
          credential = fromX509(options);
        } finally {
          if (original) {
            // oxlint-disable-next-line no-extend-native -- Restore the exact prototype descriptor saved before this fixture.
            Object.defineProperty(Object.prototype, name, original);
          } else {
            Reflect.deleteProperty(Object.prototype, name);
          }
        }
        expect(setterCalls).toBe(0);
        expect(new OpenAI({ credential }).baseURL).toBe('https://mtls.api.openai.com/v1');
      } finally {
        await credential?.close();
      }
    });
  },
);
