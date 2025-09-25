-- Crear la tabla documents para PostgreSQL
-- Ejecutar este script en tu base de datos PostgreSQL

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR PRIMARY KEY,
    collection VARCHAR NOT NULL,
    filename VARCHAR,
    file_path VARCHAR,
    content JSONB,
    metadata JSONB,
    file_size BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para optimizar las consultas
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
CREATE INDEX IF NOT EXISTS idx_documents_id ON documents(id);
CREATE INDEX IF NOT EXISTS idx_documents_id_collection ON documents(id, collection);
CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);

-- Índices para JSONB (opcional, para consultas más avanzadas)
CREATE INDEX IF NOT EXISTS idx_documents_content_gin ON documents USING GIN(content);
CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON documents USING GIN(metadata);

-- Mostrar estructura de la tabla
\d documents;
