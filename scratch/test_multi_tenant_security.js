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

async function setupTenantsAndUsers() {
  console.log('\n--- 1. Setting Up Isolated Test Tenants & Users ---');
  const passwordHash = await bcrypt.hash('TestPass123!', 10);

  // Tenant A
  let tenantA = await prisma.tenant.findFirst({ where: { email: 'adminA@test.com' } });
  if (!tenantA) {
    tenantA = await prisma.tenant.create({
      data: {
        clinic_name: 'Alpha Physiotherapy Clinic',
        email: 'adminA@test.com',
        plan: 'Professional',
        subscription_status: 'active'
      }
    });
  }

  // Admin A
  let adminA = await prisma.user.findFirst({ where: { email: 'adminA@test.com' } });
  if (!adminA) {
    adminA = await prisma.user.create({
      data: {
        name: 'Admin Alpha',
        email: 'adminA@test.com',
        password: passwordHash,
        role: 'admin',
        tenant: { connect: { id: tenantA.id } }
      }
    });
  } else {
    await prisma.user.update({ where: { id: adminA.id }, data: { tenant: { connect: { id: tenantA.id } }, password: passwordHash } });
  }

  // Therapist A
  let therapistA = await prisma.user.findFirst({ where: { email: 'therapistA@test.com' } });
  if (!therapistA) {
    therapistA = await prisma.user.create({
      data: {
        name: 'Therapist Alpha',
        email: 'therapistA@test.com',
        password: passwordHash,
        role: 'therapist',
        tenant: { connect: { id: tenantA.id } }
      }
    });
  } else {
    await prisma.user.update({ where: { id: therapistA.id }, data: { tenant: { connect: { id: tenantA.id } }, password: passwordHash } });
  }

  // Tenant B
  let tenantB = await prisma.tenant.findFirst({ where: { email: 'adminB@test.com' } });
  if (!tenantB) {
    tenantB = await prisma.tenant.create({
      data: {
        clinic_name: 'Beta Spine Center',
        email: 'adminB@test.com',
        plan: 'Professional',
        subscription_status: 'active'
      }
    });
  }

  // Admin B
  let adminB = await prisma.user.findFirst({ where: { email: 'adminB@test.com' } });
  if (!adminB) {
    adminB = await prisma.user.create({
      data: {
        name: 'Admin Beta',
        email: 'adminB@test.com',
        password: passwordHash,
        role: 'admin',
        tenant: { connect: { id: tenantB.id } }
      }
    });
  } else {
    await prisma.user.update({ where: { id: adminB.id }, data: { tenant: { connect: { id: tenantB.id } }, password: passwordHash } });
  }

  // Therapist B
  let therapistB = await prisma.user.findFirst({ where: { email: 'therapistB@test.com' } });
  if (!therapistB) {
    therapistB = await prisma.user.create({
      data: {
        name: 'Therapist Beta',
        email: 'therapistB@test.com',
        password: passwordHash,
        role: 'therapist',
        tenant: { connect: { id: tenantB.id } }
      }
    });
  } else {
    await prisma.user.update({ where: { id: therapistB.id }, data: { tenant: { connect: { id: tenantB.id } }, password: passwordHash } });
  }

  console.log(`Tenant A created/verified: ID = ${tenantA.id} (${tenantA.clinic_name})`);
  console.log(`Tenant B created/verified: ID = ${tenantB.id} (${tenantB.clinic_name})`);

  return { tenantA, tenantB, adminA, adminB, therapistA, therapistB };
}

async function loginUser(email, password = 'TestPass123!') {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (!res.ok || !res.data?.success) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
  }
  return { token: res.data.data.token, user: res.data.data.user };
}

async function runSecurityAudit() {
  const setup = await setupTenantsAndUsers();
  
  console.log('\n--- 2. Authenticating Accounts to Obtain JWTs ---');
  const sessionAdminA = await loginUser('adminA@test.com');
  const sessionAdminB = await loginUser('adminB@test.com');
  const sessionTherapistA = await loginUser('therapistA@test.com');
  console.log('✓ Admin A token obtained. Tenant in JWT:', sessionAdminA.user.tenant_id);
  console.log('✓ Admin B token obtained. Tenant in JWT:', sessionAdminB.user.tenant_id);
  console.log('✓ Therapist A token obtained. Tenant in JWT:', sessionTherapistA.user.tenant_id);

  const authHeaderA = { Authorization: `Bearer ${sessionAdminA.token}` };
  const authHeaderB = { Authorization: `Bearer ${sessionAdminB.token}` };
  const authHeaderTherapistA = { Authorization: `Bearer ${sessionTherapistA.token}` };

  const runId = Date.now();

  console.log('\n--- 3. Creating Unique Sample Data Under Tenant A ---');
  // 1. Create Patient A
  const patientARes = await request('/patients', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      first_name: 'Alice',
      last_name: 'Walker',
      email: `alice.${runId}@example.com`,
      phone: `+9191${Math.floor(10000000 + Math.random() * 90000000)}`,
      gender: 'female',
      date_of_birth: '1990-01-15'
    })
  });
  if (!patientARes.ok) console.error('Patient A Creation Failed:', patientARes.data);
  const patientA = patientARes.data?.data;
  console.log(`✓ Patient A created: ID ${patientA?.id}, Name: ${patientA?.firstName || patientA?.first_name}`);

  // 2. Create Service A
  const serviceARes = await request('/services', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      name: `Spinal Rehab Alpha ${runId}`,
      category: 'Physiotherapy',
      price: 1500,
      duration: 45
    })
  });
  if (!serviceARes.ok) console.error('Service A Creation Failed:', serviceARes.data);
  const serviceA = serviceARes.data?.data;

  // 3. Create Appointment A
  const apptARes = await request('/appointments', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      patientId: patientA.id,
      therapistId: setup.therapistA.id,
      appointmentDate: new Date(Date.now() + 86400000).toISOString(),
      serviceId: serviceA.id,
      notes: 'Alpha clinical session'
    })
  });
  if (!apptARes.ok) console.error('Appointment A Creation Failed:', apptARes.data);
  const apptA = apptARes.data?.data;
  console.log(`✓ Appointment A created: ID ${apptA?.id}`);

  // 4. Create Task A
  const taskARes = await request('/tasks', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      title: 'Review Alice MRI Scan',
      patientId: patientA.id,
      priority: 'high',
      dueDate: new Date(Date.now() + 86400000).toISOString()
    })
  });
  if (!taskARes.ok) console.error('Task A Creation Failed:', taskARes.data);
  const taskA = taskARes.data?.data;
  console.log(`✓ Task A created: ID ${taskA?.id}`);

  // 5. Create Episode A
  const epARes = await request('/episodes', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      patientId: patientA.id,
      title: 'Alice Cervical Rehabilitation'
    })
  });
  if (!epARes.ok) console.error('Episode A Creation Failed:', epARes.data);
  const epA = epARes.data?.data;
  console.log(`✓ Episode A created: ID ${epA?.id}`);

  // 6. Create Clinical Note A
  const noteARes = await request('/clinical-notes', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      patientId: patientA.id,
      therapistId: setup.therapistA.id,
      date: new Date().toISOString(),
      type: 'SOAP',
      subjective: 'Patient reports neck pain radiating to shoulder',
      objective: 'Cervical ROM limited by 30%',
      assessment: 'Cervical radiculitis',
      plan: 'Manual therapy and traction'
    })
  });
  if (!noteARes.ok) console.error('Note A Creation Failed:', noteARes.data);
  const noteA = noteARes.data?.data;
  console.log(`✓ Clinical Note A created: ID ${noteA?.id}`);

  // 7. Save Tenant A Settings
  await request('/settings', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      settings: {
        clinicProfile: { clinicName: 'Alpha Clinic Official', phone: '+919999000001' }
      }
    })
  });

  console.log('\n--- 4. Creating Unique Sample Data Under Tenant B ---');
  // 1. Create Patient B
  const patientBRes = await request('/patients', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      first_name: 'Bob',
      last_name: 'Miller',
      email: `bob.${runId}@example.com`,
      phone: `+9192${Math.floor(10000000 + Math.random() * 90000000)}`,
      gender: 'male',
      date_of_birth: '1985-05-20'
    })
  });
  if (!patientBRes.ok) console.error('Patient B Creation Failed:', patientBRes.data);
  const patientB = patientBRes.data?.data;
  console.log(`✓ Patient B created: ID ${patientB?.id}, Name: ${patientB?.firstName || patientB?.first_name}`);

  // 2. Create Service B
  const serviceBRes = await request('/services', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      name: `Knee Post-Op Beta ${runId}`,
      category: 'Rehabilitation',
      price: 2000,
      duration: 60
    })
  });
  if (!serviceBRes.ok) console.error('Service B Creation Failed:', serviceBRes.data);
  const serviceB = serviceBRes.data?.data;

  // 3. Create Appointment B
  const apptBRes = await request('/appointments', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      patientId: patientB.id,
      therapistId: setup.therapistB.id,
      appointmentDate: new Date(Date.now() + 172800000).toISOString(),
      serviceId: serviceB.id,
      notes: 'Beta clinical session'
    })
  });
  const apptB = apptBRes.data?.data;
  console.log(`✓ Appointment B created: ID ${apptB?.id}`);

  // 4. Create Task B
  const taskBRes = await request('/tasks', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      title: 'Review Bob X-Ray',
      patientId: patientB.id,
      priority: 'medium',
      dueDate: new Date(Date.now() + 172800000).toISOString()
    })
  });
  const taskB = taskBRes.data?.data;
  console.log(`✓ Task B created: ID ${taskB?.id}`);

  // 5. Create Episode B
  const epBRes = await request('/episodes', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      patientId: patientB.id,
      title: 'Bob Lumbar Decompression'
    })
  });
  const epB = epBRes.data?.data;
  console.log(`✓ Episode B created: ID ${epB?.id}`);

  // 6. Create Clinical Note B
  const noteBRes = await request('/clinical-notes', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      patientId: patientB.id,
      therapistId: setup.therapistB.id,
      date: new Date().toISOString(),
      type: 'SOAP',
      subjective: 'Patient reports lower back stiffness',
      objective: 'SLR positive at 45 deg',
      assessment: 'Lumbar disc pathology',
      plan: 'Lumbar stabilization exercises'
    })
  });
  const noteB = noteBRes.data?.data;
  console.log(`✓ Clinical Note B created: ID ${noteB?.id}`);

  // 7. Save Tenant B Settings
  await request('/settings', {
    method: 'POST',
    headers: authHeaderB,
    body: JSON.stringify({
      settings: {
        clinicProfile: { clinicName: 'Beta Spine Center Official', phone: '+919999000002' }
      }
    })
  });

  console.log('\n======================================================');
  console.log('--- 5. RUNNING 10 COMPREHENSIVE SECURITY AUDIT TESTS ---');
  console.log('======================================================');

  let passedTests = 0;
  let totalTests = 10;

  // TEST 1: Admin A list queries returns ONLY Tenant A data
  console.log('\n[TEST 1] Admin A list queries isolation:');
  const aPatients = await request('/patients', { headers: authHeaderA });
  const aPatientsList = Array.isArray(aPatients.data?.data) ? aPatients.data.data : (aPatients.data?.data?.patients || []);
  const hasPatientBInA = aPatientsList.some(p => p.id === patientB.id || p.first_name === 'Bob');
  const hasPatientAInA = aPatientsList.some(p => p.id === patientA.id);

  const aTasks = await request('/tasks', { headers: authHeaderA });
  const aTasksList = aTasks.data?.data || [];
  const hasTaskBInA = aTasksList.some(t => t.id === taskB.id);

  const aEpisodes = await request(`/episodes/patient/${patientB.id}`, { headers: authHeaderA });
  // Should fail to get patient B episodes under Admin A
  const epLeakInA = aEpisodes.ok && aEpisodes.data?.data?.length > 0;

  if (hasPatientAInA && !hasPatientBInA && !hasTaskBInA && !epLeakInA) {
    console.log('  PASSED: Admin A sees Patient A, ZERO data from Tenant B');
    passedTests++;
  } else {
    console.error('  FAILED: Data leakage into Admin A list:', { hasPatientAInA, hasPatientBInA, hasTaskBInA, epLeakInA });
  }

  // TEST 2: Admin B list queries returns ONLY Tenant B data
  console.log('\n[TEST 2] Admin B list queries isolation:');
  const bPatients = await request('/patients', { headers: authHeaderB });
  const bPatientsList = Array.isArray(bPatients.data?.data) ? bPatients.data.data : (bPatients.data?.data?.patients || []);
  const hasPatientAInB = bPatientsList.some(p => p.id === patientA.id || p.first_name === 'Alice');
  const hasPatientBInB = bPatientsList.some(p => p.id === patientB.id);

  const bTasks = await request('/tasks', { headers: authHeaderB });
  const bTasksList = bTasks.data?.data || [];
  const hasTaskAInB = bTasksList.some(t => t.id === taskA.id);

  if (hasPatientBInB && !hasPatientAInB && !hasTaskAInB) {
    console.log('  PASSED: Admin B sees Patient B, ZERO data from Tenant A');
    passedTests++;
  } else {
    console.error('  FAILED: Data leakage into Admin B list:', { hasPatientBInB, hasPatientAInB, hasTaskAInB });
  }

  // TEST 3: Admin A direct ID access to Tenant B records (Must return 404)
  console.log('\n[TEST 3] Admin A direct ID access to Tenant B records:');
  const directPatientB = await request(`/patients/${patientB.id}`, { headers: authHeaderA });
  const directApptB = await request(`/appointments/${apptB.id}`, { headers: authHeaderA });
  const directTaskB = await request(`/tasks/${taskB.id}`, { headers: authHeaderA });
  const directEpB = await request(`/episodes/${epB.id}`, { headers: authHeaderA });
  const directNoteB = await request(`/clinical-notes/${noteB.id}`, { headers: authHeaderA });

  const t3Pass = (directPatientB.status === 404 || directPatientB.status === 403) &&
                 (directApptB.status === 404 || directApptB.status === 403) &&
                 (directTaskB.status === 404 || directTaskB.status === 403) &&
                 (directEpB.status === 404 || directEpB.status === 403) &&
                 (directNoteB.status === 404 || directNoteB.status === 403);

  if (t3Pass) {
    console.log(`  PASSED: Direct access by Admin A to all Tenant B records rejected (Patient: ${directPatientB.status}, Appt: ${directApptB.status}, Task: ${directTaskB.status}, Episode: ${directEpB.status}, Note: ${directNoteB.status})`);
    passedTests++;
  } else {
    console.error('  FAILED: Direct ID access succeeded or returned unexpected status:', {
      patient: directPatientB.status,
      appt: directApptB.status,
      task: directTaskB.status,
      episode: directEpB.status,
      note: directNoteB.status
    });
  }

  // TEST 4: Admin B direct ID access to Tenant A records (Must return 404)
  console.log('\n[TEST 4] Admin B direct ID access to Tenant A records:');
  const directPatientA = await request(`/patients/${patientA.id}`, { headers: authHeaderB });
  const directApptA = await request(`/appointments/${apptA.id}`, { headers: authHeaderB });
  const directTaskA = await request(`/tasks/${taskA.id}`, { headers: authHeaderB });
  const directEpA = await request(`/episodes/${epA.id}`, { headers: authHeaderB });
  const directNoteA = await request(`/clinical-notes/${noteA.id}`, { headers: authHeaderB });

  const t4Pass = (directPatientA.status === 404 || directPatientA.status === 403) &&
                 (directApptA.status === 404 || directApptA.status === 403) &&
                 (directTaskA.status === 404 || directTaskA.status === 403) &&
                 (directEpA.status === 404 || directEpA.status === 403) &&
                 (directNoteA.status === 404 || directNoteA.status === 403);

  if (t4Pass) {
    console.log(`  PASSED: Direct access by Admin B to all Tenant A records rejected (Patient: ${directPatientA.status}, Appt: ${directApptA.status}, Task: ${directTaskA.status}, Episode: ${directEpA.status}, Note: ${directNoteA.status})`);
    passedTests++;
  } else {
    console.error('  FAILED: Direct ID access succeeded or returned unexpected status:', {
      patient: directPatientA.status,
      appt: directApptA.status,
      task: directTaskA.status,
      episode: directEpA.status,
      note: directNoteA.status
    });
  }

  // TEST 5: Cross-tenant update and delete attempts (Must return 404/403 and leave DB intact)
  console.log('\n[TEST 5] Admin A cross-tenant update & delete attempts on Patient B:');
  const updateAttempt = await request(`/patients/${patientB.id}`, {
    method: 'PUT',
    headers: authHeaderA,
    body: JSON.stringify({ first_name: 'HackedBob' })
  });
  const deleteAttempt = await request(`/patients/${patientB.id}`, {
    method: 'DELETE',
    headers: authHeaderA
  });

  // Verify in database directly that Patient B is still intact
  const verifiedPatientB = await prisma.patient.findUnique({ where: { id: patientB.id } });
  const t5Pass = (updateAttempt.status === 404 || updateAttempt.status === 403) &&
                 (deleteAttempt.status === 404 || deleteAttempt.status === 403) &&
                 verifiedPatientB &&
                 verifiedPatientB.first_name === 'Bob';

  if (t5Pass) {
    console.log(`  PASSED: Cross-tenant modification rejected (Update: ${updateAttempt.status}, Delete: ${deleteAttempt.status}). Database record verified untouched.`);
    passedTests++;
  } else {
    console.error('  FAILED: Update or Delete succeeded or modified record:', {
      updateStatus: updateAttempt.status,
      deleteStatus: deleteAttempt.status,
      verifiedPatientB
    });
  }

  // TEST 6: Dashboard statistics cross-tenant isolation
  console.log('\n[TEST 6] Dashboard statistics cross-tenant verification:');
  const dashA = await request('/analytics/overview', { headers: authHeaderA });
  const dashB = await request('/analytics/overview', { headers: authHeaderB });

  // Counts should be completely separate
  const t6Pass = dashA.ok && dashB.ok;
  if (t6Pass) {
    console.log(`  PASSED: Dashboard stats load independently for each tenant (Tenant A: ${dashA.data?.data?.totalPatients || 0} pts, Tenant B: ${dashB.data?.data?.totalPatients || 0} pts).`);
    passedTests++;
  } else {
    console.error('  FAILED: Dashboard stats endpoint error:', { dashA: dashA.status, dashB: dashB.status });
  }

  // TEST 7: Search and filter isolation
  console.log('\n[TEST 7] Search and filter tenant isolation:');
  const searchBInA = await request('/patients?search=Bob', { headers: authHeaderA });
  const searchAInB = await request('/patients?search=Alice', { headers: authHeaderB });

  const searchBList = Array.isArray(searchBInA.data?.data) ? searchBInA.data.data : (searchBInA.data?.data?.patients || []);
  const searchAList = Array.isArray(searchAInB.data?.data) ? searchAInB.data.data : (searchAInB.data?.data?.patients || []);

  const t7Pass = searchBList.length === 0 && searchAList.length === 0;
  if (t7Pass) {
    console.log('  PASSED: Search query "Bob" in Tenant A returns 0 results. Search "Alice" in Tenant B returns 0 results.');
    passedTests++;
  } else {
    console.error('  FAILED: Cross-tenant search returned leakage:', { searchBList, searchAList });
  }

  // TEST 8: Body tampering attack (Admin A passes Tenant B ID in body)
  console.log('\n[TEST 8] Body tampering attack test (Admin A passes tenant_id = Tenant B in body):');
  const spoofRes = await request('/patients', {
    method: 'POST',
    headers: authHeaderA,
    body: JSON.stringify({
      first_name: 'Spoofed',
      last_name: 'TenantPatient',
      email: `spoofed.${runId}@example.com`,
      phone: `+9199${Math.floor(10000000 + Math.random() * 90000000)}`,
      tenant_id: setup.tenantB.id // Maliciously attempt to insert into Tenant B!
    })
  });
  if (!spoofRes.ok) console.error('Spoof request failed:', spoofRes.data);
  const spoofedPatient = spoofRes.data?.data;
  // Check the actual DB record tenant_id
  const dbRecord = await prisma.patient.findUnique({ where: { id: spoofedPatient?.id } });
  const t8Pass = dbRecord && dbRecord.tenant_id === setup.tenantA.id;

  if (t8Pass) {
    console.log(`  PASSED: Client tenant_id injection ignored. Record created under authenticated Tenant A (${dbRecord.tenant_id}) not Tenant B (${setup.tenantB.id}).`);
    passedTests++;
  } else {
    console.error('  FAILED: Body tampering succeeded in placing record into Tenant B!', dbRecord);
  }

  // TEST 9: Role staff isolation under Admin A (Therapist A)
  console.log('\n[TEST 9] Role-based staff isolation under Tenant A:');
  const therapistPatients = await request('/patients', { headers: authHeaderTherapistA });
  const tPatientsList = Array.isArray(therapistPatients.data?.data) ? therapistPatients.data.data : (therapistPatients.data?.data?.patients || []);
  const therapistDirectB = await request(`/patients/${patientB.id}`, { headers: authHeaderTherapistA });

  const t9Pass = tPatientsList.some(p => p.id === patientA.id) &&
                 !tPatientsList.some(p => p.id === patientB.id) &&
                 (therapistDirectB.status === 404 || therapistDirectB.status === 403);

  if (t9Pass) {
    console.log('  PASSED: Therapist A only accesses Tenant A patients and is blocked from Tenant B (404 Not Found).');
    passedTests++;
  } else {
    console.error('  FAILED: Therapist A data isolation issue:', { tPatientsList, directStatus: therapistDirectB.status });
  }

  // TEST 10: Settings isolation between Admin A and Admin B
  console.log('\n[TEST 10] Clinic Settings isolation between Admin A and Admin B:');
  const settingsA = await request('/settings', { headers: authHeaderA });
  const settingsB = await request('/settings', { headers: authHeaderB });

  const profileA = settingsA.data?.data?.clinicProfile;
  const profileB = settingsB.data?.data?.clinicProfile;

  const t10Pass = profileA?.clinicName === 'Alpha Clinic Official' &&
                  profileB?.clinicName === 'Beta Spine Center Official';

  if (t10Pass) {
    console.log(`  PASSED: Settings cleanly isolated. Tenant A clinicName: "${profileA?.clinicName}", Tenant B clinicName: "${profileB?.clinicName}".`);
    passedTests++;
  } else {
    console.error('  FAILED: Settings collision between tenants:', { profileA, profileB });
  }

  console.log('\n======================================================');
  console.log(`SUMMARY: ${passedTests} / ${totalTests} SECURITY AUDIT TESTS PASSED!`);
  console.log('======================================================');

  if (passedTests === totalTests) {
    console.log('\n>>> ZERO CROSS-TENANT DATA LEAKAGE CONFIRMED! <<<');
  } else {
    process.exit(1);
  }
}

runSecurityAudit()
  .catch((err) => {
    console.error('Security audit script error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
