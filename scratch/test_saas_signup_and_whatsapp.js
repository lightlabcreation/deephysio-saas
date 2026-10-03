const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');

const API_BASE = 'http://localhost:5000/api';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {}
  return { status: res.status, ok: res.ok, data: json };
}

async function runSaaSSignupAndWhatsAppTests() {
  console.log('================================================================');
  console.log('--- RUNNING SAAS NEW SIGNUP & WHATSAPP TENANT ISOLATION TEST ---');
  console.log('================================================================\n');

  const runId = Date.now().toString().slice(-6);

  // 1. New Admin C Registration via Public Auth API
  console.log('[STEP 1] Registering New Admin C via POST /api/auth/register...');
  const regEmailC = `adminC_${runId}@clinictest.com`;
  const regResC = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Dr. Carol Clinic C',
      email: regEmailC,
      password: 'SecurePassword123!',
      role: 'admin',
      clinicName: `Clinic C Health_${runId}`
    })
  });

  if (!regResC.ok) {
    throw new Error(`Failed to register Admin C: ${JSON.stringify(regResC.data)}`);
  }
  const tokenC = regResC.data?.data?.token;
  const userC = regResC.data?.data?.user;
  const tenantIdC = userC?.tenantId || userC?.tenant_id;
  console.log(`✓ Admin C registered successfully: User ID ${userC.id}, Tenant ID ${tenantIdC}`);

  // 2. New Admin D Registration via Public Auth API
  console.log('\n[STEP 2] Registering New Admin D via POST /api/auth/register...');
  const regEmailD = `adminD_${runId}@clinictest.com`;
  const regResD = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Dr. David Clinic D',
      email: regEmailD,
      password: 'SecurePassword123!',
      role: 'admin',
      clinicName: `Clinic D Rehab_${runId}`
    })
  });

  if (!regResD.ok) {
    throw new Error(`Failed to register Admin D: ${JSON.stringify(regResD.data)}`);
  }
  const tokenD = regResD.data?.data?.token;
  const userD = regResD.data?.data?.user;
  const tenantIdD = userD?.tenantId || userD?.tenant_id;
  console.log(`✓ Admin D registered successfully: User ID ${userD.id}, Tenant ID ${tenantIdD}`);

  if (!tenantIdC || !tenantIdD || tenantIdC === tenantIdD) {
    throw new Error(`CRITICAL ERROR: Invalid tenants: Tenant C = ${tenantIdC}, Tenant D = ${tenantIdD}!`);
  }
  console.log(`✓ VERIFIED: Admin C (Tenant ${tenantIdC}) and Admin D (Tenant ${tenantIdD}) have distinct tenants.`);

  const authHeaderC = { Authorization: `Bearer ${tokenC}` };
  const authHeaderD = { Authorization: `Bearer ${tokenD}` };

  // 3. Verify Fresh Account Zero-State (Admin C)
  console.log('\n[STEP 3] Verifying Fresh Zero-State for Admin C...');
  const [patientsC, apptsC, notesC, invoicesC, waStatusC] = await Promise.all([
    request('/patients', { headers: authHeaderC }),
    request('/appointments', { headers: authHeaderC }),
    request('/clinical-notes', { headers: authHeaderC }),
    request('/invoices', { headers: authHeaderC }),
    request('/settings/whatsapp/status', { headers: authHeaderC })
  ]);

  const pListC = Array.isArray(patientsC.data?.data) ? patientsC.data.data : (patientsC.data?.data?.patients || []);
  const aListC = Array.isArray(apptsC.data?.data) ? apptsC.data.data : [];
  const nListC = Array.isArray(notesC.data?.data) ? notesC.data.data : [];
  const iListC = Array.isArray(invoicesC.data?.data) ? invoicesC.data.data : [];
  const waC = waStatusC.data?.data;

  console.log(`  Patients count: ${pListC.length} (Expected: 0)`);
  console.log(`  Appointments count: ${aListC.length} (Expected: 0)`);
  console.log(`  Clinical notes count: ${nListC.length} (Expected: 0)`);
  console.log(`  Invoices count: ${iListC.length} (Expected: 0)`);
  console.log(`  WhatsApp status: "${waC?.status}" (Expected: DISCONNECTED), Phone: ${waC?.phoneNumber}`);

  if (pListC.length !== 0 || aListC.length !== 0 || nListC.length !== 0 || iListC.length !== 0) {
    throw new Error('FAILED: New Admin C saw pre-existing business data from other tenants!');
  }
  if (waC?.status !== 'DISCONNECTED' || waC?.phoneNumber) {
    throw new Error(`FAILED: New Admin C had pre-existing WhatsApp connection! ${JSON.stringify(waC)}`);
  }
  console.log('✓ VERIFIED: New Admin account starts with 100% clean, isolated zero-state.');

  // 4. Admin C connects a WhatsApp number
  console.log('\n[STEP 4] Simulating WhatsApp connection for Tenant C...');
  const sharedPhoneTest = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;
  
  // Set Tenant C as connected with sharedPhoneTest in whatsapp_connections table
  await prisma.$queryRawUnsafe(
    `INSERT INTO whatsapp_connections (tenant_id, phone_number, status, connected_at)
     VALUES (?, ?, 'CONNECTED', NOW())
     ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number), status = 'CONNECTED', connected_at = NOW()`,
    tenantIdC,
    sharedPhoneTest
  );
  console.log(`✓ Tenant C registered with WhatsApp number: ${sharedPhoneTest}`);

  // 5. Admin D checks WhatsApp status -> Must NOT see Tenant C's connection
  console.log('\n[STEP 5] Admin D querying WhatsApp status...');
  const waStatusD = await request('/settings/whatsapp/status', { headers: authHeaderD });
  const waD = waStatusD.data?.data;
  console.log(`  Admin D status: "${waD?.status}", phoneNumber: ${waD?.phoneNumber}`);

  if (waD?.status !== 'DISCONNECTED' || waD?.phoneNumber) {
    throw new Error(`CRITICAL LEAK: Admin D sees Tenant C WhatsApp data! Status: ${waD?.status}, Phone: ${waD?.phoneNumber}`);
  }
  console.log('✓ VERIFIED: Admin D does NOT see Tenant C\'s WhatsApp connection.');

  // 6. Admin D attempts to connect using the EXACT SAME WhatsApp number as Tenant C
  console.log('\n[STEP 6] Admin D attempting to connect using Tenant C\'s phone number...');
  const collisionAttempt = await request('/settings/whatsapp/connect', {
    method: 'POST',
    headers: authHeaderD,
    body: JSON.stringify({ phoneNumber: sharedPhoneTest })
  });

  console.log(`  Status code: ${collisionAttempt.status}`);
  console.log(`  Response message: "${collisionAttempt.data?.message}"`);

  // Verify response
  const expectedMsg = 'This WhatsApp number is already in use. Please use a different number.';
  if (collisionAttempt.status !== 400 || collisionAttempt.data?.message !== expectedMsg) {
    throw new Error(`FAILED: Expected 400 with "${expectedMsg}", got status ${collisionAttempt.status} and message "${collisionAttempt.data?.message}"`);
  }

  // Verify NO leak of Tenant C details
  const rawResponse = JSON.stringify(collisionAttempt.data || {});
  if (rawResponse.includes(String(tenantIdC)) || rawResponse.toLowerCase().includes('clinic c') || rawResponse.toLowerCase().includes('tenant #')) {
    throw new Error(`CRITICAL LEAK: Response leaked Tenant C info! Response: ${rawResponse}`);
  }
  console.log('✓ VERIFIED: WhatsApp number collision correctly rejected with NO tenant leakage.');

  // 7. Admin C creates data and verifies Admin D cannot access by direct ID
  console.log('\n[STEP 7] Admin C creates patient "Charlie", Admin D attempts cross-tenant access...');
  const createPatientC = await request('/patients', {
    method: 'POST',
    headers: authHeaderC,
    body: JSON.stringify({
      first_name: 'Charlie',
      last_name: 'Chaplin',
      email: `charlie_${runId}@example.com`,
      phone: `+9197${Math.floor(10000000 + Math.random() * 90000000)}`
    })
  });
  const patientC = createPatientC.data?.data;
  console.log(`✓ Admin C created patient: ID ${patientC.id} (${patientC.first_name} ${patientC.last_name})`);

  // Admin D tries to read Charlie by direct ID
  const directGetCharlieByD = await request(`/patients/${patientC.id}`, { headers: authHeaderD });
  console.log(`  Admin D GET /api/patients/${patientC.id} -> Status: ${directGetCharlieByD.status}`);
  if (directGetCharlieByD.status !== 404 && directGetCharlieByD.status !== 403) {
    throw new Error(`CRITICAL LEAK: Admin D was able to read Admin C's patient! Status: ${directGetCharlieByD.status}`);
  }

  // Admin D tries to edit Charlie
  const directPutCharlieByD = await request(`/patients/${patientC.id}`, {
    method: 'PUT',
    headers: authHeaderD,
    body: JSON.stringify({ first_name: 'HackedName' })
  });
  console.log(`  Admin D PUT /api/patients/${patientC.id} -> Status: ${directPutCharlieByD.status}`);
  if (directPutCharlieByD.status !== 404 && directPutCharlieByD.status !== 403) {
    throw new Error(`CRITICAL LEAK: Admin D was able to edit Admin C's patient! Status: ${directPutCharlieByD.status}`);
  }

  // Admin D tries to delete Charlie
  const directDelCharlieByD = await request(`/patients/${patientC.id}`, {
    method: 'DELETE',
    headers: authHeaderD
  });
  console.log(`  Admin D DELETE /api/patients/${patientC.id} -> Status: ${directDelCharlieByD.status}`);
  if (directDelCharlieByD.status !== 404 && directDelCharlieByD.status !== 403) {
    throw new Error(`CRITICAL LEAK: Admin D was able to delete Admin C's patient! Status: ${directDelCharlieByD.status}`);
  }
  console.log('✓ VERIFIED: Direct ID manipulation strictly blocked across tenants.');

  console.log('\n================================================================');
  console.log('>>> ALL SAAS MULTI-TENANT & WHATSAPP ISOLATION TESTS PASSED! <<<');
  console.log('================================================================\n');
}

runSaaSSignupAndWhatsAppTests()
  .catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
