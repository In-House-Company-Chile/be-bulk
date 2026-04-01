# be-bulk — Propuesta de Arquitectura Modernizada
> Stack: TypeScript · NestJS · LlamaIndex.TS · BullMQ · Prisma · Qdrant · PostgreSQL

---

## 1. Principios de Diseño

| Principio | Aplicación |
|---|---|
| **Inyección de Dependencias** | NestJS como orquestador principal; fuentes de datos son implementaciones intercambiables |
| **Puertos y Adaptadores** | `IDataSourceScraper` como contrato único para toda fuente nueva |
| **Resiliencia** | BullMQ garantiza que ningún job se pierda ante fallos parciales |
| **Trazabilidad** | PostgreSQL como fuente de verdad; `scraper_cursors` como estado persistente |
| **Escalabilidad** | Agregar una nueva fuente (Contraloría, Diario Oficial) no toca el core |

---

## 2. Stack Tecnológico

### Core del Sistema
| Capa | Tecnología | Justificación |
|---|---|---|
| Lenguaje | TypeScript 5+ | Interfaces críticas para obligar contratos entre scrapers |
| Framework | NestJS | DI nativa, módulos, schedulers y guards integrados |
| Procesamiento IA | **LlamaIndex.TS** | Abstracciones maduras para chunking, embeddings y RAG |
| Cola de Tareas | BullMQ + Redis | Jobs atómicos con reintentos automáticos y prioridad |
| ORM | Prisma | Tipado estricto, migraciones declarativas, mejor DX que TypeORM |
| BD Relacional | PostgreSQL | Hard-storage de documentos raw y estado de cursores |
| BD Vectorial | Qdrant | Almacenamiento y búsqueda por similitud semántica |
| Scraping Simple | Axios + Cheerio | BCN Normas, Diario Oficial (HTML estático) |
| Scraping Complejo | Playwright | PJUD y fuentes con WAF activo o JS dinámico |

### LlamaIndex.TS — Módulos Utilizados
| Módulo | Uso |
|---|---|
| `SimpleNodeParser` | Chunking base por tokens con overlap configurable |
| `SentenceSplitter` | Chunking semántico respetando oraciones completas |
| `HuggingFaceEmbedding` | Generación de embeddings (modelo configurable por fuente) |
| `QdrantVectorStore` | Integración directa con Qdrant, sin código boilerplate |
| `IngestionPipeline` | Orquesta el flujo: documento → chunks → embeddings → store |
| `MetadataExtractor` | Extrae y enriquece metadatos automáticamente por documento |

---

## 3. Arquitectura de Módulos NestJS

```
be-bulk/
├── src/
│   ├── core/
│   │   ├── interfaces/
│   │   │   └── data-source-scraper.interface.ts   # IDataSourceScraper
│   │   ├── types/
│   │   │   ├── raw-data.type.ts
│   │   │   └── parsed-document.type.ts
│   │   └── core.module.ts
│   │
│   ├── modules/
│   │   ├── database/          # Prisma + PostgreSQL
│   │   │   ├── prisma.service.ts
│   │   │   └── database.module.ts
│   │   │
│   │   ├── vector-store/      # QdrantService (Singleton)
│   │   │   ├── qdrant.service.ts
│   │   │   └── vector-store.module.ts
│   │   │
│   │   ├── embeddings/        # LlamaIndex HuggingFaceEmbedding
│   │   │   ├── embeddings.service.ts
│   │   │   └── embeddings.module.ts
│   │   │
│   │   ├── ingestion/         # LlamaIndex IngestionPipeline
│   │   │   ├── ingestion.service.ts
│   │   │   └── ingestion.module.ts
│   │   │
│   │   ├── queue/             # BullMQ workers y producers
│   │   │   ├── scraping.queue.ts
│   │   │   ├── scraping.worker.ts
│   │   │   └── queue.module.ts
│   │   │
│   │   └── scrapers/          # Implementaciones dinámicas
│   │       ├── bcn/
│   │       │   └── bcn-normas.scraper.ts
│   │       ├── pjud/
│   │       │   └── pjud-sentencias.scraper.ts
│   │       ├── diario-oficial/
│   │       │   └── diario-oficial.scraper.ts
│   │       └── scrapers.module.ts
│   │
│   ├── scheduler/
│   │   └── scheduler.service.ts   # @nestjs/schedule CronJobs
│   │
│   └── app.module.ts
```

---

## 4. Contrato Central — `IDataSourceScraper`

Toda fuente de datos **debe** implementar esta interfaz. Sin excepciones.

```typescript
// core/interfaces/data-source-scraper.interface.ts

export interface RawData {
  externalId: string;
  sourceUrl: string;
  rawHtml: string;
  fetchedAt: Date;
}

export interface ParsedDocument {
  externalId: string;
  sourceName: string;
  title: string;
  body: string;           // Texto limpio, sin HTML
  metadata: Record<string, unknown>;
  publishedAt?: Date;
}

export interface IDataSourceScraper {
  readonly sourceName: string;

  // Retorna lista de IDs/URLs a procesar desde un cursor
  fetchAvailableDocuments(cursor: string): Promise<RawData[]>;

  // Limpia y estructura el HTML crudo en documento procesable
  processDocument(raw: RawData): Promise<ParsedDocument>;

  // Chunking específico de la fuente (estructura legal propia)
  chunkDocument(doc: ParsedDocument): Promise<ParsedDocument[]>;
}
```

> **Regla clave:** El chunking vive en cada scraper porque cada fuente tiene su propia jerarquía documental. BCN tiene artículos numerados; PJUD tiene considerandos; el Diario Oficial tiene secciones. El core no asume nada.

---

## 5. Implementaciones de Scrapers

### BCN Normas (Axios + Cheerio)
```typescript
@Injectable()
export class BcnNormasScraper implements IDataSourceScraper {
  readonly sourceName = 'BCN_NORMAS';

  async fetchAvailableDocuments(cursor: string): Promise<RawData[]> {
    // Axios request a LeyChile con el ID de norma como cursor
    // Retorna lista de normas desde cursor hasta la más reciente
  }

  async processDocument(raw: RawData): Promise<ParsedDocument> {
    // Cheerio para limpiar HTML y extraer artículos
    // Decodificar caracteres especiales del español legal
  }

  async chunkDocument(doc: ParsedDocument): Promise<ParsedDocument[]> {
    // Chunking por Artículo: "Artículo 1°.- ...", "Artículo 2°.- ..."
    // Cada chunk retiene: número de artículo + título de ley en metadata
  }
}
```

### PJUD Sentencias (Playwright)
```typescript
@Injectable()
export class PjudSentenciasScraper implements IDataSourceScraper {
  readonly sourceName = 'PJUD_SENTENCIAS';

  async fetchAvailableDocuments(cursor: string): Promise<RawData[]> {
    // Playwright headless para evadir WAF y renderizado JS
    // Rotación de User-Agent + delays orgánicos entre requests
  }

  async processDocument(raw: RawData): Promise<ParsedDocument> {
    // Extracción de: ROL, Tribunal, Fecha, Ministros, Resolución
  }

  async chunkDocument(doc: ParsedDocument): Promise<ParsedDocument[]> {
    // Chunking por sección: VISTOS / CONSIDERANDOS / RESUELVE
    // Cada considerando numerado es un chunk independiente
  }
}
```

### Diario Oficial *(Nueva Fuente)*
```typescript
@Injectable()
export class DiarioOficialScraper implements IDataSourceScraper {
  readonly sourceName = 'DIARIO_OFICIAL';

  async fetchAvailableDocuments(cursor: string): Promise<RawData[]> {
    // Cursor = fecha de publicación (YYYY-MM-DD)
    // Fetch de ediciones desde última fecha procesada
  }

  async processDocument(raw: RawData): Promise<ParsedDocument> {
    // Extraer: número de edición, sección, norma publicada
  }

  async chunkDocument(doc: ParsedDocument): Promise<ParsedDocument[]> {
    // Chunking por sección del diario: I, II, III, Avisos
  }
}
```

---

## 6. Pipeline de Ingesta con LlamaIndex.TS

El `IngestionService` es **estático y genérico**. Recibe chunks ya procesados y los vectoriza.

```typescript
// modules/ingestion/ingestion.service.ts
import {
  IngestionPipeline,
  SentenceSplitter,
  HuggingFaceEmbedding,
  QdrantVectorStore,
  Document,
} from 'llamaindex';

@Injectable()
export class IngestionService {
  private pipeline: IngestionPipeline;

  constructor(
    @Inject(QdrantService) private readonly qdrant: QdrantService,
    @Inject(EmbeddingsService) private readonly embeddings: EmbeddingsService,
  ) {
    this.pipeline = new IngestionPipeline({
      transformations: [
        new SentenceSplitter({ chunkSize: 512, chunkOverlap: 64 }),
        this.embeddings.getModel(),  // HuggingFaceEmbedding configurable
      ],
      vectorStore: this.qdrant.getStore(),
    });
  }

  async ingest(chunks: ParsedDocument[]): Promise<void> {
    const documents = chunks.map(chunk =>
      new Document({
        text: chunk.body,
        metadata: {
          source: chunk.sourceName,
          externalId: chunk.externalId,
          title: chunk.title,
          ...chunk.metadata,
        },
      })
    );

    await this.pipeline.run({ documents });
  }
}
```

---

## 7. Cola de Tareas — BullMQ

```typescript
// scheduler/scheduler.service.ts
@Injectable()
export class SchedulerService {
  constructor(@InjectQueue('scraping') private scrapingQueue: Queue) {}

  // Cada viernes 23:00
  @Cron('0 23 * * 5')
  async triggerBcnNormas() {
    const cursor = await this.getLastCursor('BCN_NORMAS');
    await this.scrapingQueue.add('scrape', {
      source: 'BCN_NORMAS',
      cursor,
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  // Cada lunes 02:00
  @Cron('0 2 * * 1')
  async triggerPjud() {
    const cursor = await this.getLastCursor('PJUD_SENTENCIAS');
    await this.scrapingQueue.add('scrape', {
      source: 'PJUD_SENTENCIAS',
      cursor,
    }, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 10000 },
    });
  }
}
```

```typescript
// modules/queue/scraping.worker.ts
@Processor('scraping')
export class ScrapingWorker {
  constructor(
    private readonly scrapers: Map<string, IDataSourceScraper>,
    private readonly ingestion: IngestionService,
    private readonly cursors: CursorService,
  ) {}

  @Process('scrape')
  async handle(job: Job<{ source: string; cursor: string }>) {
    const scraper = this.scrapers.get(job.data.source);

    const rawDocs = await scraper.fetchAvailableDocuments(job.data.cursor);

    for (const raw of rawDocs) {
      const parsed  = await scraper.processDocument(raw);
      const chunks  = await scraper.chunkDocument(parsed);
      await this.ingestion.ingest(chunks);
      await this.cursors.update(job.data.source, raw.externalId);
    }
  }
}
```

---

## 8. Persistencia de Estado — `scraper_cursors`

```prisma
// prisma/schema.prisma

model ScraperCursor {
  id          String   @id @default(cuid())
  sourceName  String   @unique   // 'BCN_NORMAS', 'PJUD_SENTENCIAS', etc.
  lastCursor  String             // Último ID o fecha procesada
  updatedAt   DateTime @updatedAt
}

model Document {
  id          String   @id @default(cuid())
  externalId  String
  sourceName  String
  title       String
  body        String   @db.Text   // Texto raw completo
  metadata    Json
  publishedAt DateTime?
  indexedAt   DateTime @default(now())

  @@unique([sourceName, externalId])
}
```

---

## 9. Middleware de Ofuscación (Playwright + Axios)

```typescript
// Para fuentes con WAF (PJUD): Playwright con rotación
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...',
  'Mozilla/5.0 (X11; Linux x86_64)...',
];

async function createStealthBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    viewport: { width: 1280, height: 800 },
  });
  return context;
}

// Para fuentes simples (BCN, Diario Oficial): Axios interceptor
axiosInstance.interceptors.request.use(config => {
  config.headers['User-Agent'] = getRandomUserAgent();
  config.headers['Accept-Language'] = 'es-CL,es;q=0.9';
  return config;
});
```

---

## 10. Observabilidad (Mínimo Viable)

| Aspecto | Solución |
|---|---|
| **Logging estructurado** | `@nestjs/common` Logger + Pino JSON |
| **Métricas de jobs** | BullMQ Dashboard (Bull Board) |
| **Alertas de fallo** | Hook en BullMQ `failed` event → notificación (Slack/email) |
| **Trazabilidad de dato** | `Document.indexedAt` + `ScraperCursor.updatedAt` en Postgres |

```typescript
// Alerta cuando un job falla todos sus reintentos
this.scrapingQueue.on('failed', (job, err) => {
  logger.error({
    jobId: job.id,
    source: job.data.source,
    cursor: job.data.cursor,
    error: err.message,
    attempts: job.attemptsMade,
  });
  // notifyTeam(...)
});
```

---

## 11. Agregar una Nueva Fuente (Flujo Completo)

Para integrar, por ejemplo, **Contraloría General de la República**:

1. Crear `src/modules/scrapers/contraloria/contraloria.scraper.ts` implementando `IDataSourceScraper`
2. Registrar el servicio en `scrapers.module.ts`
3. Agregar un `@Cron` en `scheduler.service.ts`
4. Ejecutar migración Prisma si requiere campos nuevos en `Document`

**Cero cambios en el core.** El pipeline de ingesta, Qdrant y Postgres no se tocan.

---

## 12. Variables de Entorno

```env
# PostgreSQL
DATABASE_URL="postgresql://user:pass@localhost:5432/be_bulk"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Qdrant
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=your_api_key
QDRANT_COLLECTION=legal_docs_cl

# Embeddings (LlamaIndex)
EMBEDDING_MODEL=BAAI/bge-m3          # Multilingüe, óptimo para español legal
EMBEDDING_CHUNK_SIZE=512
EMBEDDING_CHUNK_OVERLAP=64

# Playwright
PLAYWRIGHT_HEADLESS=true
```

> **Nota sobre el modelo de embeddings:** `BAAI/bge-m3` es la recomendación para texto legal en español. Es multilingüe, maneja documentos largos y tiene excelente desempeño en recuperación semántica sobre textos formales.