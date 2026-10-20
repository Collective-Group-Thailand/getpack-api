import { AppConfig } from '@config/app-config';
import { Global, Logger, Module } from '@nestjs/common';

import { FileSearchService } from './file-search.service';
import { FileTextIndexJobs } from './file-text-index.jobs';
import {
  FakeFileTextEmbeddings,
  FILE_TEXT_EMBEDDINGS,
  type FileTextEmbeddings,
  LocalE5Embeddings,
} from './text-embeddings';
import { DocumentTextExtractor, FILE_TEXT_EXTRACTOR } from './text-extractor';

export const DEFAULT_MODEL_DIR = '/app/models/multilingual-e5-small';

/** `FILE_SEARCH_EMBEDDINGS` (see the RUNBOOK): null means search by meaning is off. */
export function embeddingsFor(config: AppConfig): FileTextEmbeddings | null {
  const dir = config.get('FILE_SEARCH_MODEL_DIR') ?? DEFAULT_MODEL_DIR;
  const choice = config.get('FILE_SEARCH_EMBEDDINGS') ?? (config.useFakes ? 'fake' : 'local');
  if (choice === 'fake') return new FakeFileTextEmbeddings();
  if (choice === 'off') return null;
  if (LocalE5Embeddings.available(dir)) return new LocalE5Embeddings(dir);
  new Logger('FileSearchModule').warn(`content search by meaning is off: no embedding model in ${dir}`);
  return null;
}

/**
 * Content search (D-427, ADR-0013). Both processes: the API searches (and embeds the query), the worker reads,
 * chunks and embeds files.
 */
@Global()
@Module({
  providers: [
    FileSearchService,
    FileTextIndexJobs,
    { provide: FILE_TEXT_EXTRACTOR, useFactory: () => new DocumentTextExtractor() },
    { provide: FILE_TEXT_EMBEDDINGS, inject: [AppConfig], useFactory: embeddingsFor },
  ],
  exports: [FileSearchService, FileTextIndexJobs],
})
export class FileSearchModule {}
