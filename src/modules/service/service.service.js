const prisma = require('../../config/prisma');

const getAllServices = async (filters, tenantId) => {
  const where = {};
  if (tenantId) where.tenant_id = tenantId;

  if (filters.activeOnly === 'true') {
    where.is_active = true;
  }

  const services = await prisma.service.findMany({
    where,
    orderBy: { name: 'asc' }
  });

  return services.map(s => ({
    ...s,
    price: parseFloat(s.price)
  }));
};

const getServiceById = async (id, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const service = await prisma.service.findFirst({
    where
  });

  if (!service) {
    const error = new Error('Service not found');
    error.statusCode = 404;
    throw error;
  }

  return service;
};

const createService = async (data, tenantId) => {
  const { name, category, duration, price, is_active, isActive, status } = data;
  const trimmedName = name.trim();

  // Check unique name within clinic
  const existingWhere = { name: trimmedName };
  if (tenantId) existingWhere.tenant_id = tenantId;
  const existing = await prisma.service.findFirst({
    where: existingWhere
  });

  if (existing) {
    const error = new Error('Service with this name already exists');
    error.statusCode = 400;
    throw error;
  }

  let activeFlag = true;
  if (is_active !== undefined) {
    activeFlag = Boolean(is_active);
  } else if (isActive !== undefined) {
    activeFlag = Boolean(isActive);
  } else if (status !== undefined) {
    activeFlag = String(status).toLowerCase() === 'active';
  }

  return await prisma.service.create({
    data: {
      name: trimmedName,
      category: category || null,
      duration,
      price,
      is_active: activeFlag,
      tenant_id: tenantId || null
    }
  });
};

const updateService = async (id, data, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const service = await prisma.service.findFirst({ where });

  if (!service) {
    const error = new Error('Service not found');
    error.statusCode = 404;
    throw error;
  }

  const { name, category, duration, price, is_active, isActive, status } = data;

  // Check unique name if changed
  if (name !== undefined) {
    const trimmedName = name.trim();
    const existingWhere = {
      name: trimmedName,
      NOT: { id }
    };
    if (tenantId) existingWhere.tenant_id = tenantId;
    const existing = await prisma.service.findFirst({
      where: existingWhere
    });

    if (existing) {
      const error = new Error('Service with this name already exists');
      error.statusCode = 400;
      throw error;
    }
  }

  const updateData = {};
  if (name !== undefined)     updateData.name      = name.trim();
  if (category !== undefined) updateData.category  = category;
  if (duration !== undefined)  updateData.duration   = duration;
  if (price !== undefined)     updateData.price      = price;

  if (is_active !== undefined) {
    updateData.is_active = Boolean(is_active);
  } else if (isActive !== undefined) {
    updateData.is_active = Boolean(isActive);
  } else if (status !== undefined) {
    updateData.is_active = String(status).toLowerCase() === 'active';
  }

  return await prisma.service.update({
    where: { id },
    data: updateData
  });
};

const deleteService = async (id, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const service = await prisma.service.findFirst({ where });

  if (!service) {
    const error = new Error('Service not found');
    error.statusCode = 404;
    throw error;
  }

  await prisma.service.delete({ where: { id } });
  return service;
};

module.exports = {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  deleteService
};
