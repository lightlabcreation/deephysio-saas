/**
 * Canonical WhatsApp Phone & Contact Identity Normalization
 * 
 * Enforces the core rule:
 * SAME WHATSAPP NUMBER -> SAME CANONICAL IDENTIFIER
 * 
 * Examples:
 * +91 62604 00951 -> 916260400951
 * 9196260400951   -> 9196260400951
 * +91-62604-00951 -> 916260400951
 * 06260400951     -> 916260400951
 * 6260400951      -> 916260400951
 * 
 * Groups:
 * 120363424690734342@g.us -> 120363424690734342@g.us
 */

const normalizeWhatsAppPhone = (rawInput) => {
  if (!rawInput) return null;
  const str = String(rawInput).trim();

  // 1. WhatsApp Groups: Keep canonical JID format (${groupId}@g.us)
  if (str.endsWith('@g.us') || str.startsWith('120363')) {
    const base = str.replace(/@.*$/, '').replace(/[^\d-]/g, '');
    return `${base}@g.us`;
  }

  // 2. Extract digits only (removing any @lid or @s.whatsapp.net suffix)
  let cleaned = str.replace(/@.*$/, '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // 3. Remove leading zero from 11-digit numbers (e.g. 09876543210 -> 9876543210)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }

  // 4. Standard 10-digit Indian phone number -> canonical 91 prefix
  if (cleaned.length === 10) {
    return '91' + cleaned;
  }

  // 5. 11 digits with extra prefix/typo -> use last 10 digits with 91 prefix
  if (cleaned.length === 11 && !cleaned.startsWith('91')) {
    return '91' + cleaned.slice(-10);
  }

  // 6. 12 digits starting with 91 -> canonical format
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return cleaned;
  }

  // 7. General E.164 digits without +
  return cleaned.length >= 7 ? cleaned : (cleaned.length > 0 ? cleaned : null);
};

/**
 * Format canonical phone number for display
 */
const formatPhoneDisplay = (rawPhone) => {
  if (!rawPhone) return '';
  const str = String(rawPhone).trim();
  if (str.endsWith('@g.us') || str.startsWith('120363')) {
    return 'WhatsApp Group';
  }
  const digits = str.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2);
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return str.startsWith('+') ? str : `+${digits}`;
};

module.exports = {
  normalizeWhatsAppPhone,
  formatPhoneDisplay
};
