// End-to-end workflow smoke test against a running API. Run: node test/smoke.js
const B = 'http://localhost:5000/api/v1';
const call = async (path, token, method = 'GET', body) => {
  const r = await fetch(B + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!j.success) throw new Error(`${method} ${path} → ${j.message}`);
  return j.data;
};
const login = async email => (await call('/auth/login', null, 'POST', { email, password: 'Pass@123' })).token;

const run = async () => {
  const [emp, mgr, hr, fin, hodIT, hodAdmin, hodFin] = await Promise.all(
    ['priya', 'manager', 'hr', 'finance', 'hod.it', 'hod.admin', 'hod.finance'].map(u => login(u + '@exitflow.dev')));

  const er = await call('/exit-requests', emp, 'POST', { exit_reason_category: 'growth', exit_reason_text: 'smoke test' });
  console.log('1. submitted', er.request_number);
  await call(`/exit-requests/${er.id}/approve`, mgr, 'PATCH', { remarks: 'ok' });
  await call(`/exit-requests/${er.id}/approve`, hr, 'PATCH', {});
  console.log('2. manager + HR approved');

  await call(`/exit-requests/${er.id}/kt-tasks`, mgr, 'POST', { title: 'Handover docs', due_date: '2026-07-01' });
  let d = await call(`/exit-requests/${er.id}`, emp);
  await call(`/kt-tasks/${d.kt_tasks[0].id}/submit`, emp, 'PATCH');
  await call(`/kt-tasks/${d.kt_tasks[0].id}/confirm`, mgr, 'PATCH');
  console.log('3. KT done');

  d = await call(`/exit-requests/${er.id}`, hr);
  for (const c of d.clearances) {
    const tok = { IT: hodIT, Admin: hodAdmin, Finance: hodFin, HR: hr }[c.department] || hr;
    await call(`/clearances/${c.id}/clear`, tok, 'PATCH', {});
  }
  console.log('4. all clearances cleared');

  await call(`/exit-requests/${er.id}/survey`, emp, 'POST', { work_culture_rating: 4, manager_rating: 5, compensation_rating: 3, growth_rating: 3, wlb_rating: 4 });
  const f = await call(`/exit-requests/${er.id}/fnf`, fin, 'POST', { pending_salary: 44000, leave_encashment: 30000, notice_shortfall_deduction: 5000 });
  console.log('5. survey + F&F drafted, net =', f.net_payable);
  await call(`/fnf/${f.id}/approve`, hr, 'PATCH', {});
  await call(`/fnf/${f.id}/mark-paid`, fin, 'PATCH');
  d = await call(`/exit-requests/${er.id}`, hr);
  console.log('6. final status:', d.status, '/', d.current_stage);
  const a = await call('/analytics/summary', hr);
  console.log('7. analytics:', JSON.stringify(a.avg_ratings));
  console.log('ALL PASSED');
};
run().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
