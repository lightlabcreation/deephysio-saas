const prisma = require('../../config/prisma');

const getAllTemplates = async (tenantId) => {
  const where = { is_active: true };
  if (tenantId) {
    where.OR = [
      { tenant_id: tenantId },
      { tenant_id: null }
    ];
  }

  const templates = await prisma.formTemplate.findMany({
    where,
    orderBy: { name: 'asc' }
  });
  return templates.map(t => {
    if (t.fields && typeof t.fields === 'string') {
      try { t.fields = JSON.parse(t.fields); } catch(e) {}
    }
    return t;
  });
};

const getTemplateById = async (id, tenantId) => {
  const tid = parseInt(id, 10);
  const where = { id: tid };
  if (tenantId) {
    where.OR = [
      { tenant_id: tenantId },
      { tenant_id: null }
    ];
  }

  const template = await prisma.formTemplate.findFirst({
    where
  });

  if (!template) {
    const error = new Error('Form template not found');
    error.statusCode = 404;
    throw error;
  }

  if (template.fields && typeof template.fields === 'string') {
    try { template.fields = JSON.parse(template.fields); } catch(e) {}
  }

  return template;
};

const createTemplate = async (data, tenantId) => {
  const fieldsData = typeof data.fields === 'string' ? data.fields : JSON.stringify(data.fields || []);
  return await prisma.formTemplate.create({
    data: {
      name: data.name,
      category: data.category,
      fields: fieldsData,
      tenant_id: tenantId || null
    }
  });
};

const updateTemplate = async (id, data, tenantId) => {
  const templateId = parseInt(id, 10);
  const where = { id: templateId };
  if (tenantId) where.tenant_id = tenantId;

  const existing = await prisma.formTemplate.findFirst({ where });
  if (!existing) {
    const error = new Error('Form template not found');
    error.statusCode = 404;
    throw error;
  }

  const fieldsData = typeof data.fields === 'string' ? data.fields : JSON.stringify(data.fields || []);
  return await prisma.formTemplate.update({
    where: { id: templateId },
    data: {
      name: data.name,
      category: data.category,
      fields: fieldsData
    }
  });
};

const deleteTemplate = async (id, tenantId) => {
  const templateId = parseInt(id, 10);
  const where = { id: templateId };
  if (tenantId) where.tenant_id = tenantId;

  const existing = await prisma.formTemplate.findFirst({ where });
  if (!existing) {
    const error = new Error('Form template not found');
    error.statusCode = 404;
    throw error;
  }
  
  const submissionsCount = await prisma.formSubmission.count({
    where: { form_template_id: templateId }
  });

  if (submissionsCount > 0) {
    return await prisma.formTemplate.update({
      where: { id: templateId },
      data: { is_active: false }
    });
  }

  return await prisma.formTemplate.delete({
    where: { id: templateId }
  });
};

const seedTemplates = async () => {
  const count = await prisma.formTemplate.count();
  if (count > 0) return;

  const defaults = [
    {
      name: 'General Patient Intake',
      category: 'Patient Intake',
      fields: [
        { id: 'f1', type: 'short', label: 'Full Name', required: true },
        { id: 'f2', type: 'date', label: 'Date of Birth', required: true },
        { id: 'f3', type: 'short', label: 'Phone Number', required: true },
        { id: 'f4', type: 'text', label: 'Current Symptoms', required: false },
      ]
    },
    {
      name: 'Physiotherapy Consent',
      category: 'Consent',
      fields: [
        { id: 'c1', type: 'text', label: 'Treatment Risks Acknowledgement', required: true },
        { id: 'c2', type: 'short', label: 'Patient Signature Name', required: true },
        { id: 'c3', type: 'date', label: 'Signed Date', required: true },
      ]
    }
  ];

  for (const t of defaults) {
    await prisma.formTemplate.create({
      data: {
        name: t.name,
        category: t.category,
        fields: JSON.stringify(t.fields),
        is_active: true
      }
    });
  }
};

module.exports = {
  getAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedTemplates
};
