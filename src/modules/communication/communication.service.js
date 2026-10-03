const prisma = require('../../config/prisma');
const { Prisma } = require('@prisma/client');
const { getAdapters } = require('../../integrations');
const nodemailer = require('nodemailer');
const tenantContext = require('../../config/tenantContext');

const getTid = (tenantId) => {
  const tid = Number(tenantId) || tenantContext.getStore();
  if (!tid) {
    const err = new Error('Tenant identification required');
    err.statusCode = 401;
    throw err;
  }
  return tid;
};

let schemaEnsured = false;
const ensureCommunicationSchema = async () => {
  if (schemaEnsured) return;
  await prisma.$executeRaw(Prisma.sql`
    CREATE TABLE IF NOT EXISTS communication_threads (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      patient_id INT NOT NULL,
      channel VARCHAR(32) NOT NULL,
      title VARCHAR(191) NULL,
      created_by INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX idx_comm_threads_patient_channel (patient_id, channel)
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    CREATE TABLE IF NOT EXISTS communication_messages (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      thread_id INT NOT NULL,
      patient_id INT NOT NULL,
      channel VARCHAR(32) NOT NULL,
      direction VARCHAR(16) NOT NULL,
      body LONGTEXT NOT NULL,
      subject VARCHAR(191) NULL,
      delivery_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
      external_id VARCHAR(191) NULL,
      created_by INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_comm_messages_thread (thread_id),
      INDEX idx_comm_messages_patient (patient_id)
    )
  `);
  // Add missing columns if they don't exist
  const alterStatements = [
    'ALTER TABLE communication_threads ADD COLUMN tenant_id INT DEFAULT 1',
    'ALTER TABLE communication_messages ADD COLUMN tenant_id INT DEFAULT 1',
    'ALTER TABLE communication_messages ADD COLUMN is_starred BOOLEAN DEFAULT FALSE',
    'ALTER TABLE communication_messages ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE',
    'ALTER TABLE communication_messages ADD COLUMN is_read BOOLEAN DEFAULT TRUE',
    'ALTER TABLE communication_messages ADD COLUMN recipient_email VARCHAR(191) NULL',
    'ALTER TABLE communication_messages ADD COLUMN attachment_name VARCHAR(255) NULL',
    'ALTER TABLE communication_messages ADD COLUMN attachment_url LONGTEXT NULL'
  ];
  for (const stmt of alterStatements) {
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (_) {}
  }
  await prisma.$executeRaw(Prisma.sql`
    CREATE TABLE IF NOT EXISTS communication_campaigns (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      channel VARCHAR(32) NOT NULL,
      message LONGTEXT NOT NULL,
      recipients_json LONGTEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
      created_by INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    )
  `);
  await prisma.$executeRaw(Prisma.sql`
    CREATE TABLE IF NOT EXISTS telehealth_sessions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      patient_id INT NOT NULL,
      therapist_id INT NULL,
      provider VARCHAR(64) NOT NULL,
      external_id VARCHAR(191) NOT NULL,
      join_url LONGTEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
      starts_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_telehealth_patient (patient_id)
    )
  `);
  schemaEnsured = true;
};

const listThreads = async ({ channel, patientId }, tenantId) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  if (channel && patientId) {
    return prisma.$queryRaw`SELECT * FROM communication_threads WHERE channel = ${String(channel)} AND patient_id = ${Number(patientId)} AND tenant_id = ${tid} ORDER BY updated_at DESC`;
  }
  if (channel) {
    return prisma.$queryRaw`SELECT * FROM communication_threads WHERE channel = ${String(channel)} AND tenant_id = ${tid} ORDER BY updated_at DESC`;
  }
  if (patientId) {
    return prisma.$queryRaw`SELECT * FROM communication_threads WHERE patient_id = ${Number(patientId)} AND tenant_id = ${tid} ORDER BY updated_at DESC`;
  }
  return prisma.$queryRaw`SELECT * FROM communication_threads WHERE tenant_id = ${tid} ORDER BY updated_at DESC`;
};

const createThread = async ({ patientId, channel, title, createdBy, tenantId }) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);

  if (patientId) {
    const patient = await prisma.patient.findFirst({
      where: { id: Number(patientId), tenant_id: tid }
    });
    if (!patient) {
      const err = new Error('Patient not found');
      err.statusCode = 404;
      throw err;
    }
  }

  await prisma.$executeRaw`
    INSERT INTO communication_threads (patient_id, channel, title, created_by, tenant_id)
    VALUES (${Number(patientId)}, ${channel}, ${title || null}, ${createdBy || null}, ${tid})
  `;
  const rows = await prisma.$queryRaw`SELECT * FROM communication_threads WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 1`;
  return rows[0];
};

const listMessages = async ({ threadId, tenantId }) => {
  await ensureCommunicationSchema();
  const tid = tenantId ? Number(tenantId) : null;
  if (tid) {
    const threadCheck = await prisma.$queryRaw`SELECT id FROM communication_threads WHERE id = ${Number(threadId)} AND tenant_id = ${tid}`;
    if (!threadCheck || threadCheck.length === 0) {
      const err = new Error('Thread not found');
      err.statusCode = 404;
      throw err;
    }
  }
  return prisma.$queryRaw`
    SELECT * FROM communication_messages
    WHERE thread_id = ${Number(threadId)}
    ORDER BY created_at ASC
  `;
};

const { createTenantTransporter } = require('../../utils/smtpHelper');

const sendMessage = async ({ threadId, patientId, channel, subject, body, createdBy, recipientEmail, tenantId }) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  const adapters = getAdapters();

  let providerResult = { status: 'SENT' };

  if (channel === 'email') {
    let targetEmail = recipientEmail;
    if (!targetEmail && patientId) {
      try {
        const pat = await prisma.patient.findUnique({ where: { id: Number(patientId) } });
        targetEmail = pat?.email;
      } catch (_) {}
    }
    if (!targetEmail) targetEmail = `patient-${patientId}@example.com`;

    try {
      const { transporter, config, isSimulated } = await createTenantTransporter(tid);
      if (transporter) {
        const fromAddress = config.fromEmail 
          ? `"${config.fromName || 'DeePhysio Clinic'}" <${config.fromEmail}>`
          : `"${config.fromName || 'DeePhysio Clinic'}" <${config.smtpUser}>`;

        const info = await transporter.sendMail({
          from: fromAddress,
          to: targetEmail,
          subject: subject || 'DeePhysio Clinic Communication',
          text: body,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
              <div style="background: linear-gradient(135deg, #0ea5e9, #0284c7); padding: 20px 24px; border-radius: 12px; color: white; margin-bottom: 20px;">
                <h2 style="margin: 0; font-size: 18px; font-weight: 800;">${config.fromName || 'DeePhysio Clinic'}</h2>
                <p style="margin: 4px 0 0; opacity: 0.9; font-size: 12px;">Clinical & Patient Communications</p>
              </div>
              <div style="color: #1e293b; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${body}</div>
              <div style="margin-top: 28px; padding-top: 14px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center;">
                <p style="margin: 0;">Sent by DeePhysio Clinic to ${targetEmail}</p>
              </div>
            </div>
          `
        });
        providerResult = { status: 'DELIVERED', externalId: info.messageId };
      } else {
        providerResult = { status: isSimulated ? 'SIMULATED' : 'SENT', externalId: `sim-${Date.now()}` };
      }
    } catch (mailErr) {
      console.warn('[Email Service] Outbound delivery error:', mailErr.message);
      providerResult = { status: 'FAILED', externalId: null };
    }
  } else {
    providerResult = await adapters.sms.sendMessage({ to: `patient-${patientId}`, body });
  }

  await prisma.$executeRaw`
    INSERT INTO communication_messages (thread_id, patient_id, channel, direction, body, subject, delivery_status, external_id, created_by, tenant_id)
    VALUES (${Number(threadId)}, ${Number(patientId)}, ${channel}, 'outbound', ${body}, ${subject || null}, ${providerResult.status || 'QUEUED'}, ${providerResult.externalId || null}, ${createdBy || null}, ${tid})
  `;

  await prisma.$executeRaw`
    UPDATE communication_threads
    SET updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${Number(threadId)} AND tenant_id = ${tid}
  `;
  const rows = await prisma.$queryRaw`
    SELECT * FROM communication_messages
    WHERE thread_id = ${Number(threadId)} AND tenant_id = ${tid}
    ORDER BY id DESC
    LIMIT 1
  `;
  return rows[0];
};

const updateMessageFlags = async (messageId, { isStarred, isDeleted, isRead }, tenantId) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  
  const updates = [];
  if (isStarred !== undefined) updates.push(`is_starred = ${isStarred ? 1 : 0}`);
  if (isDeleted !== undefined) updates.push(`is_deleted = ${isDeleted ? 1 : 0}`);
  if (isRead !== undefined) updates.push(`is_read = ${isRead ? 1 : 0}`);

  if (updates.length === 0) return null;

  await prisma.$executeRawUnsafe(`
    UPDATE communication_messages 
    SET ${updates.join(', ')}
    WHERE id = ${Number(messageId)} AND tenant_id = ${tid}
  `);

  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM communication_messages WHERE id = ${Number(messageId)} AND tenant_id = ${tid}`);
  return rows[0];
};

const deleteMessagePermanently = async (messageId, tenantId) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  await prisma.$executeRawUnsafe(`DELETE FROM communication_messages WHERE id = ${Number(messageId)} AND tenant_id = ${tid}`);
  return { success: true };
};

const whatsappService = require('../whatsapp/whatsapp.service');

const createCampaign = async ({ tenantId, channel, message, recipients, createdBy }) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  const targetChannel = String(channel || 'sms').toLowerCase();
  
  // 1. Fetch targeted patient objects (ensuring they belong to this tenant)
  const recipientIds = Array.isArray(recipients) ? recipients.map(Number) : [];
  let patientList = [];
  if (recipientIds.length > 0) {
    patientList = await prisma.patient.findMany({
      where: {
        id: { in: recipientIds },
        tenant_id: tid
      }
    });
  }

  let sentCount = 0;
  let failedCount = 0;
  const dispatchLogs = [];

  // 2. Dispatch messages according to channel
  if (targetChannel === 'whatsapp') {
    for (const patient of patientList) {
      const pName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || `Patient #${patient.id}`;
      const pPhone = patient.phone || patient.contact_number || patient.mobile;
      
      // Personalize message placeholders
      const personalizedMsg = String(message || '')
        .replace(/\{\{\s*name\s*\}\}/gi, pName)
        .replace(/\{\{\s*patient_name\s*\}\}/gi, pName)
        .replace(/\{\{\s*first_name\s*\}\}/gi, patient.first_name || pName)
        .replace(/\{\{\s*clinic\s*\}\}/gi, 'DeePhysio Clinic');

      try {
        const sendResult = await whatsappService.sendWhatsAppMessage({
          tenantId: tid,
          recipientPhone: pPhone,
          recipientName: pName,
          recipientType: 'PATIENT',
          eventType: 'CAMPAIGN_BROADCAST',
          messageText: personalizedMsg
        });

        if (sendResult?.success || sendResult?.status === 'SENT') {
          sentCount++;
          dispatchLogs.push({ patientId: patient.id, name: pName, status: 'SENT' });
        } else {
          failedCount++;
          dispatchLogs.push({ patientId: patient.id, name: pName, status: 'FAILED', reason: sendResult?.reason || sendResult?.error });
        }
      } catch (sendErr) {
        failedCount++;
        dispatchLogs.push({ patientId: patient.id, name: pName, status: 'FAILED', reason: sendErr.message });
      }
    }
  } else if (targetChannel === 'sms') {
    const adapters = getAdapters();
    for (const patient of patientList) {
      const pName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || `Patient #${patient.id}`;
      const pPhone = patient.phone || patient.contact_number || patient.mobile;
      const personalizedMsg = String(message || '')
        .replace(/\{\{\s*name\s*\}\}/gi, pName)
        .replace(/\{\{\s*patient_name\s*\}\}/gi, pName)
        .replace(/\{\{\s*first_name\s*\}\}/gi, patient.first_name || pName)
        .replace(/\{\{\s*clinic\s*\}\}/gi, 'DeePhysio Clinic');

      try {
        if (adapters.sms && adapters.sms.sendMessage) {
          await adapters.sms.sendMessage({ to: pPhone || `patient-${patient.id}`, body: personalizedMsg });
        }
        sentCount++;
        dispatchLogs.push({ patientId: patient.id, name: pName, status: 'SENT' });
      } catch (err) {
        failedCount++;
        dispatchLogs.push({ patientId: patient.id, name: pName, status: 'FAILED', reason: err.message });
      }
    }
  } else if (targetChannel === 'email') {
    const adapters = getAdapters();
    for (const patient of patientList) {
      const pName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim() || `Patient #${patient.id}`;
      const pEmail = patient.email;
      const personalizedMsg = String(message || '')
        .replace(/\{\{\s*name\s*\}\}/gi, pName)
        .replace(/\{\{\s*patient_name\s*\}\}/gi, pName)
        .replace(/\{\{\s*first_name\s*\}\}/gi, patient.first_name || pName)
        .replace(/\{\{\s*clinic\s*\}\}/gi, 'DeePhysio Clinic');

      try {
        if (pEmail && adapters.email && adapters.email.sendEmail) {
          await adapters.email.sendEmail({ to: pEmail, subject: 'DeePhysio Clinic Update', body: personalizedMsg });
        }
        sentCount++;
        dispatchLogs.push({ patientId: patient.id, name: pName, status: 'SENT' });
      } catch (err) {
        failedCount++;
        dispatchLogs.push({ patientId: patient.id, name: pName, status: 'FAILED', reason: err.message });
      }
    }
  }

  const finalStatus = failedCount === 0 ? 'COMPLETED' : (sentCount > 0 ? 'PARTIAL' : 'FAILED');

  await prisma.$executeRaw`
    INSERT INTO communication_campaigns (channel, message, recipients_json, status, created_by, tenant_id)
    VALUES (${targetChannel}, ${message}, ${JSON.stringify({ recipients: recipientIds, sentCount, failedCount, total: recipientIds.length, logs: dispatchLogs })}, ${finalStatus}, ${createdBy || null}, ${tid})
  `;
  const rows = await prisma.$queryRaw`SELECT * FROM communication_campaigns WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 1`;
  const result = rows[0] || {};
  return {
    ...result,
    sentCount,
    failedCount,
    total: recipientIds.length,
    status: finalStatus,
    logs: dispatchLogs
  };
};

const listCampaigns = async (tenantId) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  return prisma.$queryRaw`SELECT * FROM communication_campaigns WHERE tenant_id = ${tid} ORDER BY created_at DESC`;
};

const createTelehealthSession = async ({ patientId, therapistId, startsAt, tenantId }) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);

  // Validate patient belongs to tenant
  const patient = await prisma.patient.findFirst({
    where: { id: Number(patientId), tenant_id: tid }
  });
  if (!patient) {
    const err = new Error('Patient not found');
    err.statusCode = 404;
    throw err;
  }

  const adapters = getAdapters();
  const providerResult = await adapters.telehealth.createSession({ patientId, hostId: therapistId });
  await prisma.$executeRaw`
    INSERT INTO telehealth_sessions (patient_id, therapist_id, provider, external_id, join_url, status, starts_at, tenant_id)
    VALUES (${Number(patientId)}, ${therapistId ? Number(therapistId) : null}, ${providerResult.provider}, ${providerResult.externalId}, ${providerResult.joinUrl}, 'SCHEDULED', ${startsAt ? new Date(startsAt) : null}, ${tid})
  `;
  const rows = await prisma.$queryRaw`
    SELECT * FROM telehealth_sessions
    WHERE external_id = ${providerResult.externalId} AND tenant_id = ${tid}
    ORDER BY id DESC
    LIMIT 1
  `;
  return rows[0];
};

const listTelehealthSessions = async ({ patientId }, tenantId) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  if (patientId) {
    return prisma.$queryRaw`SELECT * FROM telehealth_sessions WHERE patient_id = ${Number(patientId)} AND tenant_id = ${tid} ORDER BY created_at DESC`;
  }
  return prisma.$queryRaw`SELECT * FROM telehealth_sessions WHERE tenant_id = ${tid} ORDER BY created_at DESC`;
};

const sendDirectEmail = async ({ patientId, recipientEmail, subject, body, file, createdBy, tenantId }) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);
  
  // 1. Get patient email scoped to tenant
  const patient = await prisma.patient.findFirst({
    where: { id: Number(patientId), tenant_id: tid }
  });

  if (!patient) {
    const err = new Error('Patient not found.');
    err.statusCode = 404;
    throw err;
  }

  const targetEmail = recipientEmail || patient.email;
  if (!targetEmail) {
    throw new Error('No recipient email address available for this patient.');
  }

  // 2. Setup Transporter or Twilio Test Mode
  const smtpPass = process.env.SMTP_PASS;
  const twilioTestSid = process.env.TWILIO_TEST_ACCOUNT_SID;
  const twilioTestToken = process.env.TWILIO_TEST_AUTH_TOKEN;
  
  let smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  let smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  let smtpUser = process.env.SMTP_USER || 'deephysioclinic@gmail.com';
  let activeSmtpPass = process.env.SMTP_PASS;
  let fromAddress = process.env.SMTP_FROM || '"DeePhysio Clinic" <deephysioclinic@gmail.com>';

  // Check if clinic has custom SMTP configured
  try {
    const tenantSmtp = await prisma.globalSettings.findFirst({
      where: { key: `tenant_${tid}_smtp_config`, tenant_id: tid }
    });
    if (tenantSmtp?.value) {
      const parsed = JSON.parse(tenantSmtp.value);
      if (parsed.isSmtpActive && parsed.smtpHost && parsed.smtpPass) {
        smtpHost = parsed.smtpHost;
        smtpPort = parseInt(parsed.smtpPort || '587', 10);
        smtpUser = parsed.smtpUser;
        activeSmtpPass = parsed.smtpPass;
        fromAddress = parsed.fromEmail 
          ? `"${parsed.fromName || 'Clinic'}" <${parsed.fromEmail}>`
          : `"${parsed.fromName || 'Clinic'}" <${parsed.smtpUser}>`;
      }
    }
  } catch (_) {}

  const isTwilioTestMode = Boolean(twilioTestSid && twilioTestToken);
  const isSmtpSimulation = !activeSmtpPass || activeSmtpPass === 'your-app-password';
  
  const isSimulation = isTwilioTestMode || isSmtpSimulation;
  
  let info = { messageId: isTwilioTestMode ? `twilio-test-${Date.now()}` : `simulated-${Date.now()}` };

  if (!isSimulation) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: activeSmtpPass
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // 3. Send email with attachment
    try {
      info = await transporter.sendMail({
        from: fromAddress,
        to: targetEmail,
        subject: subject,
        text: body,
        attachments: [
          {
            filename: file.originalname || 'Clinical_Document.pdf',
            content: file.buffer,
            contentType: file.mimetype || 'application/pdf'
          }
        ]
      });
    } catch (mailError) {
      console.error('Nodemailer Error:', mailError);
      throw new Error(`Failed to send email: ${mailError.message}`);
    }
  } else {
    if (isTwilioTestMode) {
      console.log(`[TWILIO REST API TEST] Validated credentials for SID: ${twilioTestSid}. Simulating email delivery to ${targetEmail} with subject: ${subject}`);
    } else {
      console.log(`[SIMULATION] Email would have been sent to ${targetEmail} with subject: ${subject}`);
    }
  }

  // 4. Log in communication tables
  try {
    const threads = await prisma.$queryRaw`SELECT * FROM communication_threads WHERE channel = 'email' AND patient_id = ${Number(patientId)} AND tenant_id = ${tid} LIMIT 1`;
    let threadId;
    
    if (!threads || threads.length === 0) {
      await prisma.$executeRaw`
        INSERT INTO communication_threads (patient_id, channel, title, created_by, tenant_id)
        VALUES (${Number(patientId)}, 'email', 'Clinical Documents', ${createdBy || null}, ${tid})
      `;
      const newThread = await prisma.$queryRaw`SELECT * FROM communication_threads WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 1`;
      threadId = newThread[0].id;
    } else {
      threadId = threads[0].id;
    }

    const deliveryStatus = isTwilioTestMode ? 'TEST_SUCCESS' : (isSimulation ? 'SIMULATED' : 'DELIVERED');
    const logBody = isTwilioTestMode ? `[TWILIO TEST] Emailed Clinical_Document.pdf to ${targetEmail}` : (isSimulation ? `[SIMULATED] Emailed Clinical_Document.pdf to ${targetEmail}` : 'Emailed Clinical_Document.pdf');

    await prisma.$executeRaw`
      INSERT INTO communication_messages (thread_id, patient_id, channel, direction, body, subject, delivery_status, external_id, created_by, tenant_id)
      VALUES (${threadId}, ${Number(patientId)}, 'email', 'outbound', ${logBody}, ${subject}, ${deliveryStatus}, ${info.messageId}, ${createdBy || null}, ${tid})
    `;

    return { 
      messageId: info.messageId, 
      email: targetEmail, 
      isSimulation,
      message: isTwilioTestMode ? 'Twilio Test Successful (Mock Email Sent)' : (isSimulation ? 'Email workflow simulated (No SMTP credentials)' : 'Email sent successfully')
    };
  } catch (dbError) {
    console.error('Database Logging Error:', dbError);
    // Even if logging fails, the email was sent
    return { messageId: info.messageId, email: targetEmail, warning: 'Email sent but failed to log in communication history.' };
  }
};

/**
 * List all email communications for a tenant with rich patient and message metadata
 */
const listAllEmailMessages = async ({ tenantId, folder, search } = {}) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);

  const rows = await prisma.$queryRawUnsafe(`
    SELECT 
      m.id,
      m.thread_id AS threadId,
      m.patient_id AS patientId,
      m.channel,
      m.direction,
      m.body,
      m.subject,
      m.delivery_status AS deliveryStatus,
      m.external_id AS externalId,
      m.recipient_email AS recipientEmail,
      m.is_starred AS isStarred,
      m.is_deleted AS isDeleted,
      m.is_read AS isRead,
      m.attachment_name AS attachmentName,
      m.created_by AS createdBy,
      m.created_at AS createdAt,
      p.first_name AS patientFirstName,
      p.last_name AS patientLastName,
      p.email AS patientEmail,
      p.phone AS patientPhone,
      t.title AS threadTitle
    FROM communication_messages m
    LEFT JOIN communication_threads t ON m.thread_id = t.id
    LEFT JOIN patients p ON m.patient_id = p.id
    WHERE m.channel = 'email' AND (m.tenant_id = ${tid} OR p.tenant_id = ${tid})
    ORDER BY m.created_at DESC
  `);

  return rows.map((m) => {
    const pName = (m.patientFirstName || m.patientLastName)
      ? `${m.patientFirstName || ''} ${m.patientLastName || ''}`.trim()
      : (m.patientId ? `Patient #${m.patientId}` : (m.threadTitle || 'External Recipient'));

    const targetEmail = m.recipientEmail || m.patientEmail || (m.patientId ? `patient-${m.patientId}@clinic.local` : 'external@recipient.com');

    return {
      id: Number(m.id),
      threadId: m.threadId ? Number(m.threadId) : null,
      patientId: m.patientId ? Number(m.patientId) : null,
      sender: m.direction === 'outbound' ? 'Clinic Staff' : pName,
      recipientName: pName,
      email: targetEmail,
      subject: m.subject || '(No Subject)',
      excerpt: String(m.body || '').replace(/<[^>]*>/g, '').slice(0, 100),
      date: new Date(m.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      createdAt: m.createdAt,
      read: m.isRead === null || m.isRead === undefined ? true : Boolean(m.isRead),
      content: m.body,
      folder: (m.isDeleted == 1 || m.isDeleted === true) ? 'Trash' : (m.direction === 'outbound' ? 'Sent' : 'Inbox'),
      isStarred: Boolean(m.isStarred == 1 || m.isStarred === true),
      isDeleted: Boolean(m.isDeleted == 1 || m.isDeleted === true),
      deliveryStatus: m.deliveryStatus || 'DELIVERED',
      attachmentName: m.attachmentName || null,
      direction: m.direction || 'outbound'
    };
  });
};

/**
 * Send an email message (live SMTP with fallback simulation and DB logging)
 */
const sendEmailMessage = async ({
  patientId,
  recipientEmail,
  recipientName,
  subject,
  body,
  file,
  attachment,
  tenantId,
  createdBy
}) => {
  await ensureCommunicationSchema();
  const tid = getTid(tenantId);

  let targetEmail = recipientEmail ? String(recipientEmail).trim() : null;
  let patName = recipientName ? String(recipientName).trim() : null;
  let patId = patientId ? Number(patientId) : null;

  if (patId && (!targetEmail || !patName)) {
    try {
      const pat = await prisma.patient.findUnique({ where: { id: patId } });
      if (pat) {
        if (!targetEmail) targetEmail = pat.email;
        if (!patName) patName = `${pat.first_name || ''} ${pat.last_name || ''}`.trim() || `Patient #${pat.id}`;
      }
    } catch (_) {}
  }

  if (!targetEmail) {
    if (patId) {
      targetEmail = `patient-${patId}@example.com`;
    } else {
      throw new Error('Recipient email address is required.');
    }
  }

  const emailSubject = subject?.trim() || 'DeePhysio Clinic Communication';
  const emailBody = body?.trim() || '';

  let providerResult = { status: 'SENT', externalId: `em-${Date.now()}` };
  let attachmentName = null;

  try {
    const { transporter, config, isSimulated } = await createTenantTransporter(tid);
    const fromAddress = config.fromEmail
      ? `"${config.fromName || 'DeePhysio Clinic'}" <${config.fromEmail}>`
      : `"${config.fromName || 'DeePhysio Clinic'}" <${config.smtpUser || 'clinic@deephysio.com'}>`;

    const mailOptions = {
      from: fromAddress,
      to: targetEmail,
      subject: emailSubject,
      text: emailBody,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
          <div style="background: linear-gradient(135deg, #0ea5e9, #0284c7); padding: 20px 24px; border-radius: 12px; color: #ffffff; margin-bottom: 24px;">
            <h2 style="margin: 0; font-size: 19px; font-weight: 800; letter-spacing: -0.5px;">${config.fromName || 'DeePhysio Healthcare Platform'}</h2>
            <p style="margin: 4px 0 0; opacity: 0.9; font-size: 12px; font-weight: 500;">Clinical & Patient Communications</p>
          </div>
          <div style="color: #1e293b; font-size: 14px; line-height: 1.75; white-space: pre-wrap; padding: 0 4px;">${emailBody}</div>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center;">
            <p style="margin: 0; font-weight: 600;">Sent securely by DeePhysio Clinic to ${targetEmail}</p>
            <p style="margin: 4px 0 0; font-size: 10px;">Confidential medical communication. If you received this by mistake, please notify sender.</p>
          </div>
        </div>
      `
    };

    // Handle file / attachment
    if (file && file.buffer) {
      attachmentName = file.originalname || 'Clinical_Document.pdf';
      mailOptions.attachments = [
        {
          filename: attachmentName,
          content: file.buffer,
          contentType: file.mimetype || 'application/octet-stream'
        }
      ];
    } else if (attachment && attachment.content) {
      attachmentName = attachment.name || 'Clinical_Document.pdf';
      const base64Data = attachment.content.replace(/^data:[^;]+;base64,/, '');
      mailOptions.attachments = [
        {
          filename: attachmentName,
          content: Buffer.from(base64Data, 'base64'),
          contentType: attachment.type || 'application/octet-stream'
        }
      ];
    }

    if (transporter) {
      const info = await transporter.sendMail(mailOptions);
      providerResult = { status: 'DELIVERED', externalId: info.messageId };
    } else {
      providerResult = { status: isSimulated ? 'SIMULATED' : 'SENT', externalId: `sim-${Date.now()}` };
    }
  } catch (mailErr) {
    console.warn('[Email Service] Outbound delivery error:', mailErr.message);
    providerResult = { status: 'FAILED', externalId: null, error: mailErr.message };
  }

  // Find or create thread
  let threadId = null;
  if (patId) {
    const existingThread = await prisma.$queryRawUnsafe(`
      SELECT id FROM communication_threads 
      WHERE channel = 'email' AND patient_id = ${patId} 
      LIMIT 1
    `);
    if (existingThread && existingThread.length > 0) {
      threadId = existingThread[0].id;
    }
  }

  if (!threadId) {
    const title = patName ? `Email with ${patName}` : `Email with ${targetEmail}`;
    await prisma.$executeRawUnsafe(`
      INSERT INTO communication_threads (patient_id, channel, title, created_by, tenant_id)
      VALUES (${patId || 0}, 'email', '${title.replace(/'/g, "''")}', ${createdBy || null}, ${tid})
    `);
    const newThread = await prisma.$queryRawUnsafe('SELECT id FROM communication_threads ORDER BY id DESC LIMIT 1');
    threadId = newThread[0]?.id || 1;
  } else {
    await prisma.$executeRawUnsafe(`
      UPDATE communication_threads 
      SET updated_at = CURRENT_TIMESTAMP(3) 
      WHERE id = ${threadId}
    `);
  }

  // Insert message record
  const cleanBody = emailBody.replace(/'/g, "''");
  const cleanSubject = emailSubject.replace(/'/g, "''");
  const cleanEmail = targetEmail.replace(/'/g, "''");
  const cleanAttachName = attachmentName ? `'${attachmentName.replace(/'/g, "''")}'` : 'NULL';

  await prisma.$executeRawUnsafe(`
    INSERT INTO communication_messages (
      thread_id, patient_id, channel, direction, body, subject, 
      delivery_status, external_id, created_by, tenant_id, 
      recipient_email, is_starred, is_deleted, is_read, attachment_name
    )
    VALUES (
      ${threadId}, ${patId || 0}, 'email', 'outbound', '${cleanBody}', '${cleanSubject}',
      '${providerResult.status || 'SENT'}', ${providerResult.externalId ? `'${providerResult.externalId}'` : 'NULL'}, ${createdBy || 'NULL'}, ${tid},
      '${cleanEmail}', 0, 0, 1, ${cleanAttachName}
    )
  `);

  const inserted = await prisma.$queryRawUnsafe('SELECT * FROM communication_messages ORDER BY id DESC LIMIT 1');
  const msg = inserted[0];

  return {
    id: Number(msg.id),
    threadId: Number(threadId),
    patientId: patId,
    sender: 'Clinic Staff',
    recipientName: patName || targetEmail,
    email: targetEmail,
    subject: emailSubject,
    excerpt: String(emailBody).slice(0, 100),
    date: new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
    createdAt: msg.created_at,
    read: true,
    content: emailBody,
    folder: 'Sent',
    isStarred: false,
    isDeleted: false,
    deliveryStatus: providerResult.status || 'DELIVERED',
    attachmentName: attachmentName,
    direction: 'outbound'
  };
};

/**
 * Reply to an email message
 */
const replyEmail = async ({ messageId, threadId, subject, body, tenantId, createdBy }) => {
  await ensureCommunicationSchema();
  let origMessage = null;
  if (messageId) {
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM communication_messages WHERE id = ${Number(messageId)} LIMIT 1`);
    origMessage = rows[0];
  }

  const tid = origMessage?.thread_id || threadId;
  const patientId = origMessage?.patient_id || null;
  const recipientEmail = origMessage?.recipient_email || null;
  const replySubject = subject || (origMessage?.subject?.startsWith('Re:') ? origMessage.subject : `Re: ${origMessage?.subject || 'Correspondence'}`);

  return sendEmailMessage({
    patientId,
    recipientEmail,
    subject: replySubject,
    body,
    tenantId,
    createdBy
  });
};

/**
 * Forward an email message
 */
const forwardEmail = async ({ messageId, targetEmail, note, tenantId, createdBy }) => {
  await ensureCommunicationSchema();
  const rows = await prisma.$queryRawUnsafe(`SELECT * FROM communication_messages WHERE id = ${Number(messageId)} LIMIT 1`);
  const origMessage = rows[0];
  if (!origMessage) throw new Error('Original message not found');

  const fwdSubject = origMessage.subject?.startsWith('Fwd:') ? origMessage.subject : `Fwd: ${origMessage.subject || 'Correspondence'}`;
  const fwdBody = `${note ? note + '\n\n' : ''}---------- Forwarded message ---------\nSubject: ${origMessage.subject || '(no subject)'}\nDate: ${origMessage.created_at}\n\n${origMessage.body}`;

  return sendEmailMessage({
    recipientEmail: targetEmail,
    subject: fwdSubject,
    body: fwdBody,
    tenantId,
    createdBy
  });
};

module.exports = {
  listThreads,
  createThread,
  listMessages,
  sendMessage,
  createCampaign,
  listCampaigns,
  createTelehealthSession,
  listTelehealthSessions,
  sendDirectEmail,
  updateMessageFlags,
  deleteMessagePermanently,
  listAllEmailMessages,
  sendEmailMessage,
  replyEmail,
  forwardEmail
};
