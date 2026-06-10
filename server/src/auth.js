import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { q } from './db.js';

export const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const r = await q('SELECT * FROM employees WHERE email=$1 AND is_active=TRUE', [email]);
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.password_hash)))
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.full_name, deptId: user.department_id },
    process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ success: true, data: { token, user: {
    id: user.id, name: user.full_name, email: user.email, role: user.role,
    employee_code: user.employee_code, department_id: user.department_id } } });
});

export const authenticate = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ success: false, message: 'Sign in to continue' }); }
};

export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) || req.user.role === 'super_admin'
    ? next() : res.status(403).json({ success: false, message: 'Not allowed for your role' });
