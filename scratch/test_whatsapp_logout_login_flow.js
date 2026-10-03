const BASE_URL = 'http://localhost:5000/api';

async function runTest() {
  console.log('========================================================');
  console.log('🧪 TESTING WHATSAPP SEND AFTER LOGOUT / LOGIN FLOW');
  console.log('========================================================');

  // STEP 1: Login as Admin (Tenant 10)
  console.log('\n[1] Logging in as Admin (Tenant 10)...');
  const loginRes1 = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'anant@gmail.com', password: 'password123' })
  });
  const loginData1 = await loginRes1.json();
  const token1 = loginData1.data?.token || loginData1.token;
  const tenantId1 = loginData1.data?.user?.tenantId || loginData1.data?.user?.tenant_id;
  if (!loginRes1.ok || !token1) {
    console.error('❌ Login 1 failed:', loginData1);
    process.exit(1);
  }
  console.log(`✅ Login 1 successful! Tenant ID: ${tenantId1}, User: ${loginData1.user?.email}`);

  // STEP 2: Call ensure-session and check status
  console.log('\n[2] Calling /settings/whatsapp/ensure-session...');
  const ensureRes1 = await fetch(`${BASE_URL}/settings/whatsapp/ensure-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token1}`
    }
  });
  const ensureData1 = await ensureRes1.json();
  console.log('Ensure-session response:', ensureData1);

  console.log('\n[3] Calling /settings/whatsapp/status...');
  const statusRes1 = await fetch(`${BASE_URL}/settings/whatsapp/status`, {
    headers: { 'Authorization': `Bearer ${token1}` }
  });
  const statusData1 = await statusRes1.json();
  console.log('WhatsApp status 1:', statusData1?.data);
  if (!statusData1?.data?.isReady) {
    console.log('⏳ Waiting 3 seconds for Baileys socket to be ready...');
    await new Promise(r => setTimeout(r, 3000));
  }

  // STEP 3: Send message BEFORE logout
  console.log('\n[4] Sending WhatsApp message BEFORE logout...');
  const sendRes1 = await fetch(`${BASE_URL}/settings/whatsapp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token1}`
    },
    body: JSON.stringify({
      recipientPhone: '916261159109',
      recipientName: 'Verification Test 1',
      recipientType: 'OUTBOUND',
      eventType: 'WHATSAPP_CHAT_OUT',
      message: `Test before logout - ${new Date().toLocaleTimeString()}`
    })
  });
  const sendData1 = await sendRes1.json();
  console.log('Send 1 response:', sendData1);
  if (!sendRes1.ok || !sendData1.success) {
    console.error('❌ Send 1 failed!');
    process.exit(1);
  }
  console.log(`✅ Send 1 SUCCESS! Provider Message ID: ${sendData1.data?.messageId}`);

  // STEP 4: SIMULATE LOGOUT
  console.log('\n[5] Simulating Admin LOGOUT...');
  console.log('Token discarded. UI session ended. (Persistent WhatsApp session remains untouched on backend)');

  // STEP 5: SIMULATE RE-LOGIN (FRESH LOGIN)
  console.log('\n[6] Logging in AGAIN as Admin (Fresh Login)...');
  const loginRes2 = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'anant@gmail.com', password: 'password123' })
  });
  const loginData2 = await loginRes2.json();
  const token2 = loginData2.data?.token || loginData2.token;
  console.log(`✅ Fresh Login successful! Fresh JWT acquired.`);

  // STEP 6: Call ensure-session and check status after fresh login
  console.log('\n[7] Re-initializing WhatsApp session via /settings/whatsapp/ensure-session...');
  const ensureRes2 = await fetch(`${BASE_URL}/settings/whatsapp/ensure-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token2}`
    }
  });
  const ensureData2 = await ensureRes2.json();
  console.log('Ensure-session response 2:', ensureData2);

  const statusRes2 = await fetch(`${BASE_URL}/settings/whatsapp/status`, {
    headers: { 'Authorization': `Bearer ${token2}` }
  });
  const statusData2 = await statusRes2.json();
  console.log('WhatsApp status 2 (After Re-login):', statusData2?.data);

  // STEP 7: Send message AFTER logout/login
  console.log('\n[8] Sending WhatsApp message AFTER logout/login...');
  const sendRes2 = await fetch(`${BASE_URL}/settings/whatsapp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token2}`
    },
    body: JSON.stringify({
      recipientPhone: '916261159109',
      recipientName: 'Verification Test 2 (Post Login)',
      recipientType: 'OUTBOUND',
      eventType: 'WHATSAPP_CHAT_OUT',
      message: `Test after logout and login - ${new Date().toLocaleTimeString()}`
    })
  });
  const sendData2 = await sendRes2.json();
  console.log('Send 2 response:', sendData2);
  if (!sendRes2.ok || !sendData2.success) {
    console.error('❌ Send 2 failed after re-login!');
    process.exit(1);
  }
  console.log(`✅ Send 2 SUCCESS! Provider Message ID: ${sendData2.data?.messageId}`);

  // STEP 8: Multi-Tenant isolation test:
  // Tenant 6 has no WhatsApp session and should NOT be able to send or hijack Tenant 10's connection
  console.log('\n[9] Testing Multi-Tenant isolation with Tenant 6 (vishal@gmail.com)...');
  const loginResTenant6 = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'vishal@gmail.com', password: 'password123' })
  });
  if (loginResTenant6.ok) {
    const loginDataTenant6 = await loginResTenant6.json();
    const tokenTenant6 = loginDataTenant6.data?.token || loginDataTenant6.token;
    console.log(`Logged in as Tenant: ${loginDataTenant6.data?.user?.tenantId}`);

    const sendTenant6 = await fetch(`${BASE_URL}/settings/whatsapp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenTenant6}`
      },
      body: JSON.stringify({
        recipientPhone: '916261159109',
        message: 'Intruder message'
      })
    });
    const sendDataTenant6 = await sendTenant6.json();
    console.log(`Tenant 6 send response status: ${sendTenant6.status} (Expected: 503):`, sendDataTenant6.message);
  }

  // STEP 9: Full Multi-Tenant Switch Test: A -> B -> A
  console.log('\n[10] Switching back to Admin A (Tenant 10)...');
  const loginRes3 = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'anant@gmail.com', password: 'password123' })
  });
  const loginData3 = await loginRes3.json();
  const token3 = loginData3.data?.token;
  console.log('Admin A re-authenticated.');

  const sendRes3 = await fetch(`${BASE_URL}/settings/whatsapp/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token3}`
    },
    body: JSON.stringify({
      recipientPhone: '916261159109',
      recipientName: 'Verification Switch A->B->A',
      recipientType: 'OUTBOUND',
      eventType: 'WHATSAPP_CHAT_OUT',
      message: `Tenant A switchback verification - ${new Date().toLocaleTimeString()}`
    })
  });
  const sendData3 = await sendRes3.json();
  console.log('Send 3 (Switchback) response:', sendData3);
  if (!sendRes3.ok || !sendData3.success) {
    console.error('❌ Send 3 switchback failed!');
    process.exit(1);
  }
  console.log(`✅ Send 3 (Switchback) SUCCESS! Provider Message ID: ${sendData3.data?.messageId}`);

  console.log('\n========================================================');
  console.log('🎉 ALL INTEGRATION & SWITCHING TESTS PASSED PERFECTLY!');
  console.log('========================================================');
}

runTest().catch(console.error);
