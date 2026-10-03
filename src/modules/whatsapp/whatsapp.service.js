const path = require('path');
const fs = require('fs');
const pino = require('pino');
const qrcode = require('qrcode');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const prisma = require('../../config/prisma');

// Base directory for persisting tenant-isolated WhatsApp session credentials
const SESSIONS_BASE_DIR = path.resolve(__dirname, '../../../storage/whatsapp_sessions');

if (!fs.existsSync(SESSIONS_BASE_DIR)) {
  fs.mkdirSync(SESSIONS_BASE_DIR, { recursive: true });
}

// In-memory registry of active Baileys socket sessions: tenantId (Number) -> session object
const activeSessions = new Map();

// Guard against overlapping reconnection attempts: tenantId -> true (reconnect in progress)
const reconnectingGuard = new Map();

// Track consecutive conflict errors per tenant: tenantId -> { count, lastTime }
const conflictCounters = new Map();
const MAX_CONFLICT_RETRIES = 5;
const BASE_RECONNECT_DELAY_MS = 2000;

const { normalizeWhatsAppPhone, formatPhoneDisplay } = require('../../utils/phoneUtils');
const normalizePhoneNumber = normalizeWhatsAppPhone;

/**
 * Resolve WhatsApp LID (Linked Device Identifier) to canonical phone number.
 * WhatsApp multi-device often delivers messages with JIDs like 280319764775100@lid.
 * Baileys maps these in session storage (lid-mapping-*_reverse.json).
 * This function resolves the LID to the canonical phone number (e.g. 916260400951).
 */
const resolveLidToPhone = (tenantId, rawJidOrPhone) => {
  if (!rawJidOrPhone) return null;
  const str = String(rawJidOrPhone).trim();
  if (str.endsWith('@g.us') || str.startsWith('120363')) {
    return normalizeWhatsAppPhone(str);
  }

  const tid = parseInt(tenantId, 10);
  const mem = activeSessions.get(tid);
  const clean = str.replace(/@.*$/, '').replace(/\D/g, '');

  // 1. If standard phone number format (10 or 12 digits), normalize directly
  if (clean.length === 10 || (clean.length === 12 && clean.startsWith('91'))) {
    return normalizeWhatsAppPhone(clean);
  }

  // 2. Check in-memory lidMap for this tenant session
  if (mem?.lidMap?.has(clean)) {
    return normalizeWhatsAppPhone(mem.lidMap.get(clean));
  }

  // 3. If LID (13+ digits not starting with 91), check disk reverse-mapping file
  if (clean.length >= 13 && !clean.startsWith('91')) {
    const sessionDir = path.join(SESSIONS_BASE_DIR, `tenant_${tid}`);
    const revFile = path.join(sessionDir, `lid-mapping-${clean}_reverse.json`);
    if (fs.existsSync(revFile)) {
      try {
        const mapped = JSON.parse(fs.readFileSync(revFile, 'utf-8'));
        if (mapped) {
          const canonical = normalizeWhatsAppPhone(mapped);
          if (mem) {
            if (!mem.lidMap) mem.lidMap = new Map();
            mem.lidMap.set(clean, canonical);
          }
          return canonical;
        }
      } catch (_) {}
    }
  }

  return normalizeWhatsAppPhone(str);
};

// Profile picture memory cache: tenantId_jid -> { url, timestamp }
const profilePicCache = new Map();

/**
 * Fetch WhatsApp profile picture for contact / group
 */
const getProfilePictureUrl = async (tenantId, rawJidOrPhone) => {
  const tid = parseInt(tenantId, 10);
  const mem = activeSessions.get(tid);
  if (!mem?.sock || mem.status !== 'CONNECTED' || !rawJidOrPhone) return null;

  const key = `${tid}_${rawJidOrPhone}`;
  const cached = profilePicCache.get(key);
  if (cached && (Date.now() - cached.timestamp < 1800000)) {
    return cached.url;
  }

  try {
    let targetJid = String(rawJidOrPhone).trim();
    if (!targetJid.includes('@')) {
      if (targetJid.startsWith('120363')) {
        targetJid = `${targetJid}@g.us`;
      } else if (targetJid.length >= 14 && !targetJid.startsWith('91')) {
        targetJid = `${targetJid}@lid`;
      } else {
        const clean = targetJid.replace(/\D/g, '');
        targetJid = `${clean}@s.whatsapp.net`;
      }
    }

    let url = null;
    try {
      url = await mem.sock.profilePictureUrl(targetJid, 'image');
    } catch (_) {
      try {
        url = await mem.sock.profilePictureUrl(targetJid, 'preview');
      } catch (_) {}
    }

    profilePicCache.set(key, { url: url || null, timestamp: Date.now() });
    return url || null;
  } catch (_) {
    profilePicCache.set(key, { url: null, timestamp: Date.now() });
    return null;
  }
};

/**
 * Get tenant session storage directory
 */
const getTenantSessionDir = (tenantId) => {
  const dir = path.join(SESSIONS_BASE_DIR, `tenant_${tenantId}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

/**
 * Remove tenant session files from disk safely
 */
const removeTenantSessionDir = (tenantId) => {
  const dir = path.join(SESSIONS_BASE_DIR, `tenant_${tenantId}`);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[WhatsApp Service] Warning removing session dir for tenant #${tenantId}:`, err.message);
  }
};

/**
 * Query or initialize tenant WhatsApp record from database
 */
const getTenantDbRecord = async (tenantId) => {
  const tid = parseInt(tenantId, 10);
  if (!tid || isNaN(tid)) {
    throw new Error('Valid tenant ID is required.');
  }

  const rows = await prisma.$queryRawUnsafe(
    'SELECT * FROM whatsapp_connections WHERE tenant_id = ? LIMIT 1',
    tid
  );

  if (rows && rows.length > 0) {
    return rows[0];
  }

  // Create default record if not present
  await prisma.$executeRawUnsafe(
    'INSERT INTO whatsapp_connections (tenant_id, status) VALUES (?, ?)',
    tid,
    'DISCONNECTED'
  );

  const created = await prisma.$queryRawUnsafe(
    'SELECT * FROM whatsapp_connections WHERE tenant_id = ? LIMIT 1',
    tid
  );
  return created[0];
};

/**
 * Update tenant WhatsApp connection status in database
 */
const updateTenantDbStatus = async (tenantId, fields = {}) => {
  const tid = parseInt(tenantId, 10);
  if (!tid || isNaN(tid)) return;

  const sets = [];
  const values = [];

  for (const [key, val] of Object.entries(fields)) {
    sets.push(`\`${key}\` = ?`);
    values.push(val);
  }

  if (sets.length === 0) return;

  values.push(tid);
  await prisma.$executeRawUnsafe(
    `UPDATE whatsapp_connections SET ${sets.join(', ')} WHERE tenant_id = ?`,
    ...values
  );
};

/**
 * Ensure WhatsApp session is active in memory for a tenant if credentials exist
 */
const ensureTenantSession = async (tenantId) => {
  const tid = parseInt(tenantId, 10);
  if (!tid || isNaN(tid)) return false;

  const mem = activeSessions.get(tid);
  if (mem?.status === 'CONNECTED' && mem?.sock) {
    return true;
  }

  // Check if session directory and creds.json exist on disk
  const sessionDir = path.join(SESSIONS_BASE_DIR, `tenant_${tid}`);
  const credsFile = path.join(sessionDir, 'creds.json');
  if (!fs.existsSync(credsFile)) {
    return false;
  }

  // Guard against overlapping reconnection attempts
  if (reconnectingGuard.get(tid)) {
    return false;
  }

  const dbRecord = await getTenantDbRecord(tid);
  let targetPhone = dbRecord?.phone_number;

  // If phone not in DB, extract from creds.json
  if (!targetPhone) {
    try {
      const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      const meJid = credsData?.me?.id;
      if (meJid) {
        targetPhone = meJid.split(':')[0].replace(/\D/g, '');
      }
    } catch (_) {}
  }

  if (!targetPhone) return false;

  console.log(`🔄 [WhatsApp Service] Ensuring and auto-reconnecting session for Tenant #${tid} (${targetPhone})...`);
  reconnectingGuard.set(tid, true);
  try {
    startTenantConnection(tid, targetPhone, false).catch((err) => {
      console.warn(`[WhatsApp Service] Session ensure error for Tenant #${tid}:`, err.message);
    }).finally(() => {
      reconnectingGuard.delete(tid);
    });
    return true;
  } catch (err) {
    reconnectingGuard.delete(tid);
    return false;
  }
};

/**
 * Get current public connection status for tenant (never returns credentials/secrets)
 */
const getTenantStatus = async (tenantId) => {
  const tid = parseInt(tenantId, 10);
  if (!tid || isNaN(tid)) {
    return {
      status: 'DISCONNECTED',
      connected: false,
      isReady: false,
      tenantId: null,
      phoneNumber: null,
      connectedAt: null,
      lastSeenAt: null,
      lastError: null,
      notificationsEnabled: false,
      hasActiveQr: false,
      qrCode: null,
      pairingCode: null,
      message: 'No tenant context.'
    };
  }

  const dbRecord = await getTenantDbRecord(tid);
  const activeMem = activeSessions.get(tid);

  const sessionDir = path.join(SESSIONS_BASE_DIR, `tenant_${tid}`);
  const credsFile = path.join(sessionDir, 'creds.json');
  const hasSavedCreds = fs.existsSync(credsFile);

  const isSocketLive = Boolean(activeMem?.status === 'CONNECTED' && activeMem?.sock);

  // If we have saved credentials on disk but no live socket, trigger auto-reconnection
  if (hasSavedCreds && !isSocketLive) {
    ensureTenantSession(tid);
  }

  let currentStatus = 'DISCONNECTED';
  if (isSocketLive) {
    currentStatus = 'CONNECTED';
  } else if (hasSavedCreds && (dbRecord?.status === 'CONNECTED' || activeMem?.status === 'CONNECTED')) {
    currentStatus = 'CONNECTED';
  } else if (activeMem?.status === 'CONNECTING' || hasSavedCreds) {
    currentStatus = 'CONNECTING';
  } else if (activeMem?.status === 'QR_READY') {
    currentStatus = 'QR_READY';
  } else if (dbRecord?.status === 'QR_READY' && dbRecord?.qr_code) {
    currentStatus = 'QR_READY';
  } else {
    currentStatus = 'DISCONNECTED';
    if (dbRecord?.status === 'CONNECTED' && !hasSavedCreds) {
      // Out of sync: DB says connected but no creds file exists -> update DB
      updateTenantDbStatus(tid, { status: 'DISCONNECTED' }).catch(() => {});
    }
  }

  const isConnected = currentStatus === 'CONNECTED';
  const qrCode = (currentStatus === 'QR_READY' ? (activeMem?.qrDataUrl || dbRecord?.qr_code) : null);

  let statusMsg = 'WhatsApp is online and ready.';
  if (currentStatus === 'CONNECTED' && !isSocketLive) {
    statusMsg = 'WhatsApp session is reconnecting in background...';
  } else if (currentStatus === 'CONNECTING') {
    statusMsg = 'WhatsApp is reconnecting...';
  } else if (currentStatus === 'QR_READY') {
    statusMsg = 'Please scan QR code to link your phone.';
  } else if (currentStatus === 'DISCONNECTED') {
    statusMsg = 'WhatsApp is offline. Reconnect required.';
  }

  return {
    status: currentStatus,
    connected: isConnected,
    isReady: isSocketLive,
    tenantId: tid,
    phoneNumber: isConnected ? (activeMem?.phoneNumber || dbRecord?.phone_number || null) : (activeMem?.phoneNumber || null),
    connectedAt: isConnected ? (dbRecord?.connected_at || null) : null,
    lastSeenAt: isConnected ? (dbRecord?.last_seen_at || null) : null,
    lastError: null,
    notificationsEnabled: Boolean(dbRecord?.notifications_enabled !== 0 && dbRecord?.notifications_enabled !== false),
    hasActiveQr: Boolean(currentStatus === 'QR_READY' && qrCode),
    qrCode,
    pairingCode: activeMem?.pairingCode || null,
    message: statusMsg
  };
};

/**
 * Get current QR code Data URL for tenant
 */
const getTenantQr = async (tenantId) => {
  const tid = parseInt(tenantId, 10);
  const activeMem = activeSessions.get(tid);
  const dbRecord = await getTenantDbRecord(tid);

  const status = activeMem?.status || dbRecord.status || 'DISCONNECTED';
  const qrCode = activeMem?.qrDataUrl || dbRecord.qr_code || null;

  return {
    status,
    qrCode: status === 'QR_READY' ? qrCode : null,
    phoneNumber: dbRecord.phone_number || activeMem?.phoneNumber || null
  };
};

/**
 * Start or initiate a WhatsApp connection session for a tenant
 */
const startTenantConnection = async (tenantId, rawPhoneNumber, isFreshStart = false) => {
  const tid = parseInt(tenantId, 10);
  const normalizedPhone = normalizePhoneNumber(rawPhoneNumber);

  if (!normalizedPhone) {
    throw new Error('Please provide a valid WhatsApp phone number with country code (e.g. +91 9876543210).');
  }

  // 0. Ensure number is unique to this tenant by cleanly releasing it from any other tenant
  const phoneDigits10 = normalizedPhone.replace(/\D/g, '').slice(-10);

  // If another tenant had an active socket session with this number, cleanly close it
  for (const [otherTid, otherMem] of activeSessions.entries()) {
    if (otherTid !== tid && otherMem.phoneNumber) {
      const otherDigits10 = String(otherMem.phoneNumber).replace(/\D/g, '').slice(-10);
      if (otherDigits10 === phoneDigits10) {
        try {
          if (otherMem.sock) {
            otherMem.sock.ev.removeAllListeners();
            otherMem.sock.end();
          }
        } catch (_) {}
        activeSessions.delete(otherTid);
      }
    }
  }

  // Cleanly release the number from any prior tenant in database
  await prisma.$executeRawUnsafe(
    'UPDATE whatsapp_connections SET status = ?, phone_number = NULL, qr_code = NULL, last_error = ? WHERE tenant_id != ? AND phone_number LIKE ?',
    'DISCONNECTED',
    'WhatsApp session reassigned to another clinic workspace.',
    tid,
    `%${phoneDigits10}%`
  );

  // 1. Prevent duplicate connections if already connected
  const existing = activeSessions.get(tid);
  if (existing?.status === 'CONNECTED' && existing.sock) {
    return {
      status: 'CONNECTED',
      phoneNumber: existing.phoneNumber,
      message: 'WhatsApp is already actively connected.'
    };
  }

  // Clean old socket if exists in other states
  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners();
      existing.sock.end();
    } catch (_) {}
  }
  activeSessions.delete(tid);

  // Purge session files ONLY if this is a fresh user-initiated connection attempt
  if (isFreshStart) {
    removeTenantSessionDir(tid);
  }

  const sessionDir = getTenantSessionDir(tid);

  // 2. Set status to CONNECTING in memory and DB
  activeSessions.set(tid, {
    status: 'CONNECTING',
    phoneNumber: normalizedPhone,
    qrDataUrl: null,
    sock: null,
    startedAt: Date.now()
  });

  await updateTenantDbStatus(tid, {
    status: 'CONNECTING',
    phone_number: normalizedPhone,
    qr_code: null,
    last_error: null
  });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    const silentLogger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      auth: state,
      logger: silentLogger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 15000,
      qrTimeout: 120000,
      retryRequestDelayMs: 350,
      generateHighQualityLinkPreview: true
    });

    const memSession = activeSessions.get(tid) || {};
    memSession.sock = sock;
    activeSessions.set(tid, memSession);

    // Save auth credentials whenever Baileys emits update
    sock.ev.on('creds.update', saveCreds);

    // Helper: Recursively unwrap wrapped Baileys message containers
    const unwrapRawMessage = (m) => {
      if (!m) return null;
      if (m.ephemeralMessage?.message) return unwrapRawMessage(m.ephemeralMessage.message);
      if (m.viewOnceMessage?.message) return unwrapRawMessage(m.viewOnceMessage.message);
      if (m.viewOnceMessageV2?.message) return unwrapRawMessage(m.viewOnceMessageV2.message);
      if (m.viewOnceMessageV2Extension?.message) return unwrapRawMessage(m.viewOnceMessageV2Extension.message);
      if (m.documentWithCaptionMessage?.message) return unwrapRawMessage(m.documentWithCaptionMessage.message);
      if (m.editedMessage?.message?.protocolMessage?.editedMessage) return unwrapRawMessage(m.editedMessage.message.protocolMessage.editedMessage);
      return m;
    };

    // Helper: Extract text or media description from Baileys message payload
    const extractMessageContent = (msg) => {
      if (!msg || !msg.message) return null;
      const m = unwrapRawMessage(msg.message);
      if (!m) return null;

      return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        (m.imageMessage ? '📷 [Image attachment]' : null) ||
        (m.videoMessage ? '🎥 [Video attachment]' : null) ||
        (m.audioMessage ? '🎵 [Voice Note / Audio]' : null) ||
        (m.documentMessage ? `📎 [Document: ${m.documentMessage.fileName || 'file'}]` : null) ||
        (m.stickerMessage ? '🎨 [Sticker]' : null) ||
        (m.contactMessage ? `👤 [Contact: ${m.contactMessage.displayName || 'Card'}]` : null) ||
        (m.contactsArrayMessage ? '👥 [Contacts]' : null) ||
        (m.locationMessage ? '📍 [Location shared]' : null) ||
        (m.liveLocationMessage ? '📍 [Live Location]' : null) ||
        (m.reactionMessage ? `❤️ Reacted: ${m.reactionMessage.text || ''}` : null) ||
        (m.pollCreationMessage ? `📊 [Poll: ${m.pollCreationMessage.name || 'Poll'}]` : null) ||
        (typeof m === 'string' ? m : null) ||
        null
      );
    };

    // 1. Live Inbound & Outbound WhatsApp Messages (messages.upsert)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      try {
        if (!Array.isArray(messages)) return;
        for (const msg of messages) {
          if (!msg.message) continue;
          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) continue;

          const text = extractMessageContent(msg);
          if (!text) continue;

          const fromMe = Boolean(msg.key.fromMe);
          const isGroup = remoteJid.endsWith('@g.us');
          const pushName = msg.pushName || (fromMe ? 'Clinic Staff' : 'WhatsApp Contact');
          
          let cleanPhone = isGroup 
            ? normalizeWhatsAppPhone(remoteJid) 
            : (resolveLidToPhone(tid, remoteJid) || normalizeWhatsAppPhone(remoteJid));
          let recipientName = pushName;
          let recipientType = fromMe ? (isGroup ? 'GROUP_OUTBOUND' : 'OUTBOUND') : (isGroup ? 'GROUP_INBOUND' : 'INBOUND');
          let eventType = isGroup ? 'WHATSAPP_GROUP_CHAT' : (fromMe ? 'WHATSAPP_CHAT_OUT' : 'WHATSAPP_CHAT_IN');
          let messageBody = text;

          if (isGroup) {
            let groupSubject = null;
            try {
              const mem = activeSessions.get(tid);
              if (mem?.groupMap?.has(remoteJid)) {
                groupSubject = mem.groupMap.get(remoteJid);
              } else if (sock.groupMetadata) {
                const meta = await sock.groupMetadata(remoteJid);
                groupSubject = meta?.subject || null;
                if (groupSubject) {
                  if (!mem.groupMap) mem.groupMap = new Map();
                  mem.groupMap.set(remoteJid, groupSubject);
                }
              }
            } catch (_) {}

            const gName = groupSubject || `WhatsApp Group (${remoteJid.split('@')[0].slice(-6)})`;
            recipientName = gName;
            if (!fromMe) {
              messageBody = `[${pushName}]: ${text}`;
            }
          } else {
            try {
              const mem = activeSessions.get(tid);
              // 1. Try contactMap first (covers LID-based contacts & regular contacts)
              if (mem?.contactMap) {
                const fromMap = mem.contactMap.get(remoteJid) ||
                                mem.contactMap.get(cleanPhone) ||
                                mem.contactMap.get(cleanPhone.replace(/\D/g, '').slice(-10));
                if (fromMap) recipientName = fromMap;
              }
              // 2. If pushName available and still generic, use it
              if ((recipientName === 'WhatsApp Contact' || recipientName === pushName) && pushName && pushName !== 'WhatsApp Contact') {
                recipientName = pushName;
              }
              // 3. Try matching patient by last 10 digits of normalized phone
              if (!recipientName || recipientName === 'WhatsApp Contact') {
                const phoneDigits = cleanPhone.replace(/\D/g, '');
                const phoneSuffix = phoneDigits.slice(-10);
                if (phoneSuffix && phoneSuffix.length >= 7) {
                  const patient = await prisma.patient.findFirst({
                    where: {
                      tenant_id: tid,
                      phone: { contains: phoneSuffix }
                    }
                  });
                  if (patient) {
                    recipientName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || pushName;
                  }
                }
              }
            } catch (_) {}
          }

          const msgId = msg.key.id || `wa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const existing = await prisma.$queryRawUnsafe(
            'SELECT id FROM whatsapp_notification_logs WHERE tenant_id = ? AND provider_message_id = ? LIMIT 1',
            tid,
            msgId
          );

          if (!existing || existing.length === 0) {
            await logNotification({
              tenantId: tid,
              recipientPhone: cleanPhone,
              recipientName: recipientName,
              recipientType: recipientType,
              eventType: eventType,
              messageBody: messageBody,
              status: fromMe ? 'SENT' : 'RECEIVED',
              providerMessageId: msgId
            });
            console.log(`💬 [WhatsApp Service] Logged ${recipientType} message (${cleanPhone}) for Tenant #${tid}`);
          }
        }
      } catch (err) {
        console.warn('[WhatsApp Service] Error in messages.upsert listener:', err.message);
      }
    });

    // 2. Sync Contacts and Chats for real names and group subjects
    sock.ev.on('contacts.upsert', (contacts) => {
      try {
        const mem = activeSessions.get(tid);
        if (!mem) return;
        if (!mem.contactMap) mem.contactMap = new Map();
        for (const c of contacts || []) {
          const name = c.name || c.notify || c.verifiedName;
          if (c.id && name) {
            const digits = c.id.replace(/\D/g, '');
            mem.contactMap.set(c.id, name);
            mem.contactMap.set(c.id.split('@')[0], name);
            if (digits.length >= 10) mem.contactMap.set(digits.slice(-10), name);
          }
        }
      } catch (_) {}
    });

    sock.ev.on('chats.upsert', (chats) => {
      try {
        const mem = activeSessions.get(tid);
        if (!mem) return;
        if (!mem.groupMap) mem.groupMap = new Map();
        for (const ch of chats || []) {
          if (ch.id && (ch.name || ch.subject)) {
            const subject = ch.name || ch.subject;
            mem.groupMap.set(ch.id, subject);
            mem.groupMap.set(ch.id.split('@')[0], subject);
          }
        }
      } catch (_) {}
    });

    // 3. Initial Message History Sync from mobile phone upon linking
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages }) => {
      try {
        const mem = activeSessions.get(tid);
        if (mem) {
          if (!mem.groupMap) mem.groupMap = new Map();
          if (!mem.contactMap) mem.contactMap = new Map();

          for (const ch of chats || []) {
            if (ch.id && (ch.name || ch.subject)) {
              const subject = ch.name || ch.subject;
              mem.groupMap.set(ch.id, subject);
              mem.groupMap.set(ch.id.split('@')[0], subject);
            }
          }

          for (const c of contacts || []) {
            const name = c.name || c.notify || c.verifiedName;
            if (c.id && name) {
              const digits = c.id.replace(/\D/g, '');
              mem.contactMap.set(c.id, name);
              mem.contactMap.set(c.id.split('@')[0], name);
              if (digits.length >= 10) mem.contactMap.set(digits.slice(-10), name);
            }
          }
        }

        if (!Array.isArray(messages) || messages.length === 0) return;
        console.log(`📥 [WhatsApp Service] Syncing ${messages.length} recent messages for Tenant #${tid}...`);
        const recentMessages = messages.slice(-40);
        for (const msg of recentMessages) {
          if (!msg.message) continue;
          const remoteJid = msg.key?.remoteJid;
          if (!remoteJid || remoteJid.includes('@broadcast') || remoteJid.includes('@newsletter')) continue;

          const text = extractMessageContent(msg);
          if (!text) continue;

          const fromMe = Boolean(msg.key.fromMe);
          const isGroup = remoteJid.endsWith('@g.us');
          const pushName = msg.pushName || (fromMe ? 'Clinic Staff' : 'WhatsApp Contact');
          const msgId = msg.key.id;
          let cleanPhone = isGroup 
            ? normalizeWhatsAppPhone(remoteJid) 
            : (resolveLidToPhone(tid, remoteJid) || normalizeWhatsAppPhone(remoteJid));
          let recipientName = pushName;
          let recipientType = fromMe ? (isGroup ? 'GROUP_OUTBOUND' : 'OUTBOUND') : (isGroup ? 'GROUP_INBOUND' : 'INBOUND');
          let eventType = isGroup ? 'WHATSAPP_GROUP_CHAT' : (fromMe ? 'WHATSAPP_CHAT_OUT' : 'WHATSAPP_CHAT_IN');
          let messageBody = text;

          if (isGroup) {
            const gName = mem?.groupMap?.get(remoteJid) || mem?.groupMap?.get(remoteJid.split('@')[0]) || `WhatsApp Group (${remoteJid.split('@')[0].slice(-6)})`;
            recipientName = gName;
            if (!fromMe) {
              messageBody = `[${pushName}]: ${text}`;
            }
          }

          const existing = await prisma.$queryRawUnsafe(
            'SELECT id FROM whatsapp_notification_logs WHERE tenant_id = ? AND provider_message_id = ? LIMIT 1',
            tid,
            msgId
          );

          if (!existing || existing.length === 0) {
            await logNotification({
              tenantId: tid,
              recipientPhone: cleanPhone,
              recipientName: recipientName,
              recipientType: recipientType,
              eventType: eventType,
              messageBody: messageBody,
              status: fromMe ? 'SENT' : 'RECEIVED',
              providerMessageId: msgId
            });
          }
        }
      } catch (histErr) {
        console.warn('[WhatsApp Service] History sync warning:', histErr.message);
      }
    });

    // Listen to connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Real QR Code emitted by Baileys
      if (qr) {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr, {
            margin: 2,
            scale: 7,
            color: { dark: '#0f172a', light: '#ffffff' }
          });

          const currentMem = activeSessions.get(tid);
          if (currentMem) {
            currentMem.status = 'QR_READY';
            currentMem.qrDataUrl = qrDataUrl;
            activeSessions.set(tid, currentMem);
          }

          await updateTenantDbStatus(tid, {
            status: 'QR_READY',
            qr_code: qrDataUrl,
            last_error: null
          });

          console.log(`📱 [WhatsApp Service] Real QR Code generated for Tenant #${tid}`);
        } catch (qrErr) {
          console.error(`[WhatsApp Service] Error generating QR DataURL for tenant #${tid}:`, qrErr);
        }
      }

      // Successful Authentication & Connection Opened
      if (connection === 'open') {
        const userJid = sock.user?.id || '';
        const detectedNumber = userJid.split(':')[0] || userJid.split('@')[0] || normalizedPhone;

        const currentMem = activeSessions.get(tid);
        if (currentMem) {
          currentMem.status = 'CONNECTED';
          currentMem.qrDataUrl = null;
          currentMem.phoneNumber = detectedNumber;
          activeSessions.set(tid, currentMem);
        }

        // Reset conflict counter on successful connection
        conflictCounters.delete(tid);
        reconnectingGuard.delete(tid);

        // Fetch all participating groups eagerly to cache real group subjects
        try {
          if (sock.groupFetchAllParticipating) {
            const participating = await sock.groupFetchAllParticipating();
            if (participating && currentMem) {
              if (!currentMem.groupMap) currentMem.groupMap = new Map();
              for (const [gJid, gData] of Object.entries(participating)) {
                if (gData?.subject) {
                  currentMem.groupMap.set(gJid, gData.subject);
                  currentMem.groupMap.set(gJid.split('@')[0], gData.subject);
                }
              }
            }
          }
        } catch (_) {}

        await updateTenantDbStatus(tid, {
          status: 'CONNECTED',
          phone_number: detectedNumber,
          qr_code: null,
          connected_at: new Date(),
          last_seen_at: new Date(),
          last_error: null
        });

        // Ensure connection registration log entry exists
        try {
          const existingWelcome = await prisma.$queryRawUnsafe(
            "SELECT id FROM whatsapp_notification_logs WHERE tenant_id = ? AND event_type = 'WHATSAPP_ACTIVATED' LIMIT 1",
            tid
          );
          if (!existingWelcome || existingWelcome.length === 0) {
            await logNotification({
              tenantId: tid,
              recipientPhone: detectedNumber,
              recipientName: 'Clinic WhatsApp Gateway',
              recipientType: 'SYSTEM',
              eventType: 'WHATSAPP_ACTIVATED',
              messageBody: `WhatsApp account (+${detectedNumber}) linked and actively monitoring messages. Automated attendance, appointment bookings, invoices, and care plans are live.`,
              status: 'CONNECTED',
              providerMessageId: `init-${Date.now()}`
            });
          }
        } catch (_) {}

        console.log(`✅ [WhatsApp Service] Tenant #${tid} WhatsApp CONNECTED successfully! Number: ${detectedNumber}`);
      }

      // Connection Closed / Error
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorReason = lastDisconnect?.error?.message || 'Connection closed';
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const isQrExpired = errorReason.includes('QR refs') || statusCode === 408 || statusCode === DisconnectReason.timedOut;
        const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515 || statusCode === 428;
        const isConflict = statusCode === 440;

        console.log(`⚠️ [WhatsApp Service] Connection closed for Tenant #${tid}. Code: ${statusCode}, Reason: ${errorReason}`);

        if (isLoggedOut) {
          activeSessions.delete(tid);
          reconnectingGuard.delete(tid);
          conflictCounters.delete(tid);
          removeTenantSessionDir(tid);
          await updateTenantDbStatus(tid, {
            status: 'DISCONNECTED',
            qr_code: null,
            last_error: 'WhatsApp account was logged out from mobile device.'
          });
        } else if (isQrExpired) {
          activeSessions.delete(tid);
          reconnectingGuard.delete(tid);
          conflictCounters.delete(tid);
          removeTenantSessionDir(tid);
          await updateTenantDbStatus(tid, {
            status: 'QR_EXPIRED',
            qr_code: null,
            last_error: 'QR code expired. Click "Reconnect WhatsApp" to generate a fresh QR code.'
          });
        } else if (isConflict) {
          // 440 = Another device/process connected with the same WhatsApp credentials.
          // Use limited retries with exponential backoff to avoid infinite loop.
          const counter = conflictCounters.get(tid) || { count: 0, lastTime: 0 };
          counter.count += 1;
          counter.lastTime = Date.now();
          conflictCounters.set(tid, counter);

          if (counter.count > MAX_CONFLICT_RETRIES) {
            console.error(`🛑 [WhatsApp Service] Tenant #${tid} exceeded max conflict retries (${MAX_CONFLICT_RETRIES}). Stopping reconnection.`);
            activeSessions.delete(tid);
            reconnectingGuard.delete(tid);
            conflictCounters.delete(tid);
            await updateTenantDbStatus(tid, {
              status: 'ERROR',
              last_error: 'WhatsApp session conflict: Another device or process is using this WhatsApp account. Please disconnect other sessions and reconnect.'
            });
          } else {
            // Check if a reconnect is already in progress for this tenant
            if (reconnectingGuard.get(tid)) {
              console.log(`⏳ [WhatsApp Service] Reconnect already in progress for Tenant #${tid}, skipping duplicate.`);
              return;
            }

            const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, counter.count - 1); // exponential backoff: 2s, 4s, 8s, 16s, 32s
            console.log(`🔄 [WhatsApp Service] Conflict #${counter.count}/${MAX_CONFLICT_RETRIES} for Tenant #${tid}. Retrying in ${delay}ms...`);
            activeSessions.delete(tid);
            reconnectingGuard.set(tid, true);

            await updateTenantDbStatus(tid, {
              status: 'CONNECTING',
              last_error: `Conflict detected (attempt ${counter.count}/${MAX_CONFLICT_RETRIES}). Reconnecting...`
            });

            setTimeout(() => {
              reconnectingGuard.delete(tid);
              startTenantConnection(tid, normalizedPhone, false).catch((err) => {
                console.error(`[WhatsApp Service] Conflict reconnect failed for Tenant #${tid}:`, err.message);
                reconnectingGuard.delete(tid);
              });
            }, delay);
          }
        } else if (isRestartRequired) {
          // Normal handshake completion or server restart after QR scan:
          // WhatsApp forces a reconnect so Baileys can authenticate with the newly signed keys!
          // Check if a reconnect is already in progress
          if (reconnectingGuard.get(tid)) {
            console.log(`⏳ [WhatsApp Service] Reconnect already in progress for Tenant #${tid}, skipping duplicate.`);
            return;
          }

          console.log(`🔄 [WhatsApp Service] Handshake restart (Code: ${statusCode}) for Tenant #${tid}. Reconnecting with saved credentials...`);
          activeSessions.delete(tid);
          reconnectingGuard.set(tid, true);

          await updateTenantDbStatus(tid, {
            status: 'CONNECTING',
            last_error: null
          });

          // Reconnect with existing credentials (isFreshStart = false)
          setTimeout(() => {
            reconnectingGuard.delete(tid);
            startTenantConnection(tid, normalizedPhone, false).catch((err) => {
              console.error(`[WhatsApp Service] Error during handshake reconnect for Tenant #${tid}:`, err.message);
              reconnectingGuard.delete(tid);
            });
          }, 1500);
        } else {
          // Temporary network failure or session refresh
          const currentMem = activeSessions.get(tid);
          if (currentMem && currentMem.status !== 'DISCONNECTED') {
            currentMem.status = 'ERROR';
            activeSessions.set(tid, currentMem);
          }
          reconnectingGuard.delete(tid);
          await updateTenantDbStatus(tid, {
            status: 'ERROR',
            last_error: errorReason
          });
        }
      }
    });

    return {
      status: 'CONNECTING',
      phoneNumber: normalizedPhone,
      message: 'WhatsApp connection initiated. QR code will be ready in a moment.'
    };
  } catch (err) {
    activeSessions.delete(tid);
    const isValidationError = err.message && (
      err.message.includes('already in use') || 
      err.message.includes('valid WhatsApp phone number')
    );
    if (!isValidationError) {
      await updateTenantDbStatus(tid, {
        status: 'ERROR',
        last_error: err.message
      });
    } else {
      await updateTenantDbStatus(tid, {
        status: 'DISCONNECTED',
        last_error: null
      });
    }
    throw err;
  }
};

/**
 * Disconnect WhatsApp session cleanly for a tenant
 */
const disconnectTenant = async (tenantId) => {
  const tid = parseInt(tenantId, 10);
  const memSession = activeSessions.get(tid);

  if (memSession?.sock) {
    try {
      memSession.sock.ev.removeAllListeners();
      await memSession.sock.logout().catch(() => {});
      memSession.sock.end();
    } catch (_) {}
  }

  activeSessions.delete(tid);
  removeTenantSessionDir(tid);

  await updateTenantDbStatus(tid, {
    status: 'DISCONNECTED',
    qr_code: null,
    last_error: null
  });

  console.log(`🛑 [WhatsApp Service] Tenant #${tid} disconnected and session cleared.`);

  return {
    success: true,
    status: 'DISCONNECTED',
    message: 'WhatsApp session disconnected successfully.'
  };
};

/**
 * Safely send a text message via tenant's connected WhatsApp session.
 * NON-BLOCKING: Never throws errors to callers; logs outcomes to whatsapp_notification_logs.
 */
const sendWhatsAppMessage = async ({
  tenantId,
  recipientPhone,
  recipientName = null,
  recipientType = 'PATIENT',
  eventType = 'NOTIFICATION',
  messageText
}) => {
  const tid = parseInt(tenantId, 10);
  const normalizedRecipient = normalizePhoneNumber(recipientPhone);

  if (!normalizedRecipient) {
    console.warn(`[WhatsApp Service] Skipped: Invalid recipient phone "${recipientPhone}" for Tenant #${tid}`);
    await logNotification({
      tenantId: tid,
      recipientPhone: recipientPhone || 'UNKNOWN',
      recipientName,
      recipientType,
      eventType,
      messageBody: messageText,
      status: 'SKIPPED',
      error: 'Invalid or missing phone number.'
    });
    return { success: false, status: 'SKIPPED', reason: 'Invalid phone number' };
  }

  let activeMem = activeSessions.get(tid);
  let isConnected = activeMem?.status === 'CONNECTED' && activeMem?.sock;

  if (!isConnected) {
    // Attempt automatic session recovery if credentials exist on disk
    const sessionDir = path.join(SESSIONS_BASE_DIR, `tenant_${tid}`);
    const credsFile = path.join(sessionDir, 'creds.json');
    if (fs.existsSync(credsFile)) {
      try {
        const conn = await prisma.$queryRawUnsafe(
          'SELECT phone_number FROM whatsapp_connections WHERE tenant_id = ? LIMIT 1',
          tid
        );
        if (conn && conn[0]?.phone_number) {
          console.log(`🔄 [WhatsApp Service] Auto-recovering session for Tenant #${tid} to dispatch message...`);
          await startTenantConnection(tid, conn[0].phone_number, false);
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 500));
            activeMem = activeSessions.get(tid);
            if (activeMem?.status === 'CONNECTED' && activeMem?.sock) {
              isConnected = true;
              break;
            }
          }
        }
      } catch (reconnErr) {
        console.warn(`[WhatsApp Service] Session auto-recovery warning:`, reconnErr.message);
      }
    }
  }

  if (!isConnected) {
    console.warn(`[WhatsApp Service] Cannot send: Tenant #${tid} WhatsApp session is not connected.`);
    const failedLog = await logNotification({
      tenantId: tid,
      recipientPhone: normalizedRecipient,
      recipientName,
      recipientType,
      eventType,
      messageBody: messageText,
      status: 'FAILED',
      error: 'WhatsApp gateway is offline or reconnecting.'
    });
    return {
      success: false,
      status: 'FAILED',
      error: 'WhatsApp is currently offline or reconnecting. Please check connection in WhatsApp Settings.',
      log: failedLog
    };
  }

  try {
    let jid;
    // Only treat as group if explicitly @g.us JID, recipient_type/eventType says GROUP, or starts with 120363.
    // LID-based 15+ digit IDs are individual contacts, NOT groups.
    const isGroupTarget = String(recipientPhone).includes('@g.us') || 
                          String(recipientType).toUpperCase().includes('GROUP') || 
                          String(eventType).toUpperCase().includes('GROUP') ||
                          normalizedRecipient.startsWith('120363') ||
                          (typeof normalizedRecipient === 'string' && normalizedRecipient.endsWith('@g.us'));

    if (isGroupTarget) {
      const baseJid = normalizedRecipient.replace(/@.*$/, '');
      jid = `${baseJid}@g.us`;
    } else if (recipientPhone && String(recipientPhone).includes('@')) {
      jid = recipientPhone;
    } else if (normalizedRecipient.length >= 15 && !normalizedRecipient.startsWith('91')) {
      // LID-based contact (15+ digit ID, not a standard 91+10 Indian number)
      jid = `${normalizedRecipient}@lid`;
    } else {
      jid = `${normalizedRecipient}@s.whatsapp.net`;
    }

    let result;
    const attemptSend = async (targetJid) => {
      try {
        return await activeMem.sock.sendMessage(targetJid, { text: messageText });
      } catch (err) {
        if (err.message && (err.message.includes('Connection Closed') || err.message.includes('Connection Lost') || err.message.includes('Stream Errored'))) {
          console.log(`🔄 [WhatsApp Service] Connection closed during send, attempting quick reconnect for Tenant #${tid}...`);
          const sessionDir = path.join(SESSIONS_BASE_DIR, `tenant_${tid}`);
          const credsFile = path.join(sessionDir, 'creds.json');
          if (fs.existsSync(credsFile)) {
            const conn = await prisma.$queryRawUnsafe('SELECT phone_number FROM whatsapp_connections WHERE tenant_id = ? LIMIT 1', tid);
            if (conn && conn[0]?.phone_number) {
              await startTenantConnection(tid, conn[0].phone_number, false);
              for (let i = 0; i < 12; i++) {
                await new Promise((r) => setTimeout(r, 500));
                activeMem = activeSessions.get(tid);
                if (activeMem?.status === 'CONNECTED' && activeMem?.sock) {
                  return await activeMem.sock.sendMessage(targetJid, { text: messageText });
                }
              }
            }
          }
        }
        throw err;
      }
    };

    try {
      result = await attemptSend(jid);
    } catch (primaryErr) {
      // If error and not a group target, try alternate endpoint
      if (!isGroupTarget) {
        const alternateJid = jid.endsWith('@lid')
          ? `${normalizedRecipient}@s.whatsapp.net`
          : `${normalizedRecipient}@lid`;
        try {
          result = await attemptSend(alternateJid);
        } catch (_) {
          throw primaryErr;
        }
      } else {
        throw primaryErr;
      }
    }

    const logPhone = isGroupTarget ? jid : normalizedRecipient;
    await logNotification({
      tenantId: tid,
      recipientPhone: logPhone,
      recipientName,
      recipientType: isGroupTarget ? 'GROUP_OUTBOUND' : recipientType,
      eventType: isGroupTarget ? 'WHATSAPP_GROUP_CHAT' : eventType,
      messageBody: messageText,
      status: 'SENT',
      providerMessageId: result?.key?.id || null
    });

    console.log(`📤 [WhatsApp Service] Sent ${eventType} to ${logPhone} (Tenant #${tid})`);
    return { success: true, status: 'SENT', messageId: result?.key?.id };
  } catch (err) {
    const logPhone = normalizedRecipient;
    console.error(`❌ [WhatsApp Service] Failed to send to ${logPhone} (Tenant #${tid}):`, err.message);

    await logNotification({
      tenantId: tid,
      recipientPhone: logPhone,
      recipientName,
      recipientType,
      eventType,
      messageBody: messageText,
      status: 'FAILED',
      error: err.message
    });

    return { success: false, status: 'FAILED', error: err.message };
  }
};

/**
 * Log notification delivery into database
 */
const logNotification = async ({
  tenantId,
  recipientPhone,
  recipientName,
  recipientType,
  eventType,
  messageBody,
  status,
  providerMessageId = null,
  error = null
}) => {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_notification_logs 
       (tenant_id, recipient_phone, recipient_name, recipient_type, event_type, message_body, status, provider_message_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tenantId,
      recipientPhone,
      recipientName,
      recipientType,
      eventType,
      messageBody,
      status,
      providerMessageId,
      error
    );
  } catch (e) {
    console.warn('[WhatsApp Service] Warning saving notification log:', e.message);
  }
};

/**
 * Fetch all active participating WhatsApp groups for a tenant
 */
const getTenantGroups = async (tenantId) => {
  const tid = parseInt(tenantId, 10);
  const activeMem = activeSessions.get(tid);

  if (!activeMem?.sock || activeMem.status !== 'CONNECTED') {
    return [];
  }

  try {
    if (activeMem.sock.groupFetchAllParticipating) {
      const groupsObj = await activeMem.sock.groupFetchAllParticipating();
      if (!activeMem.groupMap) activeMem.groupMap = new Map();
      const groupList = [];

      for (const [jid, g] of Object.entries(groupsObj || {})) {
        const subject = g.subject || `WhatsApp Group (${jid.split('@')[0].slice(-6)})`;
        activeMem.groupMap.set(jid, subject);
        activeMem.groupMap.set(jid.split('@')[0], subject);

        groupList.push({
          jid,
          id: jid,
          subject,
          owner: g.owner,
          creation: g.creation,
          participantsCount: Array.isArray(g.participants) ? g.participants.length : 0,
          desc: g.desc || ''
        });
      }
      return groupList;
    }
  } catch (err) {
    console.warn(`[WhatsApp Service] Error fetching participating groups for Tenant #${tid}:`, err.message);
  }

  // Fallback from cache
  const fallback = [];
  if (activeMem.groupMap) {
    for (const [key, subject] of activeMem.groupMap.entries()) {
      if (key.includes('@g.us')) {
        fallback.push({
          jid: key,
          id: key,
          subject,
          participantsCount: 0
        });
      }
    }
  }
  return fallback;
};

/**
 * Fetch recent delivery logs for tenant
 */
const getTenantLogs = async (tenantId, limit = 500) => {
  const tid = parseInt(tenantId, 10);
  let rows = await prisma.$queryRawUnsafe(
    'SELECT * FROM whatsapp_notification_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?',
    tid,
    limit
  );

  const activeMem = activeSessions.get(tid);

  // If connected but no logs exist yet, add connection active notice so users see live connection
  if (!rows || rows.length === 0) {
    try {
      const conn = await prisma.$queryRawUnsafe(
        "SELECT phone_number, status, connected_at FROM whatsapp_connections WHERE tenant_id = ? AND status = 'CONNECTED' LIMIT 1",
        tid
      );
      if (conn && conn.length > 0 && conn[0].phone_number) {
        await logNotification({
          tenantId: tid,
          recipientPhone: conn[0].phone_number,
          recipientName: 'Clinic WhatsApp Gateway',
          recipientType: 'SYSTEM',
          eventType: 'WHATSAPP_ACTIVATED',
          messageBody: `WhatsApp account (+${conn[0].phone_number}) is actively connected and ready. Automated appointment bookings, attendance check-ins, payment receipts, and care plan alerts are live.`,
          status: 'CONNECTED',
          providerMessageId: `init-${Date.now()}`
        });

        rows = await prisma.$queryRawUnsafe(
          'SELECT * FROM whatsapp_notification_logs WHERE tenant_id = ? ORDER BY id DESC LIMIT ?',
          tid,
          limit
        );
      }
    } catch (_) {}
  }

  // Fetch tenant patients for quick accurate name resolution
  const patientMap = new Map();
  try {
    const pList = await prisma.patient.findMany({
      where: { tenant_id: tid },
      select: { id: true, first_name: true, last_name: true, phone: true, contact_number: true }
    });
    for (const p of pList) {
      const pPhone = String(p.phone || p.contact_number || '').replace(/\D/g, '');
      if (pPhone.length >= 10) {
        const full = `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Patient #${p.id}`;
        patientMap.set(pPhone.slice(-10), full);
      }
    }
  } catch (_) {}

  if (Array.isArray(rows)) {
    return rows.map((r) => {
      const rawPhone = String(r.recipient_phone || r.recipientPhone || '');
      const digits = rawPhone.replace(/\D/g, '');
      // Only treat as group if phone is @g.us JID, or starts with 120363 (real WA group IDs),
      // or recipient_type/event_type explicitly says GROUP.
      // LID-based individual chats (15+ digit IDs) are NOT groups.
      const isGroup = rawPhone.includes('@g.us') || 
                      digits.startsWith('120363') || 
                      String(r.recipient_type || '').toUpperCase().includes('GROUP') || 
                      String(r.event_type || '').toUpperCase().includes('GROUP');

      let groupSubject = null;
      let finalName = r.recipient_name || r.recipientName || '';

      if (isGroup) {
        if (activeMem?.groupMap) {
          groupSubject = activeMem.groupMap.get(rawPhone) || 
                         activeMem.groupMap.get(rawPhone.split('@')[0]) || 
                         activeMem.groupMap.get(`${digits}@g.us`) || 
                         activeMem.groupMap.get(digits);
        }
        finalName = groupSubject || (r.recipient_name && r.recipient_name.includes('Group') ? r.recipient_name : `WhatsApp Group (${digits.slice(-6)})`);
      } else {
        // For individual chats: try to match by last 10 digits OR full LID digits
        const suffix10 = digits.slice(-10);
        if (patientMap.has(suffix10)) {
          finalName = patientMap.get(suffix10);
        } else if (activeMem?.contactMap) {
          const fromMap = activeMem.contactMap.get(rawPhone) ||
                          activeMem.contactMap.get(rawPhone.split('@')[0]) ||
                          activeMem.contactMap.get(digits) ||
                          activeMem.contactMap.get(suffix10);
          if (fromMap) finalName = fromMap;
        }
        // If still empty, use the stored name if it looks valid
        if (!finalName || finalName === 'WhatsApp Contact') {
          const storedName = r.recipient_name || r.recipientName || '';
          if (storedName && storedName !== 'WhatsApp Contact' && storedName !== 'Clinic Staff') {
            finalName = storedName;
          }
        }
      }

      const canonicalPhone = isGroup 
        ? normalizeWhatsAppPhone(rawPhone) 
        : (resolveLidToPhone(tid, rawPhone) || normalizeWhatsAppPhone(rawPhone));

      return {
        ...r,
        recipient_phone: canonicalPhone,
        recipientPhone: canonicalPhone,
        recipient_name: finalName,
        recipientName: finalName,
        isGroup,
        groupSubject: isGroup ? finalName : null
      };
    });
  }

  return rows || [];
};

/**
 * Restore active WhatsApp sessions on server startup
 */
const restoreActiveSessionsOnStartup = async () => {
  try {
    const connectedRows = await prisma.$queryRawUnsafe(
      "SELECT * FROM whatsapp_connections WHERE phone_number IS NOT NULL"
    );

    if (!connectedRows || connectedRows.length === 0) return;

    console.log(`🔄 [WhatsApp Service] Checking ${connectedRows.length} WhatsApp sessions for startup recovery...`);

    // Deduplicate: Only connect ONE tenant per phone number to prevent conflict loops.
    // If multiple tenants share the same phone, only the first (lowest tenant_id) gets connected.
    const phoneToTenantMap = new Map();
    for (const record of connectedRows) {
      const tid = record.tenant_id;
      const sessionDir = path.join(SESSIONS_BASE_DIR, `tenant_${tid}`);
      const credsFile = path.join(sessionDir, 'creds.json');

      let targetPhone = record.phone_number;
      if (fs.existsSync(credsFile)) {
        try {
          const credsData = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
          const meJid = credsData?.me?.id;
          if (meJid) {
            const parsedPhone = meJid.split(':')[0].replace(/\D/g, '');
            if (parsedPhone && parsedPhone.length >= 10) {
              targetPhone = parsedPhone;
            }
          }
        } catch (_) {}
      }

      if (!targetPhone) continue;

      // Normalize to last 10 digits for deduplication
      const phoneKey = targetPhone.replace(/\D/g, '').slice(-10);
      if (!phoneToTenantMap.has(phoneKey)) {
        phoneToTenantMap.set(phoneKey, { tid, targetPhone, hasCredsFile: fs.existsSync(credsFile) });
      } else {
        // Duplicate phone — mark this tenant as disconnected and remove its session
        console.warn(`⚠️ [WhatsApp Service] Tenant #${tid} shares phone ${targetPhone} with Tenant #${phoneToTenantMap.get(phoneKey).tid}. Skipping and cleaning duplicate.`);
        removeTenantSessionDir(tid);
        await updateTenantDbStatus(tid, { status: 'DISCONNECTED', last_error: 'Duplicate WhatsApp number. Another tenant is using this number.' });
      }
    }

    // Now connect only unique phone owners
    for (const [, entry] of phoneToTenantMap) {
      const { tid, targetPhone, hasCredsFile } = entry;
      if (hasCredsFile) {
        try {
          console.log(`🔄 [WhatsApp Service] Auto-reconnecting Tenant #${tid} (${targetPhone})...`);
          await updateTenantDbStatus(tid, { phone_number: targetPhone });
          await startTenantConnection(tid, targetPhone, false);
          // Small delay between tenant connections to avoid overwhelming the system
          await new Promise((r) => setTimeout(r, 2000));
        } catch (reconnErr) {
          console.warn(`[WhatsApp Service] Auto-reconnect failed for Tenant #${tid}:`, reconnErr.message);
        }
      } else {
        // No creds file but marked as connected in DB
        const record = connectedRows.find((r) => r.tenant_id === tid);
        if (record?.status === 'CONNECTED') {
          await updateTenantDbStatus(tid, { status: 'DISCONNECTED' });
        }
      }
    }
  } catch (err) {
    console.warn('[WhatsApp Service] Startup restoration error:', err.message);
  }
};

/**
 * Request an 8-character pairing code for linking without camera / QR scanning
 */
const requestTenantPairingCode = async (tenantId, rawPhoneNumber) => {
  const tid = parseInt(tenantId, 10);
  const normalizedPhone = normalizePhoneNumber(rawPhoneNumber);
  if (!normalizedPhone) {
    throw new Error('Please enter a valid phone number with country code (e.g. +91 9876543210).');
  }

  // Ensure connection is initialized
  let mem = activeSessions.get(tid);
  if (!mem?.sock) {
    await startTenantConnection(tid, normalizedPhone, true);
    await new Promise((r) => setTimeout(r, 1500));
    mem = activeSessions.get(tid);
  }

  if (!mem?.sock) {
    throw new Error('Could not establish socket to WhatsApp servers. Please retry.');
  }

  const cleanDigits = normalizedPhone.replace(/\D/g, '');
  const code = await mem.sock.requestPairingCode(cleanDigits);
  const formattedCode = code ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

  mem.pairingCode = formattedCode;
  activeSessions.set(tid, mem);

  return {
    success: true,
    pairingCode: formattedCode,
    phoneNumber: normalizedPhone
  };
};

module.exports = {
  normalizePhoneNumber,
  getTenantStatus,
  getTenantQr,
  startTenantConnection,
  requestTenantPairingCode,
  disconnectTenant,
  sendWhatsAppMessage,
  getTenantLogs,
  getTenantGroups,
  getProfilePictureUrl,
  ensureTenantSession,
  restoreActiveSessionsOnStartup
};
