CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  is_clearance_dept BOOLEAN DEFAULT FALSE
);

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'employee'
    CHECK (role IN ('employee','manager','hr','hod','finance','super_admin')),
  department_id UUID REFERENCES departments(id),
  manager_id UUID REFERENCES employees(id),
  designation VARCHAR(100),
  employment_type VARCHAR(20) DEFAULT 'confirmed'
    CHECK (employment_type IN ('trainee','probationer','confirmed','contract')),
  date_of_joining DATE,
  notice_period_days INTEGER DEFAULT 60,
  monthly_salary NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  rehire_eligible BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE departments ADD COLUMN hod_employee_id UUID REFERENCES employees(id);

CREATE TABLE exit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(20) UNIQUE NOT NULL,
  employee_id UUID NOT NULL REFERENCES employees(id),
  initiated_by UUID NOT NULL REFERENCES employees(id),
  exit_type VARCHAR(20) NOT NULL DEFAULT 'resignation'
    CHECK (exit_type IN ('resignation','retirement','termination','absconding','layoff')),
  exit_reason_category VARCHAR(30) NOT NULL DEFAULT 'other',
  exit_reason_text TEXT,
  resignation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  preferred_lwd DATE NOT NULL,
  policy_lwd DATE NOT NULL,
  approved_lwd DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_manager'
    CHECK (status IN ('draft','pending_manager','pending_hr','approved','rejected','withdrawn','completed')),
  current_stage VARCHAR(20) NOT NULL DEFAULT 'approval'
    CHECK (current_stage IN ('approval','kt','clearance','interview','settlement','documents','closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE exit_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_request_id UUID NOT NULL REFERENCES exit_requests(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES employees(id),
  approver_role VARCHAR(20) NOT NULL,
  step_order INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','skipped')),
  remarks TEXT,
  acted_at TIMESTAMPTZ
);

CREATE TABLE kt_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_request_id UUID NOT NULL REFERENCES exit_requests(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES employees(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','submitted','approved','rejected')),
  manager_confirmed_at TIMESTAMPTZ
);

CREATE TABLE clearance_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_request_id UUID NOT NULL REFERENCES exit_requests(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','cleared','rejected','on_hold')),
  remarks TEXT,
  cleared_at TIMESTAMPTZ
);

CREATE TABLE exit_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_request_id UUID NOT NULL UNIQUE REFERENCES exit_requests(id) ON DELETE CASCADE,
  is_anonymous BOOLEAN DEFAULT TRUE,
  work_culture_rating SMALLINT, manager_rating SMALLINT,
  compensation_rating SMALLINT, growth_rating SMALLINT, wlb_rating SMALLINT,
  would_return BOOLEAN, open_feedback TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE fnf_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_request_id UUID NOT NULL UNIQUE REFERENCES exit_requests(id) ON DELETE CASCADE,
  calculated_by UUID REFERENCES employees(id),
  pending_salary NUMERIC(12,2) DEFAULT 0,
  leave_encashment NUMERIC(12,2) DEFAULT 0,
  gratuity_amount NUMERIC(12,2) DEFAULT 0,
  notice_shortfall_deduction NUMERIC(12,2) DEFAULT 0,
  other_deductions NUMERIC(12,2) DEFAULT 0,
  net_payable NUMERIC(12,2) GENERATED ALWAYS AS
    (pending_salary + leave_encashment + gratuity_amount - notice_shortfall_deduction - other_deductions) STORED,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','paid','disputed')),
  approved_by UUID REFERENCES employees(id),
  payment_date DATE,
  calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES employees(id),
  exit_request_id UUID REFERENCES exit_requests(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  exit_request_id UUID,
  actor_id UUID,
  action VARCHAR(100) NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON exit_requests(employee_id);
CREATE INDEX ON exit_requests(status);
CREATE INDEX ON exit_approvals(exit_request_id, step_order);
CREATE INDEX ON clearance_requests(exit_request_id);
CREATE INDEX ON kt_tasks(exit_request_id);
CREATE INDEX ON notifications(recipient_id, is_read);
CREATE INDEX ON audit_logs(exit_request_id);
