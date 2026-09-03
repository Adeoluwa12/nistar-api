import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || 'nistar-dev-key-replace-in-production!';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptField(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptField(encrypted: string): string | null {
  try {
    const key = getKey();
    const [ivHex, dataHex] = encrypted.split(':');
    if (!ivHex || !dataHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    return null;
  }
}
