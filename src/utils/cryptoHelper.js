const crypto = require('crypto');

// 32-byte key derived from secret
const getEncryptionKey = () => {
  const secret = process.env.SMTP_SECRET || process.env.JWT_SECRET || 'deephysio-secure-key-32bytes-secret!';
  return crypto.createHash('sha256').update(String(secret)).digest();
};

/**
 * Encrypt a string using AES-256-CBC
 */
const encrypt = (plainText) => {
  if (!plainText) return '';
  try {
    const iv = crypto.randomBytes(16);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(String(plainText), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `enc:${iv.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('[CryptoHelper] Encryption error:', err.message);
    return plainText;
  }
};

/**
 * Decrypt a string encrypted with AES-256-CBC
 */
const decrypt = (cipherText) => {
  if (!cipherText) return '';
  if (typeof cipherText !== 'string' || !cipherText.startsWith('enc:')) {
    // Plain text or unencrypted
    return cipherText;
  }

  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return cipherText;
    const iv = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[CryptoHelper] Decryption error:', err.message);
    return cipherText;
  }
};

module.exports = {
  encrypt,
  decrypt
};
