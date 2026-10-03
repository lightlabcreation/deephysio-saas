const prisma = require('../../config/prisma');

const DEFAULT_BODY_CHARTS = [
  { title: 'Body Chart', image_url: '/bodyChart/Bodychart.jpg', sort_order: 1 },
  { title: 'Body Chart Blank', image_url: '/bodyChart/Bodychart Blank.jpg', sort_order: 2 },
  { title: 'Body Chart Views', image_url: '/bodyChart/Bodychard front back left right.jpg', sort_order: 3 }
];

let hasEnsuredAnnotatedColumn = false;

const ensureAnnotatedImageColumn = async () => {
  if (hasEnsuredAnnotatedColumn) return;
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE body_charts ADD COLUMN IF NOT EXISTS annotated_image LONGTEXT NULL'
    );
    hasEnsuredAnnotatedColumn = true;
  } catch (error) {
    // If DB does not support IF NOT EXISTS, continue and let query surface real errors.
  }
};

const ensureDefaultBodyCharts = async (patientId, tenantId) => {
  const pid = parseInt(patientId, 10);
  const where = { patient_id: pid };
  if (tenantId) where.tenant_id = tenantId;

  const count = await prisma.bodyChart.count({ where });

  if (count > 0) return;

  await prisma.bodyChart.createMany({
    data: DEFAULT_BODY_CHARTS.map((chart) => ({
      patient_id: pid,
      title: chart.title,
      image_url: chart.image_url,
      sort_order: chart.sort_order,
      tenant_id: tenantId || null
    }))
  });
};

const getBodyChartsByPatientId = async (patientId, tenantId) => {
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

  await ensureAnnotatedImageColumn();
  await ensureDefaultBodyCharts(pid, tenantId);

  const where = { patient_id: pid };
  if (tenantId) where.tenant_id = tenantId;

  return await prisma.bodyChart.findMany({
    where,
    orderBy: [
      { sort_order: 'asc' },
      { id: 'asc' }
    ]
  });
};

const updateBodyChart = async (id, patientId, payload, tenantId) => {
  await ensureAnnotatedImageColumn();
  const cid = parseInt(id, 10);
  const pid = parseInt(patientId, 10);

  const where = { id: cid, patient_id: pid };
  if (tenantId) where.tenant_id = tenantId;

  const chart = await prisma.bodyChart.findFirst({ where });

  if (!chart) {
    const error = new Error('Body chart not found');
    error.statusCode = 404;
    throw error;
  }

  return await prisma.bodyChart.update({
    where: { id: cid },
    data: {
      annotated_image: payload.annotatedImage || null
    }
  });
};

module.exports = {
  getBodyChartsByPatientId,
  updateBodyChart
};
