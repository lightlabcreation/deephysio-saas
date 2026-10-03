const prisma = require('./src/config/prisma');

async function main() {
  const patients = await prisma.patient.findMany({ where: { tenant_id: 1, is_deleted: false } });
  console.log('PATIENTS_COUNT:', patients.length);
  console.log('PATIENTS:', JSON.stringify(patients.map(p => ({
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    name: p.name,
    phone: p.phone
  })), null, 2));

  const logs = await prisma.$queryRawUnsafe(
    'SELECT id, recipient_phone, recipient_name, recipient_type, event_type, status, message_body, created_at FROM whatsapp_notification_logs WHERE tenant_id = 1 ORDER BY id DESC LIMIT 15'
  );
  console.log('LOGS:', JSON.stringify(logs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
