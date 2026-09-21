const express = require('express');
const router = express.Router();
const { verifyToken } = require('../auth/auth.middleware');

// In-memory support tickets store with realistic defaults
let supportTickets = [
  {
    id: 101,
    subject: 'Billing Invoice PDF Generation Issue',
    message: 'When downloading GST invoice from billing section, the tax breakdown table format is misaligned on A4 print.',
    status: 'Open',
    priority: 'High',
    tenant_id: 1,
    tenant_name: 'Dr. Sharma Physiotherapy & Rehab',
    user_name: 'Dr. Sharma',
    user_email: 'sharma.clinic@gmail.com',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    replies: []
  },
  {
    id: 102,
    subject: 'SMS Gateway WhatsApp API Integration',
    message: 'We want to enable automated appointment reminders via WhatsApp template. Please guide us on configuration.',
    status: 'Replied',
    priority: 'Medium',
    tenant_id: 2,
    tenant_name: 'Apex Ortho & Sports Clinic',
    user_name: 'Admin User',
    user_email: 'apex.admin@gmail.com',
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    replies: [
      {
        sender: 'SuperAdmin Support',
        message: 'WhatsApp Business API credentials can be enabled in Settings > Notification Channels.',
        date: new Date(Date.now() - 12 * 3600 * 1000).toISOString()
      }
    ]
  }
];

// 1. GET /api/support/saas (SuperAdmin access)
router.get('/saas', verifyToken, (req, res) => {
  return res.status(200).json({
    success: true,
    data: supportTickets
  });
});

// 2. GET /api/support/tenant (Clinic Tenant access)
router.get('/tenant', verifyToken, (req, res) => {
  const tenantId = req.user?.tenant_id;
  const filtered = tenantId
    ? supportTickets.filter(t => t.tenant_id === tenantId)
    : supportTickets;
  return res.status(200).json({
    success: true,
    data: filtered
  });
});

// 2b. GET /api/support/:id (Fetch single ticket details)
router.get('/:id', verifyToken, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = supportTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  if (req.user?.role !== 'superadmin' && req.user?.tenant_id && ticket.tenant_id !== req.user.tenant_id) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  return res.status(200).json({
    success: true,
    data: ticket
  });
});

// 3. POST /api/support (Create Ticket)
router.post('/', verifyToken, (req, res) => {
  const { subject, message, priority = 'Medium' } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ success: false, message: 'Subject and message are required' });
  }

  const newTicket = {
    id: supportTickets.length > 0 ? Math.max(...supportTickets.map(t => t.id)) + 1 : 101,
    subject,
    message,
    status: 'Open',
    priority,
    tenant_id: req.user?.tenant_id || 1,
    tenant_name: req.user?.clinic_name || 'DeePhysio Clinic',
    user_name: req.user?.name || 'Admin',
    user_email: req.user?.email || 'admin@clinic.com',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    replies: []
  };

  supportTickets.unshift(newTicket);
  return res.status(201).json({
    success: true,
    message: 'Support ticket created successfully',
    data: newTicket
  });
});

// 4. POST /api/support/:id/reply (Reply Ticket)
router.post('/:id/reply', verifyToken, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = supportTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ success: false, message: 'Reply message is required' });
  }

  const replyObj = {
    sender: req.user?.role === 'superadmin' ? 'SuperAdmin Support' : (req.user?.name || 'Clinic Admin'),
    message,
    date: new Date().toISOString()
  };

  ticket.replies = ticket.replies || [];
  ticket.replies.push(replyObj);
  ticket.status = req.user?.role === 'superadmin' ? 'Replied' : 'Open';
  ticket.updated_at = new Date().toISOString();

  return res.status(200).json({
    success: true,
    message: 'Reply posted successfully',
    data: ticket
  });
});

// 5. PATCH /api/support/:id/status (Update Status)
router.patch('/:id/status', verifyToken, (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = supportTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  const { status } = req.body;
  ticket.status = status || 'Resolved';
  ticket.updated_at = new Date().toISOString();

  return res.status(200).json({
    success: true,
    message: 'Status updated',
    data: ticket
  });
});

module.exports = router;
