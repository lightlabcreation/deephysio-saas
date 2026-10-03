const prisma = require('../../config/prisma');
const { notifyClinicalPlanUpdated } = require('../whatsapp/whatsappNotification.service');

const includeRelations = {
  patient: { select: { id: true, first_name: true, last_name: true, phone: true, tenant_id: true } },
  therapist: { select: { id: true, name: true } }
};

const serializeDynamicForPlan = (dynamicContent) => {
  if (!dynamicContent || typeof dynamicContent !== 'object') return '';
  const responses = dynamicContent.responses && typeof dynamicContent.responses === 'object'
    ? dynamicContent.responses
    : dynamicContent;
  const fieldLabelMap = {};
  const layouts = Array.isArray(dynamicContent.layouts) ? dynamicContent.layouts : [];
  layouts.forEach((layout) => {
    (layout.fields || []).forEach((field) => {
      if (field?.id) fieldLabelMap[field.id] = field.label || field.id;
    });
  });
  const lines = Object.entries(responses)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(', ') : String(value);
      const label = fieldLabelMap[key] || key;
      return `${label}: ${rendered}`;
    });
  return lines.length ? `\n\nDynamic Template Data:\n${lines.join('\n')}` : '';
};

const getAllClinicalNotes = async (filters, tenantId) => {
  const where = {};
  if (tenantId) where.tenant_id = tenantId;

  if (filters.patientId) {
    where.patient_id = parseInt(filters.patientId, 10);
  }

  if (filters.therapistId) {
    where.therapist_id = parseInt(filters.therapistId, 10);
  }

  if (filters.status) {
    where.status = filters.status;
  }

  return await prisma.clinicalNote.findMany({
    where,
    include: includeRelations,
    orderBy: { date: 'desc' }
  });
};

const getClinicalNoteById = async (id, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const note = await prisma.clinicalNote.findFirst({
    where,
    include: includeRelations
  });

  if (!note) {
    const error = new Error('Clinical note not found');
    error.statusCode = 404;
    throw error;
  }

  return note;
};

const createClinicalNote = async (data, tenantId) => {
  const { patientId, therapistId, type, date, status, subjective, objective, assessment, plan, dynamic_content, dynamicContent } = data;
  const normalizedDynamicContent = dynamic_content !== undefined ? dynamic_content : dynamicContent;

  // Check patient exists within this clinic
  const patientWhere = { id: patientId };
  if (tenantId) patientWhere.tenant_id = tenantId;
  const patient = await prisma.patient.findFirst({ where: patientWhere });
  if (!patient) {
    const error = new Error('Patient not found');
    error.statusCode = 404;
    throw error;
  }

  // Check therapist exists and role = therapist or admin within this clinic
  const userWhere = { id: therapistId };
  if (tenantId) userWhere.tenant_id = tenantId;
  const user = await prisma.user.findFirst({ where: userWhere });
  if (!user || (user.role !== 'therapist' && user.role !== 'admin')) {
    const error = new Error('Authorized staff not found or user does not have permission to create notes');
    error.statusCode = 400;
    throw error;
  }

  const noteStatus = status || 'Draft';

  // If Completed, at least one clinical field is required
  if (noteStatus === 'Completed') {
    const hasContent = (subjective && subjective.trim()) ||
      (objective && objective.trim()) ||
      (assessment && assessment.trim()) ||
      (plan && plan.trim()) ||
      (normalizedDynamicContent && Object.keys(normalizedDynamicContent).length > 0);
    if (!hasContent) {
      const error = new Error('Clinical note is empty. Please enter some findings or use a dynamic template.');
      error.statusCode = 400;
      throw error;
    }
  }

  const baseData = {
    patient_id: patientId,
    therapist_id: therapistId,
    type,
    date: new Date(date),
    status: noteStatus,
    subjective: subjective || null,
    objective: objective || null,
    assessment: assessment || null,
    plan: plan || null,
    tenant_id: tenantId || null
  };

  let createdNote;
  try {
    createdNote = await prisma.clinicalNote.create({
      data: {
        ...baseData,
        dynamic_content: (normalizedDynamicContent && typeof normalizedDynamicContent === 'object') 
          ? JSON.stringify(normalizedDynamicContent) 
          : (normalizedDynamicContent || null)
      },
      include: includeRelations
    });
  } catch (error) {
    if (!String(error?.message || '').includes('Unknown argument `dynamic_content`')) throw error;

    // Fallback for environments where Prisma client/table isn't updated yet.
    const fallbackPlan = `${baseData.plan || ''}${serializeDynamicForPlan(normalizedDynamicContent)}`.trim() || null;
    createdNote = await prisma.clinicalNote.create({
      data: { ...baseData, plan: fallbackPlan },
      include: includeRelations
    });
  }

  // Non-blocking patient WhatsApp care plan notification
  if (createdNote && (noteStatus === 'Completed' || createdNote.plan)) {
    try {
      const targetTenantId = createdNote.patient?.tenant_id || createdNote.tenant_id;
      if (targetTenantId) {
        notifyClinicalPlanUpdated({
          tenantId: targetTenantId,
          patient: createdNote.patient,
          planTitle: createdNote.type || 'Care & Exercise Plan',
          planType: 'Treatment Plan'
        });
      }
    } catch (e) {
      console.warn('[WhatsApp] Care plan notification skipped:', e.message);
    }
  }

  return createdNote;
};

const updateClinicalNote = async (id, data, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const note = await prisma.clinicalNote.findFirst({ where });

  if (!note) {
    const error = new Error('Clinical note not found');
    error.statusCode = 404;
    throw error;
  }

  const { type, date, status, subjective, objective, assessment, plan, dynamic_content, dynamicContent } = data;
  const normalizedDynamicContent = dynamic_content !== undefined ? dynamic_content : dynamicContent;

  // Determine final status (incoming or existing)
  const finalStatus = status !== undefined ? status : note.status;

  // If Completed, at least one clinical field must be present (incoming or existing)
  if (finalStatus === 'Completed') {
    const finalSubjective = subjective !== undefined ? subjective : note.subjective;
    const finalObjective = objective !== undefined ? objective : note.objective;
    const finalAssessment = assessment !== undefined ? assessment : note.assessment;
    const finalPlan = plan !== undefined ? plan : note.plan;
    const finalDynamic = normalizedDynamicContent !== undefined ? normalizedDynamicContent : note.dynamic_content;

    const hasContent = (finalSubjective && finalSubjective.trim()) ||
      (finalObjective && finalObjective.trim()) ||
      (finalAssessment && finalAssessment.trim()) ||
      (finalPlan && finalPlan.trim()) ||
      (finalDynamic && Object.keys(finalDynamic).length > 0);

    if (!hasContent) {
      const error = new Error('Clinical note is empty. Please enter some findings or use a dynamic template.');
      error.statusCode = 400;
      throw error;
    }
  }

  const updateData = {};
  if (type !== undefined) updateData.type = type;
  if (date !== undefined) updateData.date = new Date(date);
  if (status !== undefined) updateData.status = status;
  if (subjective !== undefined) updateData.subjective = subjective || null;
  if (objective !== undefined) updateData.objective = objective || null;
  if (assessment !== undefined) updateData.assessment = assessment || null;
  if (plan !== undefined) updateData.plan = plan || null;
  if (normalizedDynamicContent !== undefined) {
    updateData.dynamic_content = (normalizedDynamicContent && typeof normalizedDynamicContent === 'object')
      ? JSON.stringify(normalizedDynamicContent)
      : (normalizedDynamicContent || null);
  }

  try {
    return await prisma.clinicalNote.update({
      where: { id },
      data: updateData,
      include: includeRelations
    });
  } catch (error) {
    if (!String(error?.message || '').includes('Unknown argument `dynamic_content`')) throw error;

    const fallbackUpdate = { ...updateData };
    delete fallbackUpdate.dynamic_content;
    if (normalizedDynamicContent !== undefined) {
      const currentPlan = fallbackUpdate.plan !== undefined ? fallbackUpdate.plan : note.plan;
      fallbackUpdate.plan = `${currentPlan || ''}${serializeDynamicForPlan(normalizedDynamicContent)}`.trim() || null;
    }

    return await prisma.clinicalNote.update({
      where: { id },
      data: fallbackUpdate,
      include: includeRelations
    });
  }
};

const deleteClinicalNote = async (id, tenantId) => {
  const where = { id };
  if (tenantId) where.tenant_id = tenantId;
  const note = await prisma.clinicalNote.findFirst({ where });

  if (!note) {
    const error = new Error('Clinical note not found');
    error.statusCode = 404;
    throw error;
  }

  await prisma.clinicalNote.delete({ where: { id } });
  return note;
};

module.exports = {
  getAllClinicalNotes,
  getClinicalNoteById,
  createClinicalNote,
  updateClinicalNote,
  deleteClinicalNote
};
