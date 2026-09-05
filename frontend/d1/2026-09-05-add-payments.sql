-- Registro das baixas de fiado. Antes disso a baixa so alterava o saldo do
-- cliente, sem deixar rastro do valor — impossivel auditar ou estornar.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  username TEXT,
  note TEXT,
  client_request_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_client_request_id
  ON payments(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
