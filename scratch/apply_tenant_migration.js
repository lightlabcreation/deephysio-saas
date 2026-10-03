const prisma = require('../src/config/prisma');

async function migrate() {
  console.log('--- STARTING MULTI-TENANT SCHEMA MIGRATION ---');

  // 1. Update patients unique keys to be per-tenant
  try {
    console.log('1. Migrating patients unique constraints to per-tenant...');
    await prisma.$executeRawUnsafe('ALTER TABLE patients DROP INDEX patients_phone_key').catch(e => console.log('Index patients_phone_key already dropped or not present'));
    await prisma.$executeRawUnsafe('ALTER TABLE patients DROP INDEX patients_email_key').catch(e => console.log('Index patients_email_key already dropped or not present'));
    await prisma.$executeRawUnsafe('ALTER TABLE patients ADD UNIQUE KEY `patients_tenant_id_phone_key` (`tenant_id`, `phone`)').catch(e => console.log('patients_tenant_id_phone_key already exists'));
    await prisma.$executeRawUnsafe('ALTER TABLE patients ADD UNIQUE KEY `patients_tenant_id_email_key` (`tenant_id`, `email`)').catch(e => console.log('patients_tenant_id_email_key already exists'));
    console.log('✓ Patients unique constraints updated.');
  } catch (err) {
    console.error('Error updating patients indexes:', err.message);
  }

  // 2. Update invoices unique key to be per-tenant
  try {
    console.log('2. Migrating invoices unique constraint to per-tenant...');
    await prisma.$executeRawUnsafe('ALTER TABLE invoices DROP INDEX invoices_invoice_number_key').catch(e => console.log('Index invoices_invoice_number_key already dropped or not present'));
    await prisma.$executeRawUnsafe('ALTER TABLE invoices ADD UNIQUE KEY `invoices_tenant_id_invoice_number_key` (`tenant_id`, `invoice_number`)').catch(e => console.log('invoices_tenant_id_invoice_number_key already exists'));
    console.log('✓ Invoices unique constraint updated.');
  } catch (err) {
    console.error('Error updating invoices indexes:', err.message);
  }

  // 3. Add tenant_id to communication_campaigns
  try {
    console.log('3. Ensuring tenant_id in communication_campaigns...');
    await prisma.$executeRawUnsafe('ALTER TABLE communication_campaigns ADD COLUMN tenant_id INT DEFAULT NULL').catch(e => console.log('Column tenant_id already exists in communication_campaigns'));
    await prisma.$executeRawUnsafe('ALTER TABLE communication_campaigns ADD INDEX `idx_comm_campaigns_tenant` (`tenant_id`)').catch(e => console.log('Index idx_comm_campaigns_tenant already exists'));
    console.log('✓ communication_campaigns tenant_id ensured.');
  } catch (err) {
    console.error('Error on communication_campaigns:', err.message);
  }

  // 4. Add tenant_id to telehealth_sessions
  try {
    console.log('4. Ensuring tenant_id in telehealth_sessions...');
    await prisma.$executeRawUnsafe('ALTER TABLE telehealth_sessions ADD COLUMN tenant_id INT DEFAULT NULL').catch(e => console.log('Column tenant_id already exists in telehealth_sessions'));
    await prisma.$executeRawUnsafe('ALTER TABLE telehealth_sessions ADD INDEX `idx_telehealth_tenant` (`tenant_id`)').catch(e => console.log('Index idx_telehealth_tenant already exists'));
    console.log('✓ telehealth_sessions tenant_id ensured.');
  } catch (err) {
    console.error('Error on telehealth_sessions:', err.message);
  }

  console.log('--- MULTI-TENANT SCHEMA MIGRATION COMPLETED ---');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
