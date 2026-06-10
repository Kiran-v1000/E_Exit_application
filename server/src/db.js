import 'dotenv/config';
import pg from 'pg';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});
export const q = (text, params) => pool.query(text, params);
export const audit = (exitId, actorId, action, detail = {}) =>
  q('INSERT INTO audit_logs(exit_request_id, actor_id, action, detail) VALUES($1,$2,$3,$4)',
    [exitId, actorId, action, detail]).catch(console.error);
export const notify = (recipientId, exitId, message) =>
  q('INSERT INTO notifications(recipient_id, exit_request_id, message) VALUES($1,$2,$3)',
    [recipientId, exitId, message]).catch(console.error);
