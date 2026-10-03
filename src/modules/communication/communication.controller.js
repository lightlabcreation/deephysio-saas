const service = require('./communication.service');

const getTenantId = (req) => {
  return req.user?.tenant_id || req.user?.tenantId || null;
};

const listThreads = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.listThreads(req.query, tenantId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const createThread = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.createThread({
      patientId: req.body.patientId,
      channel: req.body.channel || 'sms',
      title: req.body.title,
      createdBy: req.user?.id,
      tenantId
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const listMessages = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.listMessages({ threadId: req.params.threadId, tenantId });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const sendMessage = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.sendMessage({
      threadId: req.params.threadId,
      patientId: req.body.patientId,
      channel: req.body.channel || 'sms',
      subject: req.body.subject,
      body: req.body.body,
      createdBy: req.user?.id,
      recipientEmail: req.body.recipientEmail,
      tenantId
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const createCampaign = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.createCampaign({
      tenantId,
      channel: req.body.channel,
      message: req.body.message,
      recipients: req.body.recipients || [],
      createdBy: req.user?.id
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const listCampaigns = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.listCampaigns(tenantId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const createTelehealthSession = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.createTelehealthSession({
      patientId: req.body.patientId,
      therapistId: req.body.therapistId || req.user?.id,
      startsAt: req.body.startsAt || null,
      tenantId
    });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const listTelehealthSessions = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.listTelehealthSessions(req.query, tenantId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const sendDirectEmail = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const { patientId, subject, body } = req.body;
    const file = req.file;

    if (!patientId || !file) {
      return res.status(400).json({ success: false, message: 'Patient ID and PDF document are required.' });
    }

    const data = await service.sendDirectEmail({
      patientId: parseInt(patientId, 10),
      recipientEmail: req.body.recipientEmail,
      subject: subject || 'Your Clinical Document',
      body: body || 'Please find your clinical document attached.',
      file,
      createdBy: req.user?.id,
      tenantId
    });

    return res.status(200).json({ success: true, data, message: 'Email sent successfully.' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const updateMessageFlags = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.updateMessageFlags(req.params.messageId, req.body, tenantId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const listEmails = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.listAllEmailMessages({
      tenantId,
      folder: req.query.folder,
      search: req.query.search
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const sendEmail = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const { patientId, recipientEmail, recipientName, subject, body, attachment } = req.body;
    const file = req.file;

    let parsedAttachment = attachment;
    if (typeof attachment === 'string') {
      try { parsedAttachment = JSON.parse(attachment); } catch (_) {}
    }

    const data = await service.sendEmailMessage({
      patientId: patientId ? parseInt(patientId, 10) : null,
      recipientEmail,
      recipientName,
      subject,
      body,
      file,
      attachment: parsedAttachment,
      tenantId,
      createdBy: req.user?.id
    });

    return res.status(201).json({ success: true, data, message: 'Email transmitted successfully' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const replyEmail = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.replyEmail({
      messageId: req.body.messageId,
      threadId: req.body.threadId,
      subject: req.body.subject,
      body: req.body.body,
      tenantId,
      createdBy: req.user?.id
    });
    return res.status(200).json({ success: true, data, message: 'Reply sent successfully' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const forwardEmail = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    const data = await service.forwardEmail({
      messageId: req.body.messageId,
      targetEmail: req.body.targetEmail,
      note: req.body.note,
      tenantId,
      createdBy: req.user?.id
    });
    return res.status(200).json({ success: true, data, message: 'Email forwarded successfully' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
};

const deleteMessagePermanently = async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ success: false, message: 'Tenant identification required' });
    await service.deleteMessagePermanently(req.params.messageId, tenantId);
    return res.status(200).json({ success: true, message: 'Message permanently deleted' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
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
  listEmails,
  sendEmail,
  replyEmail,
  forwardEmail,
  deleteMessagePermanently
};
