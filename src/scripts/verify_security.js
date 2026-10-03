const jwt = require('jsonwebtoken');

const API_BASE = 'http://localhost:5000';
const JWT_SECRET = 'mySuperSecretKey123';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING MULTI-TENANT SAAS SECURITY TEST SUITE');
  console.log('====================================================\n');

  // Token for Admin A (Tenant 1, User 2)
  const tokenAdminA = jwt.sign(
    { id: 2, email: 'admin@deephysio.com', role: 'admin', tenant_id: 1, name: 'Admin User' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Token for Admin B (Tenant 2, User 9)
  const tokenAdminB = jwt.sign(
    { id: 9, email: 'abc@gmail.com', role: 'admin', tenant_id: 2, name: 'ABC Kumar' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Helper fetch with Bearer token
  const authFetch = (url, token, options = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
  };

  // -------------------------------------------------------------
  // TEST 1: Login as Admin A -> Expected: Only Clinic A data
  // -------------------------------------------------------------
  console.log('--- TEST 1: Login as Admin A -> Fetch Patients & Staff ---');
  const res1Patients = await authFetch(`${API_BASE}/api/patients`, tokenAdminA);
  const data1Patients = await res1Patients.json();
  const hasPatientB = data1Patients.data?.some(p => p.phone === '9876500002');
  console.log(`Patients returned: ${data1Patients.data?.length}. Contains Patient B (Clinic B)? ${hasPatientB}`);
  console.log(`TEST 1 RESULT: ${!hasPatientB ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // TEST 2: Open Audit Logs as Admin A -> Expected: Only Therapist A + Receptionist A + Billing A. NO Admin A.
  // -------------------------------------------------------------
  console.log('--- TEST 2: Open Audit Logs as Admin A ---');
  const res2 = await authFetch(`${API_BASE}/api/audit-logs`, tokenAdminA);
  const data2 = await res2.json();
  const logsA = data2.data?.logs || [];
  const rolesInA = [...new Set(logsA.map(l => l.user?.role))];
  const containsAdminA = logsA.some(l => l.user_id === 2 || l.details?.includes('Admin A'));
  const containsClinicB = logsA.some(l => l.tenant_id === 2 || l.details?.includes('Clinic B') || l.details?.includes('Admin B'));
  console.log(`Audit Logs count for Admin A: ${logsA.length}`);
  console.log(`Roles appearing in Admin A logs: ${rolesInA.join(', ')}`);
  console.log(`Contains Admin A own activity? ${containsAdminA}`);
  console.log(`Contains Clinic B activity? ${containsClinicB}`);
  console.log(`TEST 2 RESULT: ${!containsAdminA && !containsClinicB ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // TEST 3: Attempt to access Clinic B record IDs through API
  // -------------------------------------------------------------
  console.log('--- TEST 3: Admin A accessing Clinic B record IDs (Patient 12 belongs to Clinic B) ---');
  // Patient 12 belongs to Clinic B
  const res3Get = await authFetch(`${API_BASE}/api/patients/12`, tokenAdminA);
  console.log(`GET /api/patients/12 status: ${res3Get.status} (Expected: 404)`);

  const res3Put = await authFetch(`${API_BASE}/api/patients/12`, tokenAdminA, {
    method: 'PUT',
    body: JSON.stringify({ first_name: 'HackedBeta' })
  });
  console.log(`PUT /api/patients/12 status: ${res3Put.status} (Expected: 404)`);

  const res3Del = await authFetch(`${API_BASE}/api/patients/12`, tokenAdminA, {
    method: 'DELETE'
  });
  console.log(`DELETE /api/patients/12 status: ${res3Del.status} (Expected: 404)`);
  const test3Pass = res3Get.status === 404 && res3Put.status === 404 && res3Del.status === 404;
  console.log(`TEST 3 RESULT: ${test3Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // TEST 4: Login as Admin B -> Expected: Only Clinic B data
  // -------------------------------------------------------------
  console.log('--- TEST 4: Login as Admin B -> Fetch Patients ---');
  const res4Patients = await authFetch(`${API_BASE}/api/patients`, tokenAdminB);
  const data4Patients = await res4Patients.json();
  const hasPatientA = data4Patients.data?.some(p => p.phone === '9876500001');
  const hasOnlyPatientB = data4Patients.data?.some(p => p.phone === '9876500002');
  console.log(`Patients returned for Admin B: ${data4Patients.data?.length}. Contains Patient A (Clinic A)? ${hasPatientA}. Contains Patient B? ${hasOnlyPatientB}`);
  console.log(`TEST 4 RESULT: ${!hasPatientA && hasOnlyPatientB ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // TEST 5: Open Audit Logs as Admin B -> Expected: Only Therapist B + Receptionist B + Billing B. NO Admin B.
  // -------------------------------------------------------------
  console.log('--- TEST 5: Open Audit Logs as Admin B ---');
  const res5 = await authFetch(`${API_BASE}/api/audit-logs`, tokenAdminB);
  const data5 = await res5.json();
  const logsB = data5.data?.logs || [];
  const rolesInB = [...new Set(logsB.map(l => l.user?.role))];
  const containsAdminB = logsB.some(l => l.user_id === 9 || l.details?.includes('Admin B'));
  const containsClinicA = logsB.some(l => l.tenant_id === 1 || l.details?.includes('Clinic A') || l.details?.includes('Admin A'));
  console.log(`Audit Logs count for Admin B: ${logsB.length}`);
  console.log(`Roles appearing in Admin B logs: ${rolesInB.join(', ')}`);
  console.log(`Contains Admin B own activity? ${containsAdminB}`);
  console.log(`Contains Clinic A activity? ${containsClinicA}`);
  console.log(`TEST 5 RESULT: ${!containsAdminB && !containsClinicA ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // TEST 6: Try searching Clinic B data while logged in as Admin A
  // -------------------------------------------------------------
  console.log('--- TEST 6: Admin A searching Clinic B Patient "Beta" and Audit logs ---');
  const res6Audit = await authFetch(`${API_BASE}/api/audit-logs?search=ClinicB`, tokenAdminA);
  const data6Audit = await res6Audit.json();
  console.log(`Audit search 'ClinicB' count for Admin A: ${data6Audit.data?.logs?.length || 0}`);
  const test6Pass = (data6Audit.data?.logs?.length || 0) === 0;
  console.log(`TEST 6 RESULT: ${test6Pass ? 'PASS' : 'FAIL'}\n`);

  // -------------------------------------------------------------
  // TEST 7: Try changing clinicId manually in request body/query/URL
  // -------------------------------------------------------------
  console.log('--- TEST 7: Admin A attempting tenant injection (tenantId=2) in body & query ---');
  const res7AuditSpoof = await authFetch(`${API_BASE}/api/audit-logs?tenantId=2`, tokenAdminA);
  const data7AuditSpoof = await res7AuditSpoof.json();
  const anyClinicBLogs = data7AuditSpoof.data?.logs?.some(l => l.tenant_id === 2);
  console.log(`Did Admin A get Clinic 2 logs by setting ?tenantId=2? ${anyClinicBLogs}`);

  // Create patient with tenant_id spoofing
  const uniquePhone = '98' + Date.now().toString().slice(-8);
  const res7CreatePatient = await authFetch(`${API_BASE}/api/patients`, tokenAdminA, {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Spoof',
      lastName: 'Tenant',
      phone: uniquePhone,
      tenantId: 2,
      tenant_id: 2
    })
  });
  const data7CreatePatient = await res7CreatePatient.json();
  const assignedTenant = data7CreatePatient.data?.tenantId ?? data7CreatePatient.data?.tenant_id;
  console.log(`Patient created with body { tenant_id: 2 } assigned tenantId in response: ${assignedTenant}`);
  const test7Pass = !anyClinicBLogs && assignedTenant === 1;
  console.log(`TEST 7 RESULT: ${test7Pass ? 'PASS' : 'FAIL'}\n`);

  // Clean up spoof patient
  if (data7CreatePatient.data?.id) {
    await authFetch(`${API_BASE}/api/patients/${data7CreatePatient.data.id}`, tokenAdminA, { method: 'DELETE' });
  }

  // -------------------------------------------------------------
  // TEST 8: Try exporting Audit Logs as Admin A -> Expected: Only Clinic A staff
  // -------------------------------------------------------------
  console.log('--- TEST 8: Export Audit Logs as Admin A ---');
  const res8 = await authFetch(`${API_BASE}/api/audit-logs/export`, tokenAdminA);
  const csvContent = await res8.text();
  const csvHasAdminA = csvContent.includes('Admin A');
  const csvHasAdminB = csvContent.includes('Admin B');
  const csvHasClinicB = csvContent.includes('Clinic B') || csvContent.includes('ABC CLINIC');
  const csvHasTherapistA = csvContent.includes('Therapist A') || csvContent.includes('Therapist User');
  console.log(`CSV includes Admin A: ${csvHasAdminA}`);
  console.log(`CSV includes Admin B: ${csvHasAdminB}`);
  console.log(`CSV includes Clinic B: ${csvHasClinicB}`);
  console.log(`CSV includes Staff of Clinic A: ${csvHasTherapistA}`);
  const test8Pass = !csvHasAdminA && !csvHasAdminB && !csvHasClinicB && csvHasTherapistA;
  console.log(`TEST 8 RESULT: ${test8Pass ? 'PASS' : 'FAIL'}\n`);

  console.log('====================================================');
  console.log('ALL TESTS COMPLETED');
  console.log('====================================================');
}

runTests().catch(console.error);
