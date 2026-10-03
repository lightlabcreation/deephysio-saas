const { PrismaClient } = require('@prisma/client');
const tenantContext = require('./tenantContext');

const basePrisma = new PrismaClient();

// Models that DO NOT have a direct tenant_id column in database
const tenantFreeModels = [
  'Tenant',
  'PatientMedicalHistory',
  'PatientEmergencyContact',
  'InvoiceItem',
  'Integration'
];

const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async findUnique({ model, args, query }) {
        const tenantId = tenantContext.getStore();
        if (tenantId && !tenantFreeModels.includes(model)) {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          if (basePrisma[modelKey]) {
            return basePrisma[modelKey].findFirst({
              ...args,
              where: {
                ...(args?.where || {}),
                tenant_id: tenantId
              }
            });
          }
        }
        return query(args);
      },
      async findUniqueOrThrow({ model, args, query }) {
        const tenantId = tenantContext.getStore();
        if (tenantId && !tenantFreeModels.includes(model)) {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          if (basePrisma[modelKey]) {
            const result = await basePrisma[modelKey].findFirst({
              ...args,
              where: {
                ...(args?.where || {}),
                tenant_id: tenantId
              }
            });
            if (!result) {
              const error = new Error(`${model} not found in this clinic`);
              error.statusCode = 404;
              throw error;
            }
            return result;
          }
        }
        return query(args);
      },
      async update({ model, args, query }) {
        const tenantId = tenantContext.getStore();
        if (tenantId && !tenantFreeModels.includes(model)) {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          if (basePrisma[modelKey]) {
            const exists = await basePrisma[modelKey].findFirst({
              where: { ...(args?.where || {}), tenant_id: tenantId },
              select: { id: true }
            });
            if (!exists) {
              const error = new Error(`${model} not found in this clinic`);
              error.statusCode = 404;
              throw error;
            }
          }
        }
        return query(args);
      },
      async delete({ model, args, query }) {
        const tenantId = tenantContext.getStore();
        if (tenantId && !tenantFreeModels.includes(model)) {
          const modelKey = model.charAt(0).toLowerCase() + model.slice(1);
          if (basePrisma[modelKey]) {
            const exists = await basePrisma[modelKey].findFirst({
              where: { ...(args?.where || {}), tenant_id: tenantId },
              select: { id: true }
            });
            if (!exists) {
              const error = new Error(`${model} not found in this clinic`);
              error.statusCode = 404;
              throw error;
            }
          }
        }
        return query(args);
      },
      async upsert({ model, args, query }) {
        const tenantId = tenantContext.getStore();
        if (tenantId && !tenantFreeModels.includes(model)) {
          if (!args) args = {};
          if (args.create) {
            args.create = { ...args.create, tenant_id: tenantId };
          }
          if (args.update) {
            args.update = { ...args.update, tenant_id: tenantId };
          }
        }
        return query(args);
      },
      async $allOperations({ model, operation, args, query }) {
        const tenantId = tenantContext.getStore();

        if (tenantId && !tenantFreeModels.includes(model)) {
          if (!args) args = {};
          // Operations that accept arbitrary ModelWhereInput
          if (['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'deleteMany', 'updateMany'].includes(operation)) {
            args.where = { ...(args.where || {}), tenant_id: tenantId };
          }
          // Operations creating new records
          if (['create', 'createMany'].includes(operation)) {
            if (args.data) {
              if (Array.isArray(args.data)) {
                args.data = args.data.map(d => ({ ...d, tenant_id: tenantId }));
              } else {
                args.data.tenant_id = tenantId;
              }
            }
          }
        }
        
        return query(args);
      }
    }
  }
});

module.exports = prisma;
