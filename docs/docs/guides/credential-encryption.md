---
---

# Credential Encryption

Tenant database passwords are stored in the master database. Kosan's `Cipher` interface lets you encrypt them at rest so that a database dump does not expose credentials.

---

## How it works

When `cipher` is configured:

1. `createTenant(input)` calls `cipher.encrypt(input.password)` before writing to the master DB
2. `resolveBySlug()` (and `resolveById()`) call `cipher.decrypt(tenant.password)` before opening the connection
3. `updateTenant(id, { password })` calls `cipher.encrypt` before writing

The rest of your code never sees ciphertext — decryption is transparent.

---

## The Cipher interface

```ts
interface Cipher {
  encrypt(plain: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}
```

---

## AES-256-GCM with a local key

A simple implementation using Node's built-in `crypto`:

```ts [src/cipher.ts]
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32-byte hex key

export const cipher = {
  async encrypt(plain: string): Promise<string> {
    const iv = randomBytes(12);
    const enc = createCipheriv(ALGORITHM, KEY, iv);
    const ciphertext = Buffer.concat([enc.update(plain, 'utf8'), enc.final()]);
    const tag = enc.getAuthTag();
    // Store iv + tag + ciphertext as a base64 string
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  },

  async decrypt(stored: string): Promise<string> {
    const buf = Buffer.from(stored, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const dec = createDecipheriv(ALGORITHM, KEY, iv);
    dec.setAuthTag(tag);
    return dec.update(ciphertext) + dec.final('utf8');
  },
};
```

Generate a 32-byte key once and store it as an environment variable:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## AWS KMS

For cloud-managed key storage:

```ts [src/cipher.ts]
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({ region: process.env.AWS_REGION });
const KEY_ID = process.env.KMS_KEY_ID!;

export const cipher = {
  async encrypt(plain: string): Promise<string> {
    const { CiphertextBlob } = await kms.send(
      new EncryptCommand({
        KeyId: KEY_ID,
        Plaintext: Buffer.from(plain),
      }),
    );
    return Buffer.from(CiphertextBlob!).toString('base64');
  },

  async decrypt(stored: string): Promise<string> {
    const { Plaintext } = await kms.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(stored, 'base64'),
      }),
    );
    return Buffer.from(Plaintext!).toString('utf8');
  },
};
```

---

## Google Cloud KMS

```ts [src/cipher.ts]
import { KeyManagementServiceClient } from '@google-cloud/kms';

const client = new KeyManagementServiceClient();
const keyName = `projects/${PROJECT}/locations/${LOCATION}/keyRings/${RING}/cryptoKeys/${KEY}`;

export const cipher = {
  async encrypt(plain: string): Promise<string> {
    const [result] = await client.encrypt({
      name: keyName,
      plaintext: Buffer.from(plain),
    });
    return Buffer.from(result.ciphertext as Uint8Array).toString('base64');
  },

  async decrypt(stored: string): Promise<string> {
    const [result] = await client.decrypt({
      name: keyName,
      ciphertext: Buffer.from(stored, 'base64'),
    });
    return Buffer.from(result.plaintext as Uint8Array).toString('utf8');
  },
};
```

---

## Registering the cipher

```ts
import { cipher } from './cipher.js';

const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  cipher,
});
```

---

## Key rotation

To rotate the encryption key:

1. Decrypt all passwords using the old key
2. Re-encrypt with the new key
3. Update the rows in the master DB
4. Switch the live key

```ts [scripts/rotate-keys.ts]
import { oldCipher, newCipher } from './cipher.js';

const tenants = await masterStore.findAll();

for (const tenant of tenants) {
  const plain = await oldCipher.decrypt(tenant.password);
  const reencrypted = await newCipher.encrypt(plain);
  await masterStore.update(tenant.id, { password: reencrypted });
}

console.log(`Rotated ${tenants.length} tenant keys.`);
```

Run this script during a maintenance window or in a rolling fashion before deploying the new key.

---

## Testing without encryption

In tests and local development, skip the cipher entirely — the adapter works with plaintext passwords by default:

```ts
const registry = await TenantRegistry.create({
  master: masterStore,
  adapter,
  // No cipher — passwords are stored and used as-is
});
```
