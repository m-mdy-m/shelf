import type { ReaderError, Result } from "@shelf/reader-core";
import type { BrowserFileHandleLike } from "./storage-port.js";

type OpenFilePicker = (options: {
  readonly multiple: false;
  readonly types: readonly [{
    readonly description: string;
    readonly accept: Readonly<Record<string, readonly string[]>>;
  }];
}) => Promise<BrowserFileHandleLike[]>;

function error(code: ReaderError["code"], message: string): Result<never, ReaderError> {
  return { ok: false, error: { code, message, retryable: false } };
}

/** Keeps browser file-picker interaction behind a platform adapter. */
export class BrowserPdfPicker {
  readonly #document: Document;
  readonly #window: Window;

  constructor(documentRef: Document = document, windowRef: Window = window) {
    this.#document = documentRef;
    this.#window = windowRef;
  }

  get canPickReference(): boolean {
    const host = this.#window as Window & { showOpenFilePicker?: OpenFilePicker };
    return typeof host.showOpenFilePicker === "function";
  }

  pickCopy(): Promise<Result<File, ReaderError>> {
    return new Promise((resolve) => {
      const input = this.#document.createElement("input");
      input.type = "file";
      input.accept = ".pdf,application/pdf";
      input.hidden = true;
      const finish = (result: Result<File, ReaderError>): void => {
        input.remove();
        resolve(result);
      };
      input.addEventListener("change", () => {
        const file = input.files?.item(0) ?? null;
        if (file === null) finish(error("cancelled", "PDF selection was cancelled."));
        else finish({ ok: true, value: file });
      }, { once: true });
      input.addEventListener("cancel", () => {
        finish(error("cancelled", "PDF selection was cancelled."));
      }, { once: true });
      this.#document.body.append(input);
      input.click();
    });
  }

  async pickReference(): Promise<Result<BrowserFileHandleLike, ReaderError>> {
    const host = this.#window as Window & { showOpenFilePicker?: OpenFilePicker };
    if (typeof host.showOpenFilePicker !== "function") {
      return error("not-supported", "This browser cannot keep a persistent external file reference. Import a copy instead.");
    }
    try {
      const handles = await host.showOpenFilePicker({
        multiple: false,
        types: [{
          description: "PDF documents",
          accept: { "application/pdf": [".pdf"] },
        }],
      });
      const handle = handles[0];
      return handle === undefined
        ? error("cancelled", "PDF selection was cancelled.")
        : { ok: true, value: handle };
    } catch (cause) {
      const name = typeof cause === "object" && cause !== null && "name" in cause
        ? String((cause as { name: unknown }).name)
        : "";
      return name === "AbortError"
        ? error("cancelled", "PDF selection was cancelled.")
        : error("permission-denied", "Shelf could not access the selected original file.");
    }
  }
}
