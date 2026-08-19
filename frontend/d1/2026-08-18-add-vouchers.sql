-- Vouchers de pré-venda (combo antecipado com QR Code e baixa na retirada).
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  product TEXT DEFAULT 'Combo',
  quantity INTEGER DEFAULT 1,
  unit_price REAL,
  total_value REAL,
  payment_method TEXT DEFAULT 'dinheiro',
  status TEXT DEFAULT 'pago',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  redeemed_by TEXT,
  redeemed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS ix_vouchers_status ON vouchers(status);
