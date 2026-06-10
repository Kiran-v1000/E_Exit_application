import { Router } from 'express';
import { q, audit, notify } from './db.js';
import { allow } from './auth.js';

const r = Router();
const ok = (res, data, message) => res.json({ success: true, data, message });
const fail = (res, code, message) => res.status(code).json({ success: false, message });

const addWorkingDays = (start, days) => {
  const d = new Date(start);
  let added = 0;
  while (added < days) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) added++; }
  return d.toISOString().slice(0, 10);
};

/* ---------- Exit requests ---------- */
r.post('/exit-requests', async (req, res) => {
  const { exit_type = 'resignation', exit_reason_category = 'other', exit_reason_text, preferred_lwd, employee_id } = req.body;
  const empId = (req.user.role !== 'employee' && employee_id) ? employee_id : req.user.id;
  const emp = (await q('SELECT * FROM employees WHERE id=$1', [empId])).rows[0];
  if (!emp) return fail(res, 404, 'Employee not found');
  const open = await q(`SELECT 1 FROM exit_requests WHERE employee_id=$1 AND status NOT IN ('rejected','withdrawn','completed')`, [empId]);
  if (open.rowCount) return fail(res, 409, 'An exit request is already in progress for this employee');

  const num = 'EXT-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5);
  const policyLwd = addWorkingDays(new Date(), emp.notice_period_days);
  const row = (await q(
    `INSERT INTO exit_requests(request_number, employee_id, initiated_by, exit_type, exit_reason_category,
      exit_reason_text, preferred_lwd, policy_lwd) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [num, empId, req.user.id, exit_type, exit_reason_category, exit_reason_text, preferred_lwd || policyLwd, policyLwd])).rows[0];

  // approval chain: manager (if any) then HR
  let step = 1;
  if (emp.manager_id) {
    await q(`INSERT INTO exit_approvals(exit_request_id, approver_id, approver_role, step_order) VALUES($1,$2,'manager',$3)`, [row.id, emp.manager_id, step++]);
    notify(emp.manager_id, row.id, `${emp.full_name} submitted resignation ${num} — your approval is needed`);
  } else {
    await q(`UPDATE exit_requests SET status='pending_hr' WHERE id=$1`, [row.id]);
  }
  const hr = (await q(`SELECT id FROM employees WHERE role='hr' LIMIT 1`)).rows[0];
  if (hr) await q(`INSERT INTO exit_approvals(exit_request_id, approver_id, approver_role, step_order) VALUES($1,$2,'hr',$3)`, [row.id, hr.id, step]);
  audit(row.id, req.user.id, 'exit_request.created', { num });
  ok(res, row, 'Resignation submitted');
});

r.get('/exit-requests', async (req, res) => {
  const { role, id } = req.user;
  let where = '', params = [];
  if (role === 'employee') { where = 'WHERE er.employee_id=$1'; params = [id]; }
  else if (role === 'manager') { where = 'WHERE e.manager_id=$1 OR er.employee_id=$1'; params = [id]; }
  const rows = (await q(
    `SELECT er.*, e.full_name, e.employee_code, e.designation, d.name AS department
     FROM exit_requests er JOIN employees e ON e.id=er.employee_id
     LEFT JOIN departments d ON d.id=e.department_id ${where} ORDER BY er.created_at DESC`, params)).rows;
  ok(res, rows);
});

r.get('/exit-requests/:id', async (req, res) => {
  const er = (await q(
    `SELECT er.*, e.full_name, e.employee_code, e.designation, e.notice_period_days, e.monthly_salary, d.name AS department
     FROM exit_requests er JOIN employees e ON e.id=er.employee_id
     LEFT JOIN departments d ON d.id=e.department_id WHERE er.id=$1`, [req.params.id])).rows[0];
  if (!er) return fail(res, 404, 'Exit request not found');
  if (req.user.role === 'employee' && er.employee_id !== req.user.id) return fail(res, 403, 'Not your request');
  const [approvals, clearances, kt, fnf, survey] = await Promise.all([
    q(`SELECT a.*, e.full_name AS approver_name FROM exit_approvals a JOIN employees e ON e.id=a.approver_id WHERE a.exit_request_id=$1 ORDER BY step_order`, [er.id]),
    q(`SELECT c.*, d.name AS department FROM clearance_requests c JOIN departments d ON d.id=c.department_id WHERE c.exit_request_id=$1`, [er.id]),
    q(`SELECT * FROM kt_tasks WHERE exit_request_id=$1 ORDER BY due_date`, [er.id]),
    q(`SELECT * FROM fnf_settlements WHERE exit_request_id=$1`, [er.id]),
    q(`SELECT submitted_at FROM exit_surveys WHERE exit_request_id=$1`, [er.id]),
  ]);
  ok(res, { ...er, approvals: approvals.rows, clearances: clearances.rows, kt_tasks: kt.rows, fnf: fnf.rows[0] || null, survey_done: !!survey.rowCount });
});

const actOnApproval = async (req, res, decision) => {
  const er = (await q('SELECT * FROM exit_requests WHERE id=$1', [req.params.id])).rows[0];
  if (!er) return fail(res, 404, 'Exit request not found');
  const step = (await q(
    `SELECT * FROM exit_approvals WHERE exit_request_id=$1 AND status='pending' ORDER BY step_order LIMIT 1`, [er.id])).rows[0];
  if (!step) return fail(res, 409, 'No pending approval step');
  if (step.approver_id !== req.user.id && req.user.role !== 'super_admin') return fail(res, 403, 'You are not the current approver');
  if (decision === 'rejected' && !req.body.remarks) return fail(res, 400, 'A rejection reason is required');

  await q(`UPDATE exit_approvals SET status=$1, remarks=$2, acted_at=now() WHERE id=$3`, [decision, req.body.remarks || null, step.id]);

  if (decision === 'rejected') {
    await q(`UPDATE exit_requests SET status='rejected', updated_at=now() WHERE id=$1`, [er.id]);
    notify(er.employee_id, er.id, `Your resignation ${er.request_number} was rejected: ${req.body.remarks}`);
  } else {
    const next = (await q(`SELECT * FROM exit_approvals WHERE exit_request_id=$1 AND status='pending' ORDER BY step_order LIMIT 1`, [er.id])).rows[0];
    if (next) {
      await q(`UPDATE exit_requests SET status='pending_hr', updated_at=now() WHERE id=$1`, [er.id]);
      notify(next.approver_id, er.id, `Resignation ${er.request_number} awaits your approval`);
    } else {
      // fully approved → set LWD, move to KT, spawn clearances
      const lwd = req.body.approved_lwd || er.policy_lwd;
      await q(`UPDATE exit_requests SET status='approved', current_stage='kt', approved_lwd=$2, updated_at=now() WHERE id=$1`, [er.id, lwd]);
      const depts = (await q(`SELECT id, hod_employee_id FROM departments WHERE is_clearance_dept=TRUE`)).rows;
      for (const d of depts) {
        await q(`INSERT INTO clearance_requests(exit_request_id, department_id) VALUES($1,$2)`, [er.id, d.id]);
        if (d.hod_employee_id) notify(d.hod_employee_id, er.id, `Clearance assigned for exit ${er.request_number}`);
      }
      notify(er.employee_id, er.id, `Your resignation ${er.request_number} is approved. Last working day: ${lwd}`);
    }
  }
  audit(er.id, req.user.id, `approval.${decision}`, { step: step.step_order });
  ok(res, null, decision === 'approved' ? 'Approved' : 'Rejected');
};
r.patch('/exit-requests/:id/approve', allow('manager', 'hr'), (req, res) => actOnApproval(req, res, 'approved'));
r.patch('/exit-requests/:id/reject', allow('manager', 'hr'), (req, res) => actOnApproval(req, res, 'rejected'));

r.patch('/exit-requests/:id/withdraw', async (req, res) => {
  const er = (await q('SELECT * FROM exit_requests WHERE id=$1 AND employee_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!er) return fail(res, 404, 'Exit request not found');
  if (!['pending_manager', 'pending_hr'].includes(er.status)) return fail(res, 409, 'Can only withdraw while approval is pending');
  await q(`UPDATE exit_requests SET status='withdrawn', updated_at=now() WHERE id=$1`, [er.id]);
  audit(er.id, req.user.id, 'exit_request.withdrawn');
  ok(res, null, 'Resignation withdrawn');
});

/* ---------- KT tasks ---------- */
r.post('/exit-requests/:id/kt-tasks', allow('manager', 'hr'), async (req, res) => {
  const { title, description, due_date } = req.body;
  if (!title) return fail(res, 400, 'Title is required');
  const row = (await q(
    `INSERT INTO kt_tasks(exit_request_id, assigned_by, title, description, due_date) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.id, req.user.id, title, description, due_date])).rows[0];
  const er = (await q('SELECT employee_id, request_number FROM exit_requests WHERE id=$1', [req.params.id])).rows[0];
  if (er) notify(er.employee_id, req.params.id, `New KT task assigned: ${title}`);
  ok(res, row, 'KT task assigned');
});

r.patch('/kt-tasks/:taskId/submit', async (req, res) => {
  await q(`UPDATE kt_tasks SET status='submitted' WHERE id=$1`, [req.params.taskId]);
  ok(res, null, 'Task submitted for manager confirmation');
});

r.patch('/kt-tasks/:taskId/confirm', allow('manager', 'hr'), async (req, res) => {
  await q(`UPDATE kt_tasks SET status='approved', manager_confirmed_at=now() WHERE id=$1`, [req.params.taskId]);
  const t = (await q('SELECT exit_request_id FROM kt_tasks WHERE id=$1', [req.params.taskId])).rows[0];
  const open = await q(`SELECT 1 FROM kt_tasks WHERE exit_request_id=$1 AND status<>'approved'`, [t.exit_request_id]);
  if (!open.rowCount) await q(`UPDATE exit_requests SET current_stage='clearance', updated_at=now() WHERE id=$1 AND current_stage='kt'`, [t.exit_request_id]);
  ok(res, null, 'KT task confirmed');
});

/* ---------- Clearances ---------- */
r.get('/clearances/pending', allow('hod', 'hr'), async (req, res) => {
  const rows = (await q(
    `SELECT c.*, d.name AS department, er.request_number, e.full_name
     FROM clearance_requests c
     JOIN departments d ON d.id=c.department_id
     JOIN exit_requests er ON er.id=c.exit_request_id
     JOIN employees e ON e.id=er.employee_id
     WHERE c.status='pending' AND (d.hod_employee_id=$1 OR $2 IN ('hr','super_admin'))
     ORDER BY er.approved_lwd`, [req.user.id, req.user.role])).rows;
  ok(res, rows);
});

const clearanceAct = async (req, res, status) => {
  if (status === 'rejected' && !req.body.remarks) return fail(res, 400, 'A reason is required');
  const c = (await q(
    `UPDATE clearance_requests SET status=$1::varchar, remarks=$2, cleared_at=CASE WHEN $1::varchar='cleared' THEN now() END
     WHERE id=$3 RETURNING *`, [status, req.body.remarks || null, req.params.clearanceId])).rows[0];
  if (!c) return fail(res, 404, 'Clearance not found');
  const open = await q(`SELECT 1 FROM clearance_requests WHERE exit_request_id=$1 AND status<>'cleared'`, [c.exit_request_id]);
  if (!open.rowCount) {
    await q(`UPDATE exit_requests SET current_stage='settlement', updated_at=now() WHERE id=$1`, [c.exit_request_id]);
    const fin = (await q(`SELECT id FROM employees WHERE role='finance' LIMIT 1`)).rows[0];
    if (fin) notify(fin.id, c.exit_request_id, 'All clearances done — F&F settlement can begin');
  }
  audit(c.exit_request_id, req.user.id, `clearance.${status}`);
  ok(res, c, status === 'cleared' ? 'Clearance given' : 'Clearance rejected');
};
r.patch('/clearances/:clearanceId/clear', allow('hod', 'hr'), (req, res) => clearanceAct(req, res, 'cleared'));
r.patch('/clearances/:clearanceId/reject', allow('hod', 'hr'), (req, res) => clearanceAct(req, res, 'rejected'));

/* ---------- Survey ---------- */
r.post('/exit-requests/:id/survey', async (req, res) => {
  const er = (await q('SELECT * FROM exit_requests WHERE id=$1 AND employee_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!er) return fail(res, 404, 'Exit request not found');
  const { is_anonymous = true, work_culture_rating, manager_rating, compensation_rating, growth_rating, wlb_rating, would_return, open_feedback } = req.body;
  try {
    await q(`INSERT INTO exit_surveys(exit_request_id, is_anonymous, work_culture_rating, manager_rating,
      compensation_rating, growth_rating, wlb_rating, would_return, open_feedback)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [er.id, is_anonymous, work_culture_rating, manager_rating, compensation_rating, growth_rating, wlb_rating, would_return, open_feedback]);
  } catch { return fail(res, 409, 'Survey already submitted'); }
  ok(res, null, 'Thanks — your survey is recorded');
});

/* ---------- F&F ---------- */
r.post('/exit-requests/:id/fnf', allow('finance'), async (req, res) => {
  const er = (await q('SELECT * FROM exit_requests WHERE id=$1', [req.params.id])).rows[0];
  if (!er) return fail(res, 404, 'Exit request not found');
  if (er.current_stage !== 'settlement') return fail(res, 409, 'F&F opens after all clearances are done');
  const { pending_salary = 0, leave_encashment = 0, gratuity_amount = 0, notice_shortfall_deduction = 0, other_deductions = 0 } = req.body;
  const row = (await q(
    `INSERT INTO fnf_settlements(exit_request_id, calculated_by, pending_salary, leave_encashment, gratuity_amount,
      notice_shortfall_deduction, other_deductions, status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'pending_approval')
     ON CONFLICT (exit_request_id) DO UPDATE SET pending_salary=$3, leave_encashment=$4, gratuity_amount=$5,
      notice_shortfall_deduction=$6, other_deductions=$7, status='pending_approval', calculated_at=now()
     RETURNING *`,
    [er.id, req.user.id, pending_salary, leave_encashment, gratuity_amount, notice_shortfall_deduction, other_deductions])).rows[0];
  const hr = (await q(`SELECT id FROM employees WHERE role='hr' LIMIT 1`)).rows[0];
  if (hr) notify(hr.id, er.id, `F&F for ${er.request_number} awaits HR approval (net ₹${row.net_payable})`);
  audit(er.id, req.user.id, 'fnf.calculated', { net: row.net_payable });
  ok(res, row, 'F&F submitted for HR approval');
});

r.patch('/fnf/:fnfId/approve', allow('hr'), async (req, res) => {
  const f = (await q(`UPDATE fnf_settlements SET status='approved', approved_by=$1, payment_date=$2 WHERE id=$3 RETURNING *`,
    [req.user.id, req.body.payment_date || new Date(), req.params.fnfId])).rows[0];
  if (!f) return fail(res, 404, 'F&F not found');
  ok(res, f, 'F&F approved');
});

r.patch('/fnf/:fnfId/mark-paid', allow('finance'), async (req, res) => {
  const f = (await q(`UPDATE fnf_settlements SET status='paid' WHERE id=$1 AND status='approved' RETURNING *`, [req.params.fnfId])).rows[0];
  if (!f) return fail(res, 409, 'F&F must be approved by HR first');
  await q(`UPDATE exit_requests SET status='completed', current_stage='closed', updated_at=now() WHERE id=$1`, [f.exit_request_id]);
  const er = (await q('SELECT employee_id FROM exit_requests WHERE id=$1', [f.exit_request_id])).rows[0];
  await q(`UPDATE employees SET is_active=FALSE WHERE id=$1`, [er.employee_id]);
  notify(er.employee_id, f.exit_request_id, 'Your final settlement has been paid. Exit complete — best wishes!');
  audit(f.exit_request_id, req.user.id, 'fnf.paid');
  ok(res, f, 'Payment recorded; exit closed');
});

/* ---------- Notifications & analytics ---------- */
r.get('/notifications', async (req, res) =>
  ok(res, (await q('SELECT * FROM notifications WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 30', [req.user.id])).rows));
r.patch('/notifications/:id/read', async (req, res) => {
  await q('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND recipient_id=$2', [req.params.id, req.user.id]);
  ok(res, null);
});

r.get('/analytics/summary', allow('hr'), async (req, res) => {
  const [byStatus, byReason, ratings] = await Promise.all([
    q(`SELECT status, COUNT(*)::int AS count FROM exit_requests GROUP BY status`),
    q(`SELECT exit_reason_category AS reason, COUNT(*)::int AS count FROM exit_requests GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT ROUND(AVG(work_culture_rating),1) AS culture, ROUND(AVG(manager_rating),1) AS manager,
        ROUND(AVG(compensation_rating),1) AS compensation, ROUND(AVG(growth_rating),1) AS growth,
        ROUND(AVG(wlb_rating),1) AS wlb FROM exit_surveys`),
  ]);
  ok(res, { by_status: byStatus.rows, by_reason: byReason.rows, avg_ratings: ratings.rows[0] });
});

r.get('/admin/audit-logs', allow('hr'), async (req, res) =>
  ok(res, (await q(`SELECT a.*, e.full_name AS actor FROM audit_logs a LEFT JOIN employees e ON e.id=a.actor_id
    ORDER BY a.created_at DESC LIMIT 100`)).rows));

r.get('/employees', allow('manager', 'hr'), async (req, res) =>
  ok(res, (await q(`SELECT id, employee_code, full_name, email, role, designation FROM employees WHERE is_active=TRUE ORDER BY full_name`)).rows));

export default r;
