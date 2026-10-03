const prisma = require('../../config/prisma');

const STAFF_ROLES = ['therapist', 'receptionist', 'billing'];

const getAuditLogs = async (filters, user) => {
  const { action, role, userId, tenantId, startDate, endDate, search, limit = 50, page = 1 } = filters;
  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const take = parseInt(limit, 10);

  const where = {};

  if (user.role !== 'superadmin') {
    // 🔒 STRICT CLINIC ADMIN TENANT & STAFF ISOLATION:
    // 1. Must belong to the authenticated admin's clinic
    where.tenant_id = user.tenant_id;
    // 2. EXCLUDE the Clinic Admin's own activity (Admin is the observer, NOT observed)
    where.user_id = { not: user.id };
    // 3. User MUST be staff belonging to this clinic
    if (role && role !== 'ALL') {
      if (STAFF_ROLES.includes(role)) {
        where.user = { tenant_id: user.tenant_id, role };
      } else {
        // If a clinic admin tries to filter by admin or superadmin, return no records
        where.id = -1;
      }
    } else {
      where.user = { tenant_id: user.tenant_id, role: { in: STAFF_ROLES } };
    }
  } else {
    // Superadmin: global platform administrator
    if (tenantId && tenantId !== 'ALL') {
      where.tenant_id = parseInt(tenantId, 10);
    }
    if (role && role !== 'ALL') {
      where.user = { role };
    }
  }

  if (action && action !== 'ALL') {
    where.action = action;
  }

  if (userId) {
    const targetUserId = parseInt(userId, 10);
    if (user.role !== 'superadmin' && targetUserId === user.id) {
      where.id = -1;
    } else {
      where.user_id = targetUserId;
    }
  }

  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at.gte = new Date(startDate);
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      where.created_at.lte = e;
    }
  }

  if (search) {
    const searchConditions = [
      { details: { contains: search } },
      { target_type: { contains: search } },
      { ip_address: { contains: search } },
      { user: { name: { contains: search } } },
      { user: { email: { contains: search } } }
    ];

    where.AND = [
      ...(where.AND || []),
      { OR: searchConditions }
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.systemActivityLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, tenant_id: true }
        },
        tenant: {
          select: { id: true, clinic_name: true, email: true }
        }
      },
      orderBy: { created_at: 'desc' },
      skip,
      take
    }),
    prisma.systemActivityLog.count({ where })
  ]);

  return {
    logs: logs.map(l => ({
      ...l,
      meta: l.meta && typeof l.meta === 'string' && l.meta.startsWith('{') ? JSON.parse(l.meta) : l.meta
    })),
    total,
    page: parseInt(page, 10),
    totalPages: Math.ceil(total / take)
  };
};

const getAuditTenants = async (user) => {
  if (user.role === 'superadmin') {
    return prisma.tenant.findMany({
      select: { id: true, clinic_name: true, email: true },
      orderBy: { clinic_name: 'asc' }
    });
  }
  if (user.tenant_id) {
    return prisma.tenant.findMany({
      where: { id: user.tenant_id },
      select: { id: true, clinic_name: true, email: true }
    });
  }
  return [];
};

const exportAuditLogsCsv = async (filters, user) => {
  const { logs } = await getAuditLogs({ ...filters, limit: 10000, page: 1 }, user);
  
  const headers = ['ID', 'Timestamp', 'Clinic / Tenant', 'Staff Name', 'Staff Email', 'Role', 'Action Event', 'Target Type', 'Details', 'IP Address'];
  const rows = logs.map(l => [
    l.id,
    new Date(l.created_at).toISOString(),
    `"${(l.tenant?.clinic_name || 'Clinic #' + (l.tenant_id || '')).replace(/"/g, '""')}"`,
    `"${(l.user?.name || 'Staff').replace(/"/g, '""')}"`,
    l.user?.email || 'N/A',
    l.user?.role || 'staff',
    l.action,
    l.target_type || '',
    `"${(l.details || '').replace(/"/g, '""')}"`,
    l.ip_address || ''
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

const getAuditStats = async (filters, user) => {
  const isSuper = user.role === 'superadmin';
  const tenantId = isSuper
    ? (filters.tenantId && filters.tenantId !== 'ALL' ? parseInt(filters.tenantId, 10) : null)
    : user.tenant_id;

  const baseCondition = {};
  if (tenantId) {
    baseCondition.tenant_id = tenantId;
  }

  if (!isSuper) {
    // 🔒 STRICT CLINIC ADMIN SCOPING: Exclude Admin's own activity, include only this clinic's staff
    baseCondition.user_id = { not: user.id };
    baseCondition.user = { tenant_id: user.tenant_id, role: { in: STAFF_ROLES } };
  }

  const [
    totalStaffEvents,
    totalStaffLogins,
    therapistTotal,
    therapistLogins,
    receptionistTotal,
    receptionistLogins,
    billingTotal,
    billingLogins,
    superadminTotal,
    superadminLogins
  ] = await Promise.all([
    prisma.systemActivityLog.count({ where: baseCondition }),
    prisma.systemActivityLog.count({ where: { ...baseCondition, action: 'LOGIN' } }),
    prisma.systemActivityLog.count({
      where: {
        ...baseCondition,
        user: { role: 'therapist', ...(tenantId ? { tenant_id: tenantId } : {}) }
      }
    }),
    prisma.systemActivityLog.count({
      where: {
        ...baseCondition,
        action: 'LOGIN',
        user: { role: 'therapist', ...(tenantId ? { tenant_id: tenantId } : {}) }
      }
    }),
    prisma.systemActivityLog.count({
      where: {
        ...baseCondition,
        user: { role: 'receptionist', ...(tenantId ? { tenant_id: tenantId } : {}) }
      }
    }),
    prisma.systemActivityLog.count({
      where: {
        ...baseCondition,
        action: 'LOGIN',
        user: { role: 'receptionist', ...(tenantId ? { tenant_id: tenantId } : {}) }
      }
    }),
    prisma.systemActivityLog.count({
      where: {
        ...baseCondition,
        user: { role: 'billing', ...(tenantId ? { tenant_id: tenantId } : {}) }
      }
    }),
    prisma.systemActivityLog.count({
      where: {
        ...baseCondition,
        action: 'LOGIN',
        user: { role: 'billing', ...(tenantId ? { tenant_id: tenantId } : {}) }
      }
    }),
    isSuper ? prisma.systemActivityLog.count({ where: { ...(tenantId ? { tenant_id: tenantId } : {}), user: { role: 'superadmin' } } }) : 0,
    isSuper ? prisma.systemActivityLog.count({ where: { ...(tenantId ? { tenant_id: tenantId } : {}), action: 'LOGIN', user: { role: 'superadmin' } } }) : 0
  ]);

  return {
    total: totalStaffEvents,
    totalLogins: totalStaffLogins,
    admin: { total: 0, logins: 0 },
    therapist: { total: therapistTotal, logins: therapistLogins },
    receptionist: { total: receptionistTotal, logins: receptionistLogins },
    billing: { total: billingTotal, logins: billingLogins },
    superadmin: { total: superadminTotal, logins: superadminLogins }
  };
};

module.exports = {
  getAuditLogs,
  getAuditTenants,
  getAuditStats,
  exportAuditLogsCsv
};
