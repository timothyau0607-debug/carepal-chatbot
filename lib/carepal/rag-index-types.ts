export type RagIndexChunk = {
  id: string;
  source: string;
  text: string;
  /** 方便 UI / debug */
  ref?: string;
  vector: number[];
};

export type CarepalRagIndexFile = {
  version: 1;
  embeddingModel: string;
  dim: number;
  createdAt: string;
  sources: { excel?: string; pdf?: string };
  chunkCount: number;
  chunks: RagIndexChunk[];
};
