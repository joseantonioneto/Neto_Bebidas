-- Registro de atividades dos usuários (auditoria para o administrador).
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY,
  username TEXT,
  role TEXT,
  action TEXT,
  detail TEXT,
  method TEXT,
  path TEXT,
  status INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_activity_logs_username ON activity_logs(username);
