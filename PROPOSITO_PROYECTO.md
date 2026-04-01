# Propósito del Proyecto (be-bulk)

## Visión General
El proyecto **be-bulk** es un sistema automatizado de ingesta, procesamiento y vectorización de datos legales y jurisprudenciales (Scraper & Indexer Engine). Su propósito principal es alimentar de forma continua y automatizada un motor de búsqueda semántica e Inteligencia Artificial con información gubernamental de Chile.

## Objetivos Core
1. **Extracción Automatizada (Web Scraping):** Extraer información crítica de plataformas públicas complejas y protegidas, como resoluciones de LeyChile (BCN) y sentencias del Poder Judicial (PJUD), evadiendo bloqueos temporales e imitando un comportamiento orgánico.
2. **Procesamiento y Estandarización Textual:** Limpiar el ruido del HTML extraído, decodificar caracteres y consolidar todas las fuentes dispares en un formato de texto plano estructurado.
3. **División Semántica (Chunking):** Separar documentos extensos (leyes y sentencias) en fragmentos más pequeños que retienen significado contextual, optimizados para modelos de Lenguaje.
4. **Vectorización de Datos:** Convertir los fragmentos de texto en representaciones numéricas (Embeddings) a través de modelos de IA, para ser almacenados en una base de datos vectorial (**Qdrant**), permitiendo la recuperación por similitud semántica.
5. **Almacenamiento Confiable (Hard-Storage):** Guardar copias exactas, completas (raw) y metadatos curados de cada documento procesado en una base de datos relacional (**PostgreSQL**) para trazabilidad total de la fuente original.

## Casos de Uso del Dato
- Alimentar portales de búsqueda inteligente para abogados y ciudadanos (encontrar sentencias previas similares usando lenguaje natural).
- Suministrar conocimiento estacional (RAG - *Retrieval-Augmented Generation*) a agentes conversacionales o LLMs que resuelvan dudas legales con citas directas y exactas a los repositorios de leyes y dictámenes del estado.
