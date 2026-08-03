import * as localForage from 'localforage';

/** AES-GCM blob written to folder backup meta (no plaintext passwords). */
export interface FolderBackupSecretsBlob {
  v: 1;
  /** PBKDF2 salt (base64). */
  salt: string;
  /** AES-GCM IV (base64). */
  iv: string;
  /** Ciphertext of JSON { gmPassword, userPassword, guestPassword } (base64). */
  data: string;
}

export interface FolderBackupSecretPayload {
  gmPassword: string;
  userPassword: string;
  guestPassword: string;
}

/**
 * Encrypts role passwords for folder-backup meta.json.
 * Master secret stays in localForage (this browser/origin only).
 * Each write uses a fresh salt + IV via PBKDF2 → AES-GCM.
 */
export class FolderBackupCrypto {
  static readonly STORAGE_KEY = 'udonarium.folderBackup.masterSecret';
  private static readonly PBKDF2_ITERATIONS = 120000;

  static async encrypt(payload: FolderBackupSecretPayload): Promise<FolderBackupSecretsBlob> {
    const master = await this.getOrCreateMasterSecret();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(master, salt);
    const plain = new TextEncoder().encode(JSON.stringify({
      gmPassword: String(payload.gmPassword || ''),
      userPassword: String(payload.userPassword || ''),
      guestPassword: String(payload.guestPassword || ''),
    }));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return {
      v: 1,
      salt: this.toBase64(salt),
      iv: this.toBase64(iv),
      data: this.toBase64(new Uint8Array(cipher)),
    };
  }

  static async decrypt(blob: FolderBackupSecretsBlob): Promise<FolderBackupSecretPayload | null> {
    if (!blob || blob.v !== 1 || !blob.salt || !blob.iv || !blob.data) return null;
    try {
      const master = await this.getOrCreateMasterSecret();
      const salt = this.fromBase64(blob.salt);
      const iv = this.fromBase64(blob.iv);
      const data = this.fromBase64(blob.data);
      const key = await this.deriveKey(master, salt);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as FolderBackupSecretPayload;
      return {
        gmPassword: String(parsed?.gmPassword || ''),
        userPassword: String(parsed?.userPassword || ''),
        guestPassword: String(parsed?.guestPassword || ''),
      };
    } catch (e) {
      console.warn('FolderBackupCrypto decrypt failed (other browser/device or corrupted meta)', e);
      return null;
    }
  }

  private static async getOrCreateMasterSecret(): Promise<Uint8Array> {
    const existing = await localForage.getItem<string>(this.STORAGE_KEY);
    if (typeof existing === 'string' && existing.length > 0) {
      return this.fromBase64(existing);
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await localForage.setItem(this.STORAGE_KEY, this.toBase64(bytes));
    return bytes;
  }

  private static async deriveKey(master: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey('raw', master, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private static toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  private static fromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
}
