const prisma = require('../src/config/prisma');

async function main() {
  // 1. Check current state of all whatsapp_connections
  const connections = await prisma.$queryRawUnsafe('SELECT * FROM whatsapp_connections');
  console.log('=== Current WhatsApp Connections ===');
  for (const conn of connections) {
    console.log(`Tenant #${conn.tenant_id}: status=${conn.status}, phone=${conn.phone_number}`);
  }

  // 2. Clean up Tenant #6 if it has the same phone as Tenant #1
  const tenant1 = connections.find(c => c.tenant_id === 1);
  const tenant6 = connections.find(c => c.tenant_id === 6);

  if (tenant6 && tenant1) {
    const t1Phone = String(tenant1.phone_number || '').replace(/\D/g, '').slice(-10);
    const t6Phone = String(tenant6.phone_number || '').replace(/\D/g, '').slice(-10);
    
    if (t1Phone === t6Phone) {
      console.log(`\n⚠️  Tenant #6 shares phone ${tenant6.phone_number} with Tenant #1 (${tenant1.phone_number})`);
      console.log('Disconnecting Tenant #6 in DB...');
      await prisma.$executeRawUnsafe(
        "UPDATE whatsapp_connections SET status = 'DISCONNECTED', phone_number = NULL, last_error = 'Duplicate WhatsApp number cleaned up.' WHERE tenant_id = 6"
      );
      console.log('✅ Tenant #6 cleaned up.');
    } else {
      console.log('\nTenant #1 and #6 have different phone numbers. No cleanup needed.');
    }
  } else if (tenant6) {
    console.log('\nCleaning up Tenant #6 (no Tenant #1 found)...');
    await prisma.$executeRawUnsafe(
      "UPDATE whatsapp_connections SET status = 'DISCONNECTED', phone_number = NULL, last_error = 'Stale session cleaned up.' WHERE tenant_id = 6"
    );
    console.log('✅ Tenant #6 cleaned up.');
  }

  // 3. Show final state
  const final = await prisma.$queryRawUnsafe('SELECT * FROM whatsapp_connections');
  console.log('\n=== Final WhatsApp Connections ===');
  for (const conn of final) {
    console.log(`Tenant #${conn.tenant_id}: status=${conn.status}, phone=${conn.phone_number}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
