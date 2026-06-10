import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api.js';

const STAGES = ['approval', 'kt', 'clearance', 'settlement', 'closed'];
const statusBadge = {
  pending_manager: 'b-amber', pending_hr: 'b-amber', approved: 'b-green', completed: 'b-purple',
  rejected: 'b-red', withdrawn: 'b-gray', draft: 'b-gray',
  pending: 'b-amber', cleared: 'b-green', on_hold: 'b-gray', submitted: 'b-blue',
  in_progress: 'b-blue', pending_approval: 'b-amber', paid: 'b-purple', disputed: 'b-red'
};
const Badge = ({ s }) => <span className={'badge ' + (statusBadge[s] || 'b-gray')}>{(s || '').replace(/_/g, ' ')}</span>;
const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* ---------- shared bits ---------- */
function useToast() {
  const [msg, setMsg] = useState(null);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(null), 3200); };
  return [msg && <div className="toast" key={msg}>{msg}</div>, toast];
}

const Sun = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
const Moon = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>;
const Bell = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>;

/* ---------- Login ---------- */
function Login({ onLogin }) {
  const [email, setEmail] = useState('employee@exitflow.dev');
  const [password, setPassword] = useState('Pass@123');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const { data } = await api('/auth/login', { method: 'POST', body: { email, password } });
      localStorage.token = data.token;
      localStorage.user = JSON.stringify(data.user);
      onLogin(data.user);
    } catch (ex) { setErr(ex.message); }
    setBusy(false);
  };
  return (
    <div className="login-wrap">
      <form className="login-card rise" onSubmit={submit}>
        <div className="brand" style={{ fontSize: 26 }}>ExitFlow</div>
        <p className="muted" style={{ marginTop: 4 }}>Employee exit management — sign in to continue</p>
        <label>Work email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy} style={{ width: '100%', justifyContent: 'center', marginTop: 20 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted" style={{ marginTop: 16, fontSize: 11.5 }}>
          Demo logins (Pass@123): employee@ · manager@ · hr@ · finance@ · hod.it@ …exitflow.dev
        </p>
      </form>
    </div>
  );
}

/* ---------- New resignation form ---------- */
function NewExit({ onDone, toast }) {
  const [form, setForm] = useState({ exit_reason_category: 'better_opportunity', preferred_lwd: '', exit_reason_text: '' });
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault();
    try {
      await api('/exit-requests', { method: 'POST', body: form });
      toast('Resignation submitted — your manager has been notified');
      onDone();
    } catch (ex) { toast(ex.message); }
  };
  return (
    <form className="card rise" onSubmit={submit}>
      <h3>Submit resignation</h3>
      <div className="grid2">
        <div>
          <label>Reason</label>
          <select value={form.exit_reason_category} onChange={set('exit_reason_category')}>
            {['better_opportunity', 'personal', 'relocation', 'compensation', 'growth', 'health', 'other']
              .map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label>Preferred last working day</label>
          <input type="date" value={form.preferred_lwd} onChange={set('preferred_lwd')} />
        </div>
      </div>
      <label>Note (optional)</label>
      <textarea rows="3" value={form.exit_reason_text} onChange={set('exit_reason_text')} placeholder="Anything you'd like HR or your manager to know" />
      <div style={{ marginTop: 16 }}><button className="btn">Submit resignation</button></div>
    </form>
  );
}

/* ---------- Exit detail ---------- */
function ExitDetail({ id, user, back, toast }) {
  const [er, setEr] = useState(null);
  const [ktForm, setKt] = useState({ title: '', due_date: '' });
  const [fnf, setFnf] = useState({ pending_salary: '', leave_encashment: '', gratuity_amount: '', notice_shortfall_deduction: '', other_deductions: '' });
  const [survey, setSurvey] = useState({ work_culture_rating: 4, manager_rating: 4, compensation_rating: 3, growth_rating: 3, wlb_rating: 4, open_feedback: '' });
  const load = useCallback(() => api('/exit-requests/' + id).then(r => setEr(r.data)).catch(e => toast(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  if (!er) return <p className="muted">Loading…</p>;

  const act = (path, body, method = 'PATCH') => () =>
    api(path, { method, body }).then(r => { toast(r.message || 'Done'); load(); }).catch(e => toast(e.message));

  const myApproval = er.approvals.find(a => a.status === 'pending' && a.approver_id === user.id);
  const isOwner = er.employee_id === user.id;
  const stageIdx = STAGES.indexOf(er.current_stage === 'closed' ? 'closed' : er.current_stage);

  return (
    <div>
      <button className="btn ghost sm" onClick={back}>← Back</button>
      <div className="card rise" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>{er.request_number}</h3>
          <Badge s={er.status} />
          <span className="muted">{er.full_name} · {er.designation} · {er.department}</span>
        </div>
        <div className="stage-track">
          {STAGES.map((s, i) => <div key={s} className={'stage ' + (i < stageIdx ? 'done' : i === stageIdx ? 'now' : '')}>{s === 'kt' ? 'KT' : s}</div>)}
        </div>
        <div className="grid3">
          <div><label>Resigned on</label>{fmt(er.resignation_date)}</div>
          <div><label>Policy LWD</label>{fmt(er.policy_lwd)}</div>
          <div><label>Approved LWD</label>{fmt(er.approved_lwd)}</div>
        </div>
        {er.exit_reason_text && <p className="muted" style={{ marginTop: 10 }}>"{er.exit_reason_text}"</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {myApproval && <>
            <button className="btn" onClick={act(`/exit-requests/${er.id}/approve`, {})}>Approve</button>
            <button className="btn danger" onClick={() => {
              const remarks = prompt('Reason for rejection:');
              if (remarks) act(`/exit-requests/${er.id}/reject`, { remarks })();
            }}>Reject</button>
          </>}
          {isOwner && ['pending_manager', 'pending_hr'].includes(er.status) &&
            <button className="btn ghost" onClick={act(`/exit-requests/${er.id}/withdraw`, {})}>Withdraw resignation</button>}
        </div>
      </div>

      <div className="card rise">
        <h3>Approval chain</h3>
        {er.approvals.map(a => (
          <div className="list-row" key={a.id} style={{ cursor: 'default' }}>
            <span className="badge b-blue">{a.approver_role}</span>
            <span className="title">{a.approver_name}</span>
            <span style={{ flex: 1 }} />
            {a.remarks && <span className="muted">"{a.remarks}"</span>}
            <Badge s={a.status} />
          </div>))}
      </div>

      {er.status === 'approved' || er.status === 'completed' ? <>
        <div className="card rise">
          <h3>Knowledge transfer</h3>
          {er.kt_tasks.length === 0 && <p className="muted">No KT tasks yet.</p>}
          {er.kt_tasks.map(t => (
            <div className="list-row" key={t.id} style={{ cursor: 'default' }}>
              <span className="title">{t.title}</span>
              <span className="muted">due {fmt(t.due_date)}</span>
              <span style={{ flex: 1 }} />
              {isOwner && ['pending', 'in_progress'].includes(t.status) &&
                <button className="btn sm" onClick={act(`/kt-tasks/${t.id}/submit`, {})}>Mark done</button>}
              {['manager', 'hr', 'super_admin'].includes(user.role) && t.status === 'submitted' &&
                <button className="btn sm" onClick={act(`/kt-tasks/${t.id}/confirm`, {})}>Confirm</button>}
              <Badge s={t.status} />
            </div>))}
          {['manager', 'hr', 'super_admin'].includes(user.role) &&
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <input style={{ flex: 2, minWidth: 160 }} placeholder="New KT task title" value={ktForm.title} onChange={e => setKt({ ...ktForm, title: e.target.value })} />
              <input style={{ flex: 1, minWidth: 130 }} type="date" value={ktForm.due_date} onChange={e => setKt({ ...ktForm, due_date: e.target.value })} />
              <button className="btn sm" disabled={!ktForm.title}
                onClick={() => act(`/exit-requests/${er.id}/kt-tasks`, ktForm, 'POST')().then(() => setKt({ title: '', due_date: '' }))}>Assign</button>
            </div>}
        </div>

        <div className="card rise">
          <h3>Department clearances</h3>
          {er.clearances.map(c => (
            <div className="list-row" key={c.id} style={{ cursor: 'default' }}>
              <span className="title">{c.department}</span>
              {c.remarks && <span className="muted">"{c.remarks}"</span>}
              <span style={{ flex: 1 }} />
              {['hod', 'hr', 'super_admin'].includes(user.role) && c.status === 'pending' && <>
                <button className="btn sm" onClick={act(`/clearances/${c.id}/clear`, {})}>Clear</button>
                <button className="btn sm danger" onClick={() => {
                  const remarks = prompt('Reason:'); if (remarks) act(`/clearances/${c.id}/reject`, { remarks })();
                }}>Flag</button>
              </>}
              <Badge s={c.status} />
            </div>))}
        </div>

        {isOwner && !er.survey_done &&
          <div className="card rise">
            <h3>Exit survey <span className="muted">(anonymous — visible to HR leadership only)</span></h3>
            <div className="grid3">
              {[['work_culture_rating', 'Work culture'], ['manager_rating', 'Manager'], ['compensation_rating', 'Compensation'],
                ['growth_rating', 'Growth'], ['wlb_rating', 'Work-life balance']].map(([k, lbl]) =>
                <div key={k}><label>{lbl} (1–5)</label>
                  <input type="number" min="1" max="5" value={survey[k]} onChange={e => setSurvey({ ...survey, [k]: +e.target.value })} /></div>)}
            </div>
            <label>Open feedback</label>
            <textarea rows="2" value={survey.open_feedback} onChange={e => setSurvey({ ...survey, open_feedback: e.target.value })} />
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={act(`/exit-requests/${er.id}/survey`, survey, 'POST')}>Submit survey</button>
            </div>
          </div>}

        <div className="card rise">
          <h3>Full &amp; final settlement</h3>
          {er.fnf ? <>
            <div className="grid3">
              <div className="stat"><div className="num">₹{(+er.fnf.net_payable).toLocaleString('en-IN')}</div><div className="lbl">Net payable</div></div>
              <div className="stat"><div className="num">₹{(+er.fnf.pending_salary + +er.fnf.leave_encashment + +er.fnf.gratuity_amount).toLocaleString('en-IN')}</div><div className="lbl">Earnings</div></div>
              <div className="stat"><div className="num">₹{(+er.fnf.notice_shortfall_deduction + +er.fnf.other_deductions).toLocaleString('en-IN')}</div><div className="lbl">Deductions</div></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge s={er.fnf.status} />
              {['hr', 'super_admin'].includes(user.role) && er.fnf.status === 'pending_approval' &&
                <button className="btn sm" onClick={act(`/fnf/${er.fnf.id}/approve`, {})}>Approve F&amp;F</button>}
              {['finance', 'super_admin'].includes(user.role) && er.fnf.status === 'approved' &&
                <button className="btn sm" onClick={act(`/fnf/${er.fnf.id}/mark-paid`, {})}>Mark paid</button>}
            </div>
          </> : ['finance', 'super_admin'].includes(user.role) && er.current_stage === 'settlement' ? <>
            <div className="grid3">
              {[['pending_salary', 'Pending salary'], ['leave_encashment', 'Leave encashment'], ['gratuity_amount', 'Gratuity'],
                ['notice_shortfall_deduction', 'Notice shortfall (−)'], ['other_deductions', 'Other deductions (−)']].map(([k, lbl]) =>
                <div key={k}><label>{lbl}</label>
                  <input type="number" value={fnf[k]} onChange={e => setFnf({ ...fnf, [k]: e.target.value })} placeholder="0" /></div>)}
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn" onClick={act(`/exit-requests/${er.id}/fnf`,
                Object.fromEntries(Object.entries(fnf).map(([k, v]) => [k, +v || 0])), 'POST')}>Calculate &amp; submit F&amp;F</button>
            </div>
          </> : <p className="muted">F&amp;F opens once all clearances are done.</p>}
        </div>
      </> : null}
    </div>
  );
}

/* ---------- HR analytics ---------- */
function Analytics({ toast }) {
  const [d, setD] = useState(null);
  useEffect(() => { api('/analytics/summary').then(r => setD(r.data)).catch(e => toast(e.message)); }, []);
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <div>
      <div className="grid3 rise">
        {d.by_status.map(s => <div className="stat" key={s.status}><div className="num">{s.count}</div><div className="lbl">{s.status.replace(/_/g, ' ')}</div></div>)}
      </div>
      <div className="card rise" style={{ marginTop: 16 }}>
        <h3>Exit reasons</h3>
        {d.by_reason.map(x => <div className="list-row" key={x.reason} style={{ cursor: 'default' }}>
          <span className="title">{x.reason.replace(/_/g, ' ')}</span><span style={{ flex: 1 }} /><span className="badge b-purple">{x.count}</span></div>)}
      </div>
      <div className="card rise">
        <h3>Average survey ratings (out of 5)</h3>
        <div className="grid3">
          {Object.entries(d.avg_ratings || {}).map(([k, v]) =>
            <div className="stat" key={k}><div className="num">{v ?? '—'}</div><div className="lbl">{k}</div></div>)}
        </div>
      </div>
    </div>
  );
}

/* ---------- Main app ---------- */
export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.user); } catch { return null; } });
  const [dark, setDark] = useState(() => localStorage.theme === 'dark' || (!localStorage.theme && matchMedia('(prefers-color-scheme: dark)').matches));
  const [tab, setTab] = useState('exits');
  const [exits, setExits] = useState([]);
  const [detail, setDetail] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [toastEl, toast] = useToast();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.theme = dark ? 'dark' : 'light';
  }, [dark]);

  const loadExits = useCallback(() => user && api('/exit-requests').then(r => setExits(r.data)).catch(e => toast(e.message)), [user]);
  useEffect(() => { loadExits(); }, [loadExits, detail, showNew]);
  useEffect(() => {
    if (!user) return;
    const f = () => api('/notifications').then(r => setNotifs(r.data)).catch(() => {});
    f(); const t = setInterval(f, 20000); return () => clearInterval(t);
  }, [user]);

  if (!user) return <>{toastEl}<Login onLogin={setUser} /></>;
  const unread = notifs.filter(n => !n.is_read).length;
  const myOpen = exits.some(e => e.employee_id === user.id && !['rejected', 'withdrawn', 'completed'].includes(e.status));

  return (
    <div className="shell">
      {toastEl}
      <div className="topbar rise">
        <span className="brand">ExitFlow</span>
        <span className="chip">{user.name} · {user.role.replace('_', ' ')}</span>
        <span className="spacer" />
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setShowNotif(!showNotif)} aria-label="Notifications">
            <Bell />{unread > 0 && <span className="notif-dot" />}
          </button>
          {showNotif && <div className="pop">
            {notifs.length === 0 && <div className="n muted">No notifications yet</div>}
            {notifs.map(n => <div key={n.id} className={'n' + (n.is_read ? '' : ' unread')}
              onClick={() => { api('/notifications/' + n.id + '/read', { method: 'PATCH' }).then(() => setNotifs(notifs.map(x => x.id === n.id ? { ...x, is_read: true } : x))); }}>
              {n.message}<div className="muted" style={{ fontSize: 10.5 }}>{fmt(n.created_at)}</div>
            </div>)}
          </div>}
        </div>
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun /> : <Moon />}</button>
        <button className="btn ghost sm" onClick={() => { localStorage.clear(); setUser(null); }}>Sign out</button>
      </div>

      {detail ? <ExitDetail id={detail} user={user} back={() => setDetail(null)} toast={toast} /> : <>
        <div className="tabs rise">
          <button className={'tab' + (tab === 'exits' ? ' active' : '')} onClick={() => setTab('exits')}>Exit requests</button>
          {['hr', 'super_admin'].includes(user.role) &&
            <button className={'tab' + (tab === 'analytics' ? ' active' : '')} onClick={() => setTab('analytics')}>Analytics</button>}
        </div>

        {tab === 'analytics' ? <Analytics toast={toast} /> : <>
          {!myOpen && !showNew &&
            <div className="card rise" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}><h3 style={{ margin: 0 }}>Planning to move on?</h3>
                <span className="muted">Submit a resignation and track every step — approvals, clearances, and your final settlement.</span></div>
              <button className="btn" onClick={() => setShowNew(true)}>New resignation</button>
            </div>}
          {showNew && <NewExit toast={toast} onDone={() => setShowNew(false)} />}
          <div className="card rise">
            <h3>{user.role === 'employee' ? 'My exit requests' : 'Exit requests'}</h3>
            {exits.length === 0 && <p className="muted">Nothing here yet.</p>}
            {exits.map(e => (
              <div className="list-row" key={e.id} onClick={() => setDetail(e.id)}>
                <span className="badge b-blue">{e.request_number}</span>
                <span className="title">{e.full_name}</span>
                <span className="muted">{e.department} · LWD {fmt(e.approved_lwd || e.policy_lwd)}</span>
                <span style={{ flex: 1 }} />
                <span className="badge b-gray">{e.current_stage}</span>
                <Badge s={e.status} />
              </div>))}
          </div>
        </>}
      </>}
    </div>
  );
}
