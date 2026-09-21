const { PrismaClient } = require('@prisma/client');
const tenantContext = require('./tenantContext');

// Models that DO NOT have a direct tenant_id column in database
const tenantFreeModels = [
  'Tenant',
  'User',
  'PatientMedicalHistory',
  'PatientEmergencyContact',
  'InvoiceItem',
  'Integration',
  'communication_campaigns',
  'communication_messages',
  'communication_threads',
  'telehealth_sessions'
];

const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = tenantContext.getStore();

        if (tenantId && !tenantFreeModels.includes(model)) {
          // Operations that accept arbitrary ModelWhereInput
          if (['findMany', 'findFirst', 'count', 'deleteMany', 'updateMany'].includes(operation)) {
            args.where = { ...args.where, tenant_id: tenantId };
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
