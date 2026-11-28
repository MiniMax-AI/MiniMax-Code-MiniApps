// Knowledge base: documents, chunks and bge-m3 vectors, persisted under the plugin dataDir.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { EMBEDDING_MODEL, embed } from './ollama.mjs';
import { ensureDir, readJson, removeIfExists, writeFileAtomic, writeJsonAtomic } from './store.mjs';

export const CATEGORIES = ['知识点', '规则', '合同', '其他'];

const CHUNK_TARGET_CHARS = 700;
const CHUNK_OVERLAP_CHARS = 120;

let registryCache = null;

/**
 * Splits a document into overlapping chunks that keep paragraph boundaries.
 * @param {string} text
 */
export function chunkText(text, options = {}) {
  const target = options.target || CHUNK_TARGET_CHARS;
  const overlap = options.overlap || CHUNK_OVERLAP_CHARS;
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const units = [];
  for (const paragraph of clean.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    if (trimmed.length <= target) {
      units.push(trimmed);
      continue;
    }
    let buffer = '';
    for (const sentence of trimmed.split(/(?<=[。！？；!?;])/)) {
      if (!sentence) continue;
      if (buffer.length + sentence.length > target && buffer) {
        units.push(buffer.trim());
        buffer = '';
      }
      buffer += sentence;
    }
    if (buffer.trim()) units.push(buffer.trim());
  }

  const chunks = [];
  let current = '';
  let offset = 0;
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > target) {
      chunks.push({ text: current.trim(), start: offset, end: offset + current.length });
      const tail = current.slice(-overlap);
      offset += Math.max(0, current.length - overlap);
      current = `${tail}\n${unit}`;
    } else {
      current = current ? `${current}\n${unit}` : unit;
    }
  }
  if (current.trim()) chunks.push({ text: current.trim(), start: offset, end: offset + current.length });
  return chunks;
}

function documentDirectory(kbDir, documentId) {
  return path.join(kbDir, documentId);
}

/**
 * Persists a parsed document together with its vectors.
 * @param {{ kbDir:string, ollamaBase:string, name:string, category:string, kind:string, sourcePath:string|null, sizeBytes:number, text:string, analysis:object }} input
 */
export async function saveDocument(input) {
  const {
    kbDir, ollamaBase, name, category, kind, sourcePath, sizeBytes, text, analysis,
  } = input;
  const documentId = randomUUID();
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('document_has_no_indexable_text');

  const vectors = await embed({
    base: ollamaBase,
    model: EMBEDDING_MODEL,
    inputs: chunks.map((chunk) => chunk.text),
  });

  const directory = documentDirectory(kbDir, documentId);
  await ensureDir(directory);
  await writeJsonAtomic(path.join(directory, 'chunks.json'), chunks);

  const dimension = vectors[0].length;
  const flat = new Float32Array(vectors.length * dimension);
  vectors.forEach((vector, index) => flat.set(vector, index * dimension));
  await writeFileAtomic(path.join(directory, 'vectors.bin'), Buffer.from(flat.buffer));

  const document = {
    id: documentId,
    name,
    category,
    kind,
    sourcePath: sourcePath || null,
    sizeBytes,
    chunkCount: chunks.length,
    characterCount: text.length,
    createdAt: new Date().toISOString(),
    embeddingModel: EMBEDDING_MODEL,
    title: analysis?.title || name,
    summary: analysis?.summary || '',
    keyPoints: analysis?.keyPoints || [],
    modelRoute: analysis?.route || null,
  };

  const index = await readIndex(kbDir);
  index.documents = index.documents.filter((item) => item.id !== documentId);
  index.documents.push(document);
  await writeJsonAtomic(path.join(kbDir, 'index.json'), index);
  registryCache = null;
  return document;
}

async function readIndex(kbDir) {
  const index = await readJson(path.join(kbDir, 'index.json'), null);
  if (index && Array.isArray(index.documents)) return index;
  return { documents: [] };
}

export async function listDocuments(kbDir) {
  const index = await readIndex(kbDir);
  return index.documents.slice().sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function deleteDocument(kbDir, documentId) {
  const index = await readIndex(kbDir);
  const before = index.documents.length;
  index.documents = index.documents.filter((item) => item.id !== documentId);
  if (index.documents.length === before) return false;
  await writeJsonAtomic(path.join(kbDir, 'index.json'), index);
  await removeIfExists(documentDirectory(kbDir, documentId));
  registryCache = null;
  return true;
}

/**
 * Loads every chunk and vector into memory for retrieval.
 */
async function loadRegistry(kbDir) {
  const index = await readIndex(kbDir);
  const signature = index.documents
    .map((document) => `${document.id}:${document.chunkCount}`)
    .join('|');
  if (registryCache && registryCache.kbDir === kbDir && registryCache.signature === signature) {
    return registryCache;
  }

  const documents = new Map(index.documents.map((document) => [document.id, document]));
  const chunks = [];
  const vectors = [];
  for (const document of index.documents) {
    const directory = documentDirectory(kbDir, document.id);
    const stored = await readJson(path.join(directory, 'chunks.json'), null);
    if (!Array.isArray(stored) || !stored.length) continue;
    let buffer = null;
    try {
      buffer = await import('node:fs/promises').then((fs) => fs.readFile(path.join(directory, 'vectors.bin')));
    } catch {
      buffer = null;
    }
    if (!buffer) continue;
    const dimension = buffer.byteLength / stored.length / 4;
    if (!Number.isFinite(dimension) || dimension <= 0) continue;
    const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    stored.forEach((chunk, indexInDocument) => {
      const vector = floats.slice(indexInDocument * dimension, (indexInDocument + 1) * dimension);
      chunks.push({
        documentId: document.id,
        chunkIndex: indexInDocument,
        text: chunk.text,
        start: chunk.start,
        end: chunk.end,
      });
      vectors.push(vector);
    });
  }

  registryCache = { kbDir, signature, documents, chunks, vectors };
  return registryCache;
}

export function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** Splits a query into terms: latin words plus CJK bigrams. */
export function queryTerms(query) {
  const text = String(query || '').toLowerCase();
  const terms = [];
  for (const matched of text.match(/[a-z0-9_]{2,}/g) || []) terms.push(matched);
  const cjk = text.replace(/[^一-龥]/g, ' ');
  for (const run of cjk.split(/\s+/)) {
    if (!run) continue;
    if (run.length === 1) {
      terms.push(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) terms.push(run.slice(index, index + 2));
  }
  return [...new Set(terms)];
}

function keywordScore(text, terms) {
  if (!terms.length) return 0;
  const haystack = String(text).toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits += 1;
  }
  return hits / terms.length;
}

/**
 * Retrieves the most relevant chunks for a question.
 * @param {{ kbDir:string, ollamaBase:string, question:string, topK?:number, signal?:AbortSignal }} input
 */
export async function retrieve(input) {
  const { kbDir, ollamaBase, question, topK = 6, signal } = input;
  const registry = await loadRegistry(kbDir);
  if (!registry.chunks.length) return { matches: [], total: 0 };

  const [queryVector] = await embed({ base: ollamaBase, model: EMBEDDING_MODEL, inputs: [question], signal });
  const terms = queryTerms(question);

  const scored = registry.chunks.map((chunk, index) => {
    const similarity = cosineSimilarity(queryVector, registry.vectors[index]);
    const keyword = keywordScore(chunk.text, terms);
    return { chunk, score: similarity * 0.78 + keyword * 0.22, similarity, keyword };
  });

  scored.sort((left, right) => right.score - left.score);
  const limit = Math.max(1, Math.min(Number(topK) || 6, 20));
  const matches = scored.slice(0, limit).map((entry) => {
    const document = registry.documents.get(entry.chunk.documentId);
    return {
      documentId: entry.chunk.documentId,
      documentName: document ? document.name : '(已删除资料)',
      category: document ? document.category : '其他',
      documentKind: document ? document.kind : 'text',
      chunkIndex: entry.chunk.chunkIndex,
      text: entry.chunk.text,
      preview: entry.chunk.text.slice(0, 220),
      score: Number(entry.score.toFixed(4)),
      similarity: Number(entry.similarity.toFixed(4)),
      keywordHit: Number(entry.keyword.toFixed(4)),
    };
  });

  return { matches, total: registry.chunks.length };
}

export function invalidateRegistry() {
  registryCache = null;
}
