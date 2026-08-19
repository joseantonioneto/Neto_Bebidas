CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  hashed_password TEXT,
  role TEXT DEFAULT 'vendedor',
  must_change_password INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT,
  category TEXT DEFAULT 'Geral',
  barcode TEXT UNIQUE,
  cost_price REAL,
  sell_price REAL,
  stock INTEGER,
  photo TEXT
);

CREATE TABLE IF NOT EXISTS category_costs (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'Geral',
  amount REAL NOT NULL,
  event_day TEXT DEFAULT 'Dia 1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT,
  phone TEXT,
  group_name TEXT,
  debt REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER,
  seller_username TEXT,
  total_value REAL,
  is_paid INTEGER DEFAULT 1,
  payment_method TEXT DEFAULT 'dinheiro',
  payment_status TEXT DEFAULT 'paid',
  payment_provider TEXT,
  payment_reference TEXT,
  event_day TEXT DEFAULT 'Dia 1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER,
  product_id INTEGER,
  quantity INTEGER,
  unit_sell_price REAL,
  unit_cost_price REAL,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

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

CREATE INDEX IF NOT EXISTS ix_users_username ON users(username);
CREATE INDEX IF NOT EXISTS ix_vouchers_code ON vouchers(code);
CREATE INDEX IF NOT EXISTS ix_vouchers_status ON vouchers(status);
CREATE INDEX IF NOT EXISTS ix_products_name ON products(name);
CREATE INDEX IF NOT EXISTS ix_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS ix_category_costs_category ON category_costs(category);
CREATE INDEX IF NOT EXISTS ix_category_costs_created_at ON category_costs(created_at);
CREATE INDEX IF NOT EXISTS ix_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS ix_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS ix_sale_items_sale_id ON sale_items(sale_id);
