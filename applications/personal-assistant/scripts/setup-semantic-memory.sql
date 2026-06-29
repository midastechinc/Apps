-- ============================================================
-- Claudia Semantic Memory Setup
-- Run this ONCE in the Supabase SQL Editor
-- ============================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add an embedding column (1536 dims = OpenAI text-embedding-3-small)
ALTER TABLE claudia_memory ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Semantic search function — returns closest memories by meaning
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_category text DEFAULT NULL
)
RETURNS TABLE (key text, value text, category text, similarity float)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT m.key, m.value, m.category,
         1 - (m.embedding <=> query_embedding) AS similarity
  FROM claudia_memory m
  WHERE m.embedding IS NOT NULL
    AND (filter_category IS NULL OR m.category = filter_category)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4. Allow the service role to call it
GRANT EXECUTE ON FUNCTION match_memories TO service_role;

-- 5. (Optional but faster) index for cosine similarity once you have many rows
-- CREATE INDEX IF NOT EXISTS claudia_memory_embedding_idx
--   ON claudia_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
