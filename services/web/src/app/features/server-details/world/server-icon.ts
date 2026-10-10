import { InjectionToken } from '@angular/core';

/** Minecraft only draws 64x64 icons. */
export const SERVER_ICON_SIZE = 64;

export interface SquareCrop {
  x: number;
  y: number;
  size: number;
}

/** The largest centred square of an image, so any picture ends up undistorted. */
export function squareCrop(width: number, height: number): SquareCrop {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/** Turns whatever image the admin picked into the 64x64 PNG the server expects. */
export async function toServerIcon(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { x, y, size } = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = SERVER_ICON_SIZE;
    canvas.height = SERVER_ICON_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('O navegador não conseguiu preparar a imagem.');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, x, y, size, size, 0, 0, SERVER_ICON_SIZE, SERVER_ICON_SIZE);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar o PNG.'))),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
  }
}

/** The conversion is injected so the panel can be tested without a real canvas. */
export const SERVER_ICON_ENCODER = new InjectionToken<(file: File) => Promise<Blob>>(
  'SERVER_ICON_ENCODER',
  { providedIn: 'root', factory: () => toServerIcon },
);
