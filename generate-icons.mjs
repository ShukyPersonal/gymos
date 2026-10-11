import fs from 'fs';
import path from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
const OUTPUT_DIR = './assets/exercises';

const exercises = [
  {
    id: 'incline_bench_press',
    prompt: 'Minimalist black silhouette of a person lying on an incline bench at 30 degrees pressing dumbbells upward. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
  {
    id: 'assisted_pullups',
    prompt: 'Minimalist black silhouette of a person doing a pull-up on a bar, arms fully extended gripping the bar above, body hanging. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
  {
    id: 'incline_flyes',
    prompt: 'Minimalist black silhouette of a person lying on an incline bench with arms spread wide to the sides holding dumbbells, chest fly position. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
  {
    id: 'lateral_raises',
    prompt: 'Minimalist black silhouette of a person standing upright with both arms raised laterally to shoulder height holding dumbbells, lateral raise position. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
  {
    id: 'hammer_curls',
    prompt: 'Minimalist black silhouette of a person standing and curling one dumbbell upward with a neutral hammer grip, other arm down. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
  {
    id: 'dragon_flag',
    prompt: 'Minimalist black silhouette of a person doing a dragon flag exercise, body held straight and horizontal above a bench, shoulders on bench, legs and torso elevated. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
  {
    id: 'walking_lunges',
    prompt: 'Minimalist black silhouette of a person mid-lunge step, one knee down near the ground, other leg forward bent at 90 degrees, holding dumbbells at sides. Clean white background, simple flat icon style, no shading, solid black shapes only.',
  },
];

async function generateImage(exercise) {
  console.log(`Generating: ${exercise.id}...`);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: exercise.prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${exercise.id}: ${res.status} ${err}`);
  }

  const data = await res.json();
  const b64 = data.predictions[0].bytesBase64Encoded;
  const buf = Buffer.from(b64, 'base64');
  const outPath = path.join(OUTPUT_DIR, `${exercise.id}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`  ✓ saved ${outPath}`);
}

for (const ex of exercises) {
  await generateImage(ex);
}
console.log('All done!');
