// Creates schema + seed data. Run: npm run db:init  (database 'exitflow' must exist)
import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const run = async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await pool.query(readFileSync(path.join(dir, '../db/schema.sql'), 'utf8'));

  const hash = await bcrypt.hash('Pass@123', 10);
  const depts = {};
  for (const [name, clr] of [['Engineering', false], ['IT', true], ['Admin', true], ['Finance', true], ['HR', true]]) {
    const r = await pool.query(
      'INSERT INTO departments(name, is_clearance_dept) VALUES($1,$2) RETURNING id', [name, clr]);
    depts[name] = r.rows[0].id;
  }

  const emp = async (code, name, email, role, dept, mgr = null, salary = 80000) => {
    const r = await pool.query(
      `INSERT INTO employees(employee_code, full_name, email, password_hash, role, department_id, manager_id,
        designation, date_of_joining, monthly_salary)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2022-01-10',$9) RETURNING id`,
      [code, name, email, hash, role, depts[dept], mgr, role.toUpperCase(), salary]);
    return r.rows[0].id;
  };

  const admin = await emp('EMP001', 'Asha Verma', 'admin@exitflow.dev', 'super_admin', 'HR');
  const hr = await emp('EMP002', 'Rahul Nair', 'hr@exitflow.dev', 'hr', 'HR');
  const mgr = await emp('EMP003', 'Divya Singh', 'manager@exitflow.dev', 'manager', 'Engineering');
  const fin = await emp('EMP004', 'Arjun Rao', 'finance@exitflow.dev', 'finance', 'Finance');
  const hodIT = await emp('EMP005', 'Meera Iyer', 'hod.it@exitflow.dev', 'hod', 'IT');
  const hodAdmin = await emp('EMP006', 'Vikram Das', 'hod.admin@exitflow.dev', 'hod', 'Admin');
  const hodFin = await emp('EMP007', 'Sneha Patil', 'hod.finance@exitflow.dev', 'hod', 'Finance');
  await emp('EMP008', 'Kiran Kumar', 'employee@exitflow.dev', 'employee', 'Engineering', mgr, 95000);
  await emp('EMP009', 'Priya Sharma', 'priya@exitflow.dev', 'employee', 'Engineering', mgr, 88000);

  await pool.query('UPDATE departments SET hod_employee_id=$1 WHERE name=$2', [hodIT, 'IT']);
  await pool.query('UPDATE departments SET hod_employee_id=$1 WHERE name=$2', [hodAdmin, 'Admin']);
  await pool.query('UPDATE departments SET hod_employee_id=$1 WHERE name=$2', [hodFin, 'Finance']);
  await pool.query('UPDATE departments SET hod_employee_id=$1 WHERE name=$2', [hr, 'HR']);

  console.log('Schema + seed done. Logins (Pass@123): admin@ / hr@ / manager@ / finance@ / hod.it@ / employee@ ...exitflow.dev');
  await pool.end();
};
run().catch(e => { console.error(e); process.exit(1); });
