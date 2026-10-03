const prisma = require('../../config/prisma');

const getAllAttachments = async (filters, tenantId) => {
  const { patientId } = filters;
  const where = {};
  if (tenantId) where.tenant_id = tenantId;

  if (patientId) where.patient_id = parseInt(patientId, 10);

  return await prisma.attachment.findMany({
    where,
    include: {
      patient: { select: { id: true, first_name: true, last_name: true } }
    },
    orderBy: { upload_date: 'desc' }
  });
};

const getAttachmentById = async (id, tenantId) => {
  const aid = parseInt(id, 10);
  const where = { id: aid };
  if (tenantId) where.tenant_id = tenantId;

  const attachment = await prisma.attachment.findFirst({
    where,
    include: {
      patient: { select: { id: true, first_name: true, last_name: true } }
    }
  });

  if (!attachment) {
    const error = new Error('Attachment not found');
    error.statusCode = 404;
    throw error;
  }

  return attachment;
};

const createAttachment = async (data, tenantId) => {
  const pid = parseInt(data.patientId, 10);

  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.attachment.create({
    data: {
      name: data.name,
      patient_id: pid,
      size: data.size,
      type: data.type,
      tenant_id: tenantId || null
    },
    include: {
      patient: true
    }
  });
};

const deleteAttachment = async (id, tenantId) => {
  const aid = parseInt(id, 10);
  const where = { id: aid };
  if (tenantId) where.tenant_id = tenantId;

  const existing = await prisma.attachment.findFirst({ where });
  if (!existing) {
    const error = new Error('Attachment not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.attachment.delete({
    where: { id: aid }
  });
};

module.exports = {
  getAllAttachments,
  getAttachmentById,
  createAttachment,
  deleteAttachment
};
