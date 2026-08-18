-- Adiciona a coluna de foto do produto (data URL JPEG 200x200) ao D1 existente.
-- Seguro rodar uma vez; se a coluna ja existir, o D1 retorna erro e pode ser ignorado.
ALTER TABLE products ADD COLUMN photo TEXT;
