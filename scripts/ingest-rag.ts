/**
 * 從失智ＱＡ.xlsx 與 失智100問 PDF 建立向量索引 data/carepal-rag.index.json
 * 需要 .env.local 內 OPENROUTER_API_KEY 或 OPENAI_API_KEY。
 *
 * 用法：npx tsx scripts/ingest-rag.ts
 * 可選：--xlsx "路徑" --pdf "路徑"
 */

import fs from "fs";
import path from "path";
import { config } from "dotenv";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";
import { createEmbeddingClient, embedTexts } from "../lib/carepal/embeddings";
import type { CarepalRagIndexFile, RagIndexChunk } from "../lib/carepal/rag-index-types";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

const DEFAULT_XLSX =
  "C:/Users/auks/OneDrive/文件/失智ＱＡ.xlsx";
const DEFAULT_PDF =
  "D:/Download/失智100問_21071514542460033-已壓縮.pdf";

function parseArgs(): { xlsx: string; pdf: string } {
  const a = process.argv.slice(2);
  let xlsx = process.env.RAG_EXCEL_PATH?.trim() || DEFAULT_XLSX;
  let pdf = process.env.RAG_PDF_PATH?.trim() || DEFAULT_PDF;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--xlsx" && a[i + 1]) {
      xlsx = a[++i]!;
    } else if (a[i] === "--pdf" && a[i + 1]) {
      pdf = a[++i]!;
    }
  }
  return { xlsx, pdf };
}

function splitBySize(s: string, max: number, overlap: number): string[] {
  const t = s.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out: string[] = [];
  for (let i = 0; i < t.length; i += max - overlap) {
    out.push(t.slice(i, i + max));
  }
  return out;
}

type PreChunk = {
  id: string;
  source: string;
  text: string;
  ref?: string;
};

function loadExcel(pathXlsx: string): PreChunk[] {
  if (!fs.existsSync(pathXlsx)) {
    throw new Error(`找不到 Excel：${pathXlsx}`);
  }
  const wb = XLSX.readFile(pathXlsx);
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
  }) as unknown[][];
  const out: PreChunk[] = [];
  for (const row of rows) {
    const id = String(row[0] ?? "").trim();
    const cat = String(row[1] ?? "").trim();
    const q = String(row[2] ?? "").trim();
    const ans = String(row[3] ?? "").trim();
    if (!q) continue;
    const text = [
      cat ? `分類：${cat}` : null,
      `問：${q}`,
      `答：${ans}`,
    ]
      .filter(Boolean)
      .join("\n");
    out.push({
      id: `xlsx-${id || "r" + out.length}`,
      source: "失智ＱＡ.xlsx",
      text,
      ref: id ? `#${id}` : undefined,
    });
  }
  return out;
}

async function loadPdf(pathPdf: string): Promise<PreChunk[]> {
  if (!fs.existsSync(pathPdf)) {
    throw new Error(`找不到 PDF：${pathPdf}`);
  }
  const buf = fs.readFileSync(pathPdf);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const tr = await parser.getText();
  await parser.destroy();
  const out: PreChunk[] = [];
  const name = path.basename(pathPdf);
  for (const page of tr.pages) {
    const n = page.num;
    const parts = splitBySize(page.text, 2000, 200);
    parts.forEach((p, j) => {
      if (!p.trim()) return;
      out.push({
        id: parts.length > 1 ? `pdf-p${n}-s${j}` : `pdf-p${n}`,
        source: `${name}（第 ${n} 頁）`,
        text: `（摘自《${name}》第 ${n} 頁）\n\n${p.trim()}`,
        ref: `p.${n}`,
      });
    });
  }
  if (out.length === 0 && tr.text?.trim()) {
    splitBySize(tr.text, 2000, 200).forEach((p, j) => {
      out.push({
        id: `pdf-all-${j}`,
        source: name,
        text: p.trim(),
      });
    });
  }
  return out;
}

const BATCH = 32;

async function main() {
  const { xlsx, pdf } = parseArgs();
  const emb = createEmbeddingClient();
  if (!emb) {
    console.error("請在 .env.local 設定 OPENROUTER_API_KEY 或 OPENAI_API_KEY。");
    process.exit(1);
  }

  console.log("讀取 Excel：", xlsx);
  const fromXlsx = loadExcel(xlsx);
  console.log("  列數：", fromXlsx.length);

  console.log("讀取 PDF：", pdf);
  const fromPdf = await loadPdf(pdf);
  console.log("  片段數：", fromPdf.length);

  const pre: PreChunk[] = [...fromXlsx, ...fromPdf];
  if (pre.length === 0) {
    console.error("沒有可匯入的文本。");
    process.exit(1);
  }

  const texts = pre.map((c) => c.text);
  const allVecs: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const vecs = await embedTexts(emb.client, emb.model, batch);
    allVecs.push(...vecs);
    console.log(`  embedding ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
  }

  const dim = allVecs[0]?.length ?? 0;
  const chunks: RagIndexChunk[] = pre.map((c, i) => ({
    id: c.id,
    source: c.source,
    text: c.text,
    ref: c.ref,
    vector: allVecs[i]!,
  }));

  if (dim && chunks[0] && chunks[0].vector.length !== dim) {
    throw new Error("向量維度不一致");
  }

  const out: CarepalRagIndexFile = {
    version: 1,
    embeddingModel: emb.model,
    dim,
    createdAt: new Date().toISOString(),
    sources: { excel: xlsx, pdf },
    chunkCount: chunks.length,
    chunks,
  };

  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "carepal-rag.index.json");
  fs.writeFileSync(outPath, JSON.stringify(out), "utf-8");
  console.log("已寫入", outPath, "（筆數", chunks.length, "，維度", dim, "）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
