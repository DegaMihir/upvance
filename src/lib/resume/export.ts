import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import type { ResumeDoc } from "./document";

/** Replace characters the standard PDF fonts can't encode. */
function safe(s: string) {
  return (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•▪◦·]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2021-06" → "Jun 2021"; other text unchanged. */
export function formatYm(s?: string) {
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`.trim() : s;
}
const range = (a?: string, b?: string) => [formatYm(a), formatYm(b)].filter(Boolean).join(" – ");

function contactLine(doc: ResumeDoc) {
  return [doc.contact.email, doc.contact.phone, doc.contact.location, doc.contact.linkedin, doc.contact.website].filter(Boolean).join("  |  ");
}

export async function resumeToPdf(doc: ResumeDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.name} – Resume`);
  pdf.setCreator("Upvance");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 50; // A4
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const words = safe(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = (t: string, opts: { f?: PDFFont; size?: number; indent?: number; color?: [number, number, number]; gap?: number } = {}) => {
    const f = opts.f ?? font;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    for (const line of wrap(t, f, size, W - 2 * M - indent)) {
      ensure(size + 4);
      page.drawText(line, { x: M + indent, y: y - size, size, font: f, color: rgb(...(opts.color ?? [0.1, 0.1, 0.12])) });
      y -= size + 3;
    }
    y -= opts.gap ?? 0;
  };
  const heading = (t: string) => {
    ensure(30);
    y -= 8;
    page.drawText(safe(t.toUpperCase()), { x: M, y: y - 11, size: 11, font: bold, color: rgb(0.36, 0.16, 0.85) });
    y -= 15;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.8, 0.8, 0.85) });
    y -= 6;
  };

  text(doc.name || "Your Name", { f: bold, size: 20, gap: 2 });
  if (doc.headline) text(doc.headline, { size: 11, color: [0.3, 0.3, 0.35] });
  text(contactLine(doc), { size: 9, color: [0.35, 0.35, 0.4], gap: 4 });

  if (doc.summary) {
    heading("Summary");
    text(doc.summary);
  }
  if (doc.skills.length) {
    heading("Skills");
    text(doc.skills.join(" · ").replace(/·/g, "|"));
  }
  if (doc.experiences.length) {
    heading("Experience");
    for (const e of doc.experiences) {
      ensure(30);
      text(`${e.title}${e.company ? ` – ${e.company}` : ""}`, { f: bold, size: 10.5 });
      const meta = [e.location, range(e.start, e.end)].filter(Boolean).join("  |  ");
      if (meta) text(meta, { size: 9, color: [0.4, 0.4, 0.45] });
      for (const b of e.bullets) text(`-  ${b}`, { indent: 8 });
      y -= 4;
    }
  }
  if (doc.projects.length) {
    heading("Projects");
    for (const p of doc.projects) text(`${p.name}${p.description ? ` – ${p.description}` : ""}`);
  }
  if (doc.education.length) {
    heading("Education");
    for (const e of doc.education) {
      text(`${e.degree}${e.field ? `, ${e.field}` : ""}`, { f: bold });
      text([e.school, range(e.start, e.end)].filter(Boolean).join("  |  "), { size: 9, color: [0.4, 0.4, 0.45], gap: 2 });
    }
  }
  if (doc.certifications.length) {
    heading("Certifications");
    for (const c of doc.certifications) text(`-  ${c}`);
  }
  return pdf.save();
}

export async function resumeToDocx(doc: ResumeDoc): Promise<Buffer> {
  const section = (title: string) =>
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 80 },
      border: { bottom: { color: "BBBBCC", space: 2, style: BorderStyle.SINGLE, size: 6 } },
    });
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: doc.name || "Your Name", bold: true, size: 36 })] }),
    ...(doc.headline ? [new Paragraph({ children: [new TextRun({ text: doc.headline, size: 22, color: "555566" })] })] : []),
    new Paragraph({ children: [new TextRun({ text: contactLine(doc), size: 18, color: "555566" })], spacing: { after: 120 } }),
  ];
  if (doc.summary) children.push(section("Summary"), new Paragraph(doc.summary));
  if (doc.skills.length) children.push(section("Skills"), new Paragraph(doc.skills.join(" | ")));
  if (doc.experiences.length) {
    children.push(section("Experience"));
    for (const e of doc.experiences) {
      children.push(new Paragraph({ children: [new TextRun({ text: `${e.title}${e.company ? ` – ${e.company}` : ""}`, bold: true })], spacing: { before: 120 } }));
      const meta = [e.location, range(e.start, e.end)].filter(Boolean).join(" | ");
      if (meta) children.push(new Paragraph({ children: [new TextRun({ text: meta, size: 18, color: "666677" })] }));
      for (const b of e.bullets) children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    }
  }
  if (doc.projects.length) {
    children.push(section("Projects"));
    for (const p of doc.projects) children.push(new Paragraph({ children: [new TextRun({ text: p.name, bold: true }), new TextRun(p.description ? ` – ${p.description}` : "")] }));
  }
  if (doc.education.length) {
    children.push(section("Education"));
    for (const e of doc.education)
      children.push(
        new Paragraph({ children: [new TextRun({ text: `${e.degree}${e.field ? `, ${e.field}` : ""}`, bold: true })] }),
        new Paragraph({ children: [new TextRun({ text: [e.school, range(e.start, e.end)].filter(Boolean).join(" | "), size: 18, color: "666677" })] }),
      );
  }
  if (doc.certifications.length) {
    children.push(section("Certifications"));
    for (const c of doc.certifications) children.push(new Paragraph({ text: c, bullet: { level: 0 } }));
  }
  const d = new Document({
    creator: "Upvance",
    title: `${doc.name} – Resume`,
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [{ properties: {}, children }],
  });
  void AlignmentType;
  return Packer.toBuffer(d);
}

export async function textToPdf(title: string, body: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const W = 595, H = 842, M = 60, size = 11;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  pdf.setTitle(title);
  for (const para of safe(body).split(/\n/)) {
    const words = para.split(/\s+/);
    let line = "";
    const flush = () => {
      if (y < M + size) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      page.drawText(line, { x: M, y, size, font });
      y -= size + 5;
      line = "";
    };
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > W - 2 * M && line) {
        flush();
        line = w;
      } else line = t;
    }
    flush();
  }
  return pdf.save();
}
