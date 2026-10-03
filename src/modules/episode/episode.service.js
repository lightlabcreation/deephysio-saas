const prisma = require('../../config/prisma');

const getEpisodesByPatientId = async (patientId, tenantId) => {
  const pid = parseInt(patientId, 10);
  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  const where = { patient_id: pid };
  if (tenantId) where.tenant_id = tenantId;

  return await prisma.episode.findMany({
    where,
    orderBy: { created_at: 'desc' }
  });
};

const createEpisode = async (data, tenantId) => {
  const { patientId, title, description } = data;
  const pid = parseInt(patientId, 10);

  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  // Transaction to prevent race condition
  return await prisma.$transaction(async (tx) => {
    // Check for existing active episode (end_date is NULL)
    const activeWhere = {
      patient_id: pid,
      end_date: null
    };
    if (tenantId) activeWhere.tenant_id = tenantId;

    const activeEpisode = await tx.episode.findFirst({
      where: activeWhere
    });

    if (activeEpisode) {
      const error = new Error('Active episode already exists for this patient');
      error.statusCode = 400;
      throw error;
    }

    return await tx.episode.create({
      data: {
        patient_id: pid,
        title,
        description,
        tenant_id: tenantId || null
      }
    });
  });
};

const endEpisode = async (id, endDate, tenantId) => {
  const eid = parseInt(id, 10);
  const where = { id: eid };
  if (tenantId) where.tenant_id = tenantId;

  const episode = await prisma.episode.findFirst({ where });
  if (!episode) {
    const error = new Error('Episode not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.episode.update({
    where: { id: eid },
    data: {
      end_date: new Date(endDate)
    }
  });
};

module.exports = {
  getEpisodesByPatientId,
  createEpisode,
  endEpisode
};
