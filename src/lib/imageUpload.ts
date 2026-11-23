export async function readAndResizePcbImage(file: File, maxDim = 1280): Promise<string> {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowed.includes(file.type)) {
    throw new Error('Please upload a PNG, JPEG, or WebP PCB image.');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode uploaded PCB image.'));
    el.src = rawDataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return rawDataUrl;
  }
  ctx.drawImage(img, 0, 0, width, height);

  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const compressed = canvas.toDataURL(outputType, 0.88);
  if (compressed.length > 5_500_000) {
    return canvas.toDataURL('image/jpeg', 0.82);
  }
  return compressed;
}
