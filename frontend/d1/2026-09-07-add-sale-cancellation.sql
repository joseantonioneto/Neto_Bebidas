-- Cancelamento de venda passa a ser "soft delete": antes a venda e os itens
-- eram apagados do banco, o que tornava impossivel saber depois quem vendeu o
-- que foi cancelado. Agora a venda fica marcada como cancelada, preservando
-- vendedor, itens e valor para relatorio.
ALTER TABLE sales ADD COLUMN cancelled_at TEXT;
ALTER TABLE sales ADD COLUMN cancelled_by TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_cancelled_at ON sales(cancelled_at);
