CREATE TABLE IF NOT EXISTS category_costs (
  id INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT DEFAULT 'Geral',
  amount REAL NOT NULL,
  event_day TEXT DEFAULT 'Dia 1',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_category_costs_category ON category_costs(category);
CREATE INDEX IF NOT EXISTS ix_category_costs_created_at ON category_costs(created_at);
