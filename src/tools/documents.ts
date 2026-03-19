import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { registerTool } from "./registry.js";
import { SchemaType } from "@google/generative-ai";

const execAsync = promisify(exec);
const WORKSPACE = "/home/claw/workspace";

export function registerDocumentsTool(): void {
  fs.mkdir(WORKSPACE, { recursive: true }).catch(() => {});

  registerTool({
    name: "create_pdf",
    description: "Create a PDF document from text content. Returns the PDF file.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        filename: {
          type: SchemaType.STRING,
          description: "Name for the PDF file (e.g. 'report.pdf')",
        },
        title: {
          type: SchemaType.STRING,
          description: "Title displayed at the top of the PDF",
        },
        content: {
          type: SchemaType.STRING,
          description: "Text content for the PDF body",
        },
      },
      required: ["filename", "content"],
    },
    handler: async (args) => {
      const filename = String(args.filename).endsWith(".pdf")
        ? String(args.filename)
        : `${args.filename}.pdf`;

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontSize = 11;
      const margin = 50;
      const lineHeight = fontSize * 1.4;

      const content = String(args.content);
      const lines = content.split("\n");

      let page = pdfDoc.addPage([595, 842]); // A4
      let y = 842 - margin;

      // Title
      if (args.title) {
        page.drawText(String(args.title), {
          x: margin,
          y,
          size: 18,
          font: boldFont,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= 30;
      }

      // Body
      for (const line of lines) {
        // Word wrap
        const words = line.split(" ");
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const width = font.widthOfTextAtSize(testLine, fontSize);

          if (width > 595 - margin * 2) {
            page.drawText(currentLine, { x: margin, y, size: fontSize, font });
            y -= lineHeight;
            currentLine = word;

            if (y < margin) {
              page = pdfDoc.addPage([595, 842]);
              y = 842 - margin;
            }
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) {
          page.drawText(currentLine, { x: margin, y, size: fontSize, font });
        }
        y -= lineHeight;

        if (y < margin) {
          page = pdfDoc.addPage([595, 842]);
          y = 842 - margin;
        }
      }

      const pdfBytes = await pdfDoc.save();
      const buffer = Buffer.from(pdfBytes);

      // Also save to workspace
      const filePath = path.join(WORKSPACE, filename);
      await fs.writeFile(filePath, buffer);

      return {
        result: `PDF created: ${filename} (${Math.round(buffer.length / 1024)}KB)`,
        file: { buffer, filename, mimeType: "application/pdf" },
      };
    },
  });

  registerTool({
    name: "merge_pdfs",
    description: "Merge multiple PDF files from the workspace into one.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        input_files: {
          type: SchemaType.STRING,
          description: "Comma-separated list of PDF filenames in the workspace to merge",
        },
        output_filename: {
          type: SchemaType.STRING,
          description: "Name for the merged PDF file",
        },
      },
      required: ["input_files", "output_filename"],
    },
    handler: async (args) => {
      const files = String(args.input_files).split(",").map((f) => f.trim());
      const merged = await PDFDocument.create();

      for (const file of files) {
        const filePath = path.join(WORKSPACE, file);
        try {
          const data = await fs.readFile(filePath);
          const pdf = await PDFDocument.load(data);
          const pages = await merged.copyPages(pdf, pdf.getPageIndices());
          pages.forEach((p: import("pdf-lib").PDFPage) => merged.addPage(p));
        } catch {
          return { result: `Error: Could not read file "${file}"` };
        }
      }

      const pdfBytes = await merged.save();
      const buffer = Buffer.from(pdfBytes);
      const outputName = String(args.output_filename);
      await fs.writeFile(path.join(WORKSPACE, outputName), buffer);

      return {
        result: `Merged ${files.length} PDFs into ${outputName}`,
        file: { buffer, filename: outputName, mimeType: "application/pdf" },
      };
    },
  });

  registerTool({
    name: "read_pdf",
    description: "Extract text content from a PDF file in the workspace.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: "Path to the PDF file in the workspace",
        },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const filePath = path.join(WORKSPACE, String(args.path));
      try {
        const data = await fs.readFile(filePath);
        const pdf = await PDFDocument.load(data);
        const pageCount = pdf.getPageCount();
        // pdf-lib doesn't extract text — use pdftotext if available
        try {
          const { stdout } = await execAsync(`pdftotext "${filePath}" -`, { timeout: 10_000 });
          return { result: `PDF: ${pageCount} pages\n\n${stdout.slice(0, 6000)}` };
        } catch {
          return { result: `PDF loaded: ${pageCount} pages. (Text extraction requires pdftotext)` };
        }
      } catch {
        return { result: `Error: Could not read PDF at "${args.path}"` };
      }
    },
  });

  registerTool({
    name: "convert_document",
    description: "Convert a document between formats using LibreOffice (e.g. docx to pdf, odt to pdf, md to pdf).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        input_file: {
          type: SchemaType.STRING,
          description: "Input file path in the workspace",
        },
        output_format: {
          type: SchemaType.STRING,
          description: "Target format (pdf, docx, odt, txt, html)",
        },
      },
      required: ["input_file", "output_format"],
    },
    handler: async (args) => {
      const inputPath = path.join(WORKSPACE, String(args.input_file));
      const format = String(args.output_format).toLowerCase();

      try {
        await fs.access(inputPath);
      } catch {
        return { result: `Error: File not found: ${args.input_file}` };
      }

      try {
        await execAsync(
          `libreoffice --headless --convert-to ${format} --outdir "${WORKSPACE}" "${inputPath}"`,
          { timeout: 30_000 }
        );

        const baseName = path.basename(String(args.input_file), path.extname(String(args.input_file)));
        const outputFile = `${baseName}.${format}`;
        const outputPath = path.join(WORKSPACE, outputFile);

        const buffer = await fs.readFile(outputPath);

        return {
          result: `Converted to ${format}: ${outputFile}`,
          file: {
            buffer: Buffer.from(buffer),
            filename: outputFile,
            mimeType: format === "pdf" ? "application/pdf" : "application/octet-stream",
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: `Conversion failed: ${msg}` };
      }
    },
  });
}
