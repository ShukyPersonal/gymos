import sharp from 'sharp';
import { readdirSync } from 'fs';
import { join } from 'path';

const dir = './assets/exercises';
const files = readdirSync(dir).filter(f => f.endsWith('.png'));

for (const file of files) {
  const p = join(dir, file);
  const { width, height } = await sharp(p).metadata();
  await sharp(p).resize(200, 200, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).toFile(p + '.tmp.png');
  const { execSync } = await import('child_process');
  execSync(`mv ${p}.tmp.png ${p}`);
  console.log(`✓ ${file}: ${width}x${height} → 200x200`);
}
console.log('Done.');
