const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const prisma = require('../../config/prisma');
const { verifyToken } = require('../auth/auth.middleware');
const { authorizeRoles } = require('../auth/role.middleware');

const STORAGE_FILE = path.join(__dirname, 'support_tickets.json');

// Default initial support tickets
const defaultTickets = [
  {
    id: 101,
    subject: 'Billing Invoice PDF Generation Issue',
    message: 'When downloading GST invoice from billing section, the tax breakdown table format is misaligned on A4 print.',
    status: 'Open',
    priority: 'High',
    tenant_id: 1,
    tenant_name: 'deephysio',
    user_name: 'Admin User',
    user_email: 'admin@deephysio.com',
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
    tenant_name: 'ABC CLINIC',
    user_name: 'ABC Kumar',
    user_email: 'abc@gmail.com',
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    replies: [
      {
        id: 1,
        sender: 'SuperAdmin Support',
        message: 'WhatsApp Business API credentials can be enabled in Settings > Notification Channels.',
        is_superadmin: true,
        created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        date: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        user: { name: 'SuperAdmin Support', role: 'superadmin' }
      }
    ]
  }
];

// Helper to load tickets from JSON file or memory
const loadTickets = () => {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const content = fs.readFileSync(STORAGE_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading support_tickets.json:', err.message);
  }
  return [...defaultTickets];
};

let supportTickets = loadTickets();

// Helper to save tickets to disk
const saveTickets = () => {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(supportTickets, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving support_tickets.json:', err.message);
  }
};

// Helper to enrich a single ticket
const enrichTicket = async (ticket) => {
  if (!ticket) return ticket;
  const enriched = { ...ticket };
  try {
    if (ticket.tenant_id) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: Number(ticket.tenant_id) },
        include: {
          users: {
            where: { role: 'admin' },
            select: { id: true, name: true, email: true, role: true },
            take: 1
          }
        }
      });
      if (tenant) {
        if (!enriched.tenant_name || enriched.tenant_name === 'Healthcare Clinic' || enriched.tenant_name === 'Clinic') {
          enriched.tenant_name = tenant.clinic_name;
        }
        const adminUser = tenant.users?.[0];
        if (adminUser) {
          if (!enriched.user_name || enriched.user_name === 'Clinic Admin' || enriched.user_name === 'Admin') {
            enriched.user_name = adminUser.name;
          }
          if (!enriched.user_email || enriched.user_email === 'admin@clinic.com') {
            enriched.user_email = adminUser.email;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error enriching ticket:', err.message);
  }

  enriched.tenant = {
    business_name: enriched.tenant_name || 'Clinic',
    clinic_name: enriched.tenant_name || 'Clinic',
    admin_name: enriched.user_name || 'Admin',
    user_name: enriched.user_name || 'Admin',
    email: enriched.user_email
  };
  return enriched;
};

// Helper to enrich an array of tickets
const enrichTickets = async (ticketList) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        users: {
          where: { role: 'admin' },
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });
    const tenantMap = new Map();
    tenants.forEach(t => tenantMap.set(t.id, t));

    return ticketList.map(t => {
      const copy = { ...t };
      const matched = tenantMap.get(Number(copy.tenant_id));
      if (matched) {
        if (!copy.tenant_name || copy.tenant_name === 'Healthcare Clinic' || copy.tenant_name === 'Clinic') {
          copy.tenant_name = matched.clinic_name;
        }
        const admin = matched.users?.[0];
        if (admin) {
          if (!copy.user_name || copy.user_name === 'Clinic Admin' || copy.user_name === 'Admin') {
            copy.user_name = admin.name;
          }
          if (!copy.user_email || copy.user_email === 'admin@clinic.com') {
            copy.user_email = admin.email;
          }
        }
      }
      copy.tenant = {
        business_name: copy.tenant_name || matched?.clinic_name || 'Clinic',
        clinic_name: copy.tenant_name || matched?.clinic_name || 'Clinic',
        admin_name: copy.user_name || matched?.users?.[0]?.name || 'Admin',
        user_name: copy.user_name || matched?.users?.[0]?.name || 'Admin',
        email: copy.user_email || matched?.email
      };
      return copy;
    });
  } catch (err) {
    console.error('Error enriching tickets:', err.message);
    return ticketList.map(t => ({
      ...t,
      tenant: {
        business_name: t.tenant_name || 'Clinic',
        clinic_name: t.tenant_name || 'Clinic',
        admin_name: t.user_name || 'Admin',
        user_name: t.user_name || 'Admin',
        email: t.user_email
      }
    }));
  }
};

// 1. GET /api/support/saas (SuperAdmin access only)
router.get('/saas', verifyToken, authorizeRoles('superadmin'), async (req, res) => {
  supportTickets = loadTickets();
  const data = await enrichTickets(supportTickets);
  return res.status(200).json({
    success: true,
    data
  });
});

// 2. GET /api/support/tenant (Clinic Tenant access)
router.get('/tenant', verifyToken, async (req, res) => {
  supportTickets = loadTickets();
  const isSuperAdmin = req.user?.role?.toLowerCase() === 'superadmin';
  if (isSuperAdmin) {
    const data = await enrichTickets(supportTickets);
    return res.status(200).json({ success: true, data });
  }

  const userTenantId = req.user?.tenant_id !== undefined ? req.user.tenant_id : req.user?.tenantId;
  const userEmail = (req.user?.email || '').toLowerCase();

  const filtered = supportTickets.filter(t => {
    if (userTenantId !== undefined && userTenantId !== null) {
      if (String(t.tenant_id) === String(userTenantId)) return true;
    }
    if (userEmail && t.user_email && t.user_email.toLowerCase() === userEmail) {
      return true;
    }
    if (!userTenantId && t.tenant_id === 1) return true;
    return false;
  });

  const data = await enrichTickets(filtered);
  return res.status(200).json({
    success: true,
    data
  });
});

// 2b. GET /api/support/:id (Fetch single ticket details)
router.get('/:id', verifyToken, async (req, res) => {
  supportTickets = loadTickets();
  const ticketId = parseInt(req.params.id, 10);
  const ticket = supportTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  const isSuperAdmin = req.user?.role?.toLowerCase() === 'superadmin';
  const userTenantId = req.user?.tenant_id !== undefined ? req.user.tenant_id : req.user?.tenantId;
  const userEmail = (req.user?.email || '').toLowerCase();

  if (!isSuperAdmin) {
    const isOwner = (userTenantId !== undefined && String(ticket.tenant_id) === String(userTenantId)) ||
                    (userEmail && ticket.user_email && ticket.user_email.toLowerCase() === userEmail);
    if (!isOwner) {
      if (ticket.tenant_id !== 1 && userTenantId !== 1) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }
    }
  }

  // Ensure all replies have created_at & is_superadmin
  if (ticket.replies) {
    ticket.replies = ticket.replies.map(r => ({
      ...r,
      created_at: r.created_at || r.date || new Date().toISOString(),
      is_superadmin: r.is_superadmin !== undefined ? r.is_superadmin : (r.sender?.toLowerCase().includes('superadmin'))
    }));
  }

  const enriched = await enrichTicket(ticket);

  return res.status(200).json({
    success: true,
    data: enriched
  });
});

// 3. POST /api/support (Create Ticket)
router.post('/', verifyToken, async (req, res) => {
  const { subject, message, priority = 'Medium', userName, userEmail, clinicName } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ success: false, message: 'Subject and message are required' });
  }

  let dbUser = null;
  try {
    if (req.user?.id) {
      dbUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: { tenant: true }
      });
    }
  } catch (err) {
    console.error('Error fetching user for support ticket:', err.message);
  }

  const userTenantId = req.user?.tenant_id !== undefined 
    ? req.user.tenant_id 
    : (dbUser?.tenant_id || req.user?.tenantId || 1);

  const tenantName = dbUser?.tenant?.clinic_name || clinicName || req.user?.clinic_name || 'Clinic';
  const finalUserName = dbUser?.name || userName || req.user?.name || 'Admin';
  const finalUserEmail = dbUser?.email || userEmail || req.user?.email || 'admin@clinic.com';

  const newTicket = {
    id: supportTickets.length > 0 ? Math.max(...supportTickets.map(t => t.id)) + 1 : 101,
    subject: subject.trim(),
    message: message.trim(),
    status: 'Open',
    priority,
    tenant_id: userTenantId,
    tenant_name: tenantName,
    user_name: finalUserName,
    user_email: finalUserEmail,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    replies: []
  };

  supportTickets.unshift(newTicket);
  saveTickets();

  const enriched = await enrichTicket(newTicket);

  return res.status(201).json({
    success: true,
    message: 'Support ticket created successfully',
    data: enriched
  });
});

// 4. POST /api/support/:id/reply (Reply Ticket)
router.post('/:id/reply', verifyToken, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = supportTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  const { message, userName } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Reply message is required' });
  }

  const isSuperAdmin = req.user?.role?.toLowerCase() === 'superadmin';
  let dbUser = null;
  if (!isSuperAdmin && req.user?.id) {
    try {
      dbUser = await prisma.user.findUnique({
        where: { id: req.user.id }
      });
    } catch (err) {}
  }

  const senderName = isSuperAdmin 
    ? 'SuperAdmin Support' 
    : (dbUser?.name || userName || req.user?.name || ticket.user_name || 'Clinic Admin');

  const replyObj = {
    id: Date.now(),
    sender: senderName,
    is_superadmin: isSuperAdmin,
    message: message.trim(),
    created_at: new Date().toISOString(),
    date: new Date().toISOString(),
    user: {
      name: senderName,
      role: req.user?.role || (isSuperAdmin ? 'superadmin' : 'admin')
    }
  };

  ticket.replies = ticket.replies || [];
  ticket.replies.push(replyObj);
  ticket.status = isSuperAdmin ? 'Replied' : 'Open';
  ticket.updated_at = new Date().toISOString();

  saveTickets();

  const enriched = await enrichTicket(ticket);

  return res.status(200).json({
    success: true,
    message: 'Reply posted successfully',
    data: enriched
  });
});

// 5. PATCH /api/support/:id/status (Update Status)
router.patch('/:id/status', verifyToken, async (req, res) => {
  const ticketId = parseInt(req.params.id, 10);
  const ticket = supportTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Ticket not found' });
  }

  const { status } = req.body;
  ticket.status = status || 'Resolved';
  ticket.updated_at = new Date().toISOString();

  saveTickets();

  const enriched = await enrichTicket(ticket);

  return res.status(200).json({
    success: true,
    message: 'Status updated',
    data: enriched
  });
});

module.exports = router;
