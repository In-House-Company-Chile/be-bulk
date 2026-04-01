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
  body: string;
  metadata: Record<string, unknown>;
  publishedAt?: Date;
}

export interface IDataSourceScraper {
  readonly sourceName: string;
  fetchAvailableDocuments(cursor: string): Promise<RawData[]>;
  processDocument(raw: RawData): Promise<ParsedDocument>;
  chunkDocument(doc: ParsedDocument): Promise<ParsedDocument[]>;
}
