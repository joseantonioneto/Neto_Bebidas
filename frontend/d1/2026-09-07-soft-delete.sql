-- Regra geral do sistema: nada mais e apagado do banco de verdade. Toda
-- exclusao passa a marcar deleted_at e some das listagens, mas o registro
-- fica preservado para auditoria/relatorio (mesmo padrao ja usado em sales
-- com cancelled_at).
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE category_costs ADD COLUMN deleted_at TEXT;
ALTER TABLE payments ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_category_costs_deleted_at ON category_costs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_payments_deleted_at ON payments(deleted_at);
