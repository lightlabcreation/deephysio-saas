const prisma = require('../src/config/prisma');

async function inspect() {
  try {
    const dupes = await prisma.$queryRawUnsafe('SELECT invoice_number, count(*) as c FROM invoices GROUP BY invoice_number HAVING c > 1');
    console.log('DUPLICATE INVOICE NUMBERS:', dupes);

    const tenants = await prisma.tenant.findMany();
    console.log('TENANTS:', tenants);

    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, tenant_id: true }
    });
    console.log('USERS:', users);
  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    process.exit(0);
  }
}

inspect();
