export type PdfSaveResult = "shared" | "downloaded" | "cancelled";

function isShareCancellation(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function loadPdfFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`PDF returned ${response.status}`);
  return new File([await response.blob()], filename, { type: "application/pdf" });
}

export async function sharePdfFile(file: File, title: string): Promise<PdfSaveResult> {
  const shareData: ShareData = { files: [file], title: `${title} — Potbelly` };

  if (navigator.share && navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (error) {
      if (isShareCancellation(error)) return "cancelled";
      throw error;
    }
  }

  downloadFile(file);
  return "downloaded";
}
