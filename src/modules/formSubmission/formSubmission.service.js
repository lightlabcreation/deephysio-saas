const prisma = require('../../config/prisma');

/**
 * Save a new form submission
 * @param {Object} data 
 * @param {Number} [tenantId]
 */
const createSubmission = async (data, tenantId) => {
  const pid = parseInt(data.patientId, 10);
  const templateId = parseInt(data.templateId, 10);

  // Validate patient belongs to tenant
  const patientWhere = { id: pid };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.formSubmission.create({
    data: {
      patient_id: pid,
      form_template_id: templateId,
      responses: typeof data.responses === 'string' ? data.responses : JSON.stringify(data.responses),
      tenant_id: tenantId || null
    },
    include: {
      form_template: true
    }
  });
};

/**
 * Get all submissions for a specific patient
 * @param {Number} patientId 
 * @param {Number} [tenantId]
 */
const getSubmissionsByPatientId = async (patientId, tenantId) => {
  const pid = parseInt(patientId, 10);

  // Validate patient belongs to tenant
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

  const submissions = await prisma.formSubmission.findMany({
    where,
    include: {
      form_template: true
    },
    orderBy: { created_at: 'desc' }
  });
  
  return submissions.map(sub => {
    if (sub.responses && typeof sub.responses === 'string') {
      try { sub.responses = JSON.parse(sub.responses); } catch(e) {}
    }
    return sub;
  });
};

/**
 * Get a single submission by ID
 * @param {Number} id 
 * @param {Number} [tenantId]
 */
const getSubmissionById = async (id, tenantId) => {
  const sid = parseInt(id, 10);
  const where = { id: sid };
  if (tenantId) where.tenant_id = tenantId;

  const submission = await prisma.formSubmission.findFirst({
    where,
    include: {
      form_template: true,
      patient: true
    }
  });

  if (!submission) {
    const error = new Error('Submission not found');
    error.statusCode = 404;
    throw error;
  }

  if (submission.responses && typeof submission.responses === 'string') {
    try { submission.responses = JSON.parse(submission.responses); } catch(e) {}
  }
  
  return submission;
};

module.exports = {
  createSubmission,
  getSubmissionsByPatientId,
  getSubmissionById
};
