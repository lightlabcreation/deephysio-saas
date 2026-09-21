const prisma = require('../../config/prisma');

const INVOICE_NUMBER_PREFIX = 'DEEPHYSIO-';

/** @param {number} seq 1-based sequence */
const formatInvoiceNumber = (seq) => {
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('Invalid invoice sequence');
  }
  const s = String(Math.floor(n));
  const width = Math.max(4, s.length);
  return `${INVOICE_NUMBER_PREFIX}${s.padStart(width, '0')}`;
};

const invoiceNumberRegex = new RegExp(
  `^${INVOICE_NUMBER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`
);

/**
 * @param {import('@prisma/client').Prisma.TransactionClient | typeof prisma} tx
 */
const getMaxInvoiceSequence = async (tx) => {
  const rows = await tx.invoice.findMany({
    select: { invoice_number: true }
  });
  let max = 0;
  for (const r of rows) {
    if (r.invoice_number) {
      const match = r.invoice_number.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num)) max = Math.max(max, num);
      }
    }
  }
  return max;
};

const getAllInvoices = async (filters) => {
  const { status, patientId } = filters;
  const where = {};

  if (status) where.status = status;
  if (patientId) where.patient_id = parseInt(patientId, 10);

  return await prisma.invoice.findMany({
    where,
    include: {
      patient: { select: { id: true, first_name: true, last_name: true } },
      items: true,
      payments: true
    },
    orderBy: { created_at: 'desc' }
  });
};

const getInvoiceById = async (id) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, first_name: true, last_name: true } },
      items: true,
      payments: true
    }
  });

  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
  }

  return invoice;
};

const getInvoiceDownloadPayload = async (id) => {
  const invoice = await getInvoiceById(id);
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    patient: invoice.patient,
    date: invoice.date,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    status: invoice.status,
    notes: invoice.notes,
    items: invoice.items || [],
    payments: invoice.payments || [],
    generated_at: new Date().toISOString()
  };
};

const createInvoice = async (data) => {
  const { patientId, date, items, notes } = data;

  let taxRate = 20;
  try {
    const settings = await prisma.globalSettings.findUnique({ where: { key: 'clinicProfile' } });
    if (settings && settings.value) {
      const profile = JSON.parse(settings.value);
      if (profile.taxRate !== undefined) taxRate = Number(profile.taxRate);
    }
  } catch (e) {
    console.error('Failed to fetch tax settings');
  }

  let subtotal = 0;
  if (Array.isArray(items)) {
    items.forEach((item) => {
      subtotal += (Number(item.rate) || 0) * (Number(item.qty) || 1);
    });
  }
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const MAX_RETRY = 50;
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRY; attempt += 1) {
    try {
      const maxSeq = await getMaxInvoiceSequence(prisma);
      const nextSeq = maxSeq + 1 + attempt;
      const invoice_number = `DEEPHYSIO-${String(nextSeq).padStart(4, '0')}`;

      // Check if invoice number already exists in DB
      const existing = await prisma.invoice.findUnique({
        where: { invoice_number }
      });
      if (existing) {
        continue;
      }

      return await prisma.invoice.create({
        data: {
          invoice_number,
          patient_id: Number(patientId),
          date: date ? new Date(date) : new Date(),
          subtotal,
          tax,
          total,
          notes: notes || null,
          status: 'PENDING',
          items: {
            create: (items || []).map((item) => ({
              service: item.service,
              rate: Number(item.rate) || 0,
              qty: Number(item.qty) || 1
            }))
          }
        },
        include: {
          items: true,
          patient: true
        }
      });
    } catch (e) {
      lastErr = e;
      if (e?.code === 'P2002' || (e?.message && e.message.includes('Unique constraint'))) {
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Could not allocate unique invoice number');
};

const deleteInvoice = async (id) => {
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
  }

  await prisma.invoiceItem.deleteMany({ where: { invoice_id: id } });
  await prisma.payment.deleteMany({ where: { invoice_id: id } });

  return await prisma.invoice.delete({ where: { id } });
};

module.exports = {
  getAllInvoices,
  getInvoiceById,
  getInvoiceDownloadPayload,
  createInvoice,
  deleteInvoice
};
