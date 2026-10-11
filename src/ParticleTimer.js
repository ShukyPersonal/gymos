import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
// Note: switched from per-particle Line+Circle (~800 SVG nodes at full tail)
// to batched Polylines (~14 SVG nodes) for performance.

const SCREEN_W = Dimensions.get('window').width;
const WIDTH = SCREEN_W - 32; // workoutContainer has padding 16 each side
const HEIGHT = 180;
const INSET = 14;
const PATH_W = WIDTH - 2 * INSET;
const PATH_H = HEIGHT - 2 * INSET;
const PERIMETER = 2 * (PATH_W + PATH_H);

const SPEED_BASE = 3;        // px/frame at progress=0
const SPEED_BOOST = 4.5;     // multiplier at progress=1 → ~16 px/frame
const SPAWN_INTERVAL = 5;    // px between particle spawns (constant regardless of speed)
const MIN_TAIL_PX = 70;      // tail length in px at progress=0
const MAX_TAIL_PX = PERIMETER + 40; // overlap so head visibly eats the tail at progress=1
const HARD_CAP = 260;

function perimeterPoint(dist) {
  const d = ((dist % PERIMETER) + PERIMETER) % PERIMETER;
  if (d < PATH_W) return { x: INSET + d, y: INSET, dx: 1, dy: 0 };
  if (d < PATH_W + PATH_H) return { x: INSET + PATH_W, y: INSET + (d - PATH_W), dx: 0, dy: 1 };
  if (d < 2 * PATH_W + PATH_H) return { x: INSET + PATH_W - (d - PATH_W - PATH_H), y: INSET + PATH_H, dx: -1, dy: 0 };
  return { x: INSET, y: INSET + PATH_H - (d - 2 * PATH_W - PATH_H), dx: 0, dy: -1 };
}

export default function ParticleTimer({ totalSecs, secsLeft, onSkip }) {
  const [frame, setFrame] = useState({ particles: [], tick: 0, headX: INSET, headY: INSET });
  const stateRef = useRef({ particles: [], tick: 0, nextId: 0, dist: 0, lastSpawnDist: 0 });
  const progressRef = useRef(0);
  const rafRef = useRef(null);
  const lastRenderRef = useRef(0);

  useEffect(() => {
    if (totalSecs > 0) {
      progressRef.current = Math.max(0, Math.min(1, (totalSecs - secsLeft) / totalSecs));
    } else {
      progressRef.current = 0;
    }
  }, [totalSecs, secsLeft]);

  useEffect(() => {
    const s = stateRef.current;

    const loop = (timestamp) => {
      const progress = progressRef.current;
      // Comet accelerates as rest wraps up — energy builds for the next set
      const speedNow = SPEED_BASE * (1 + progress * SPEED_BOOST);
      s.dist += speedNow;

      // Spawn particles at fixed perimeter spacing, regardless of speed
      while (s.dist - s.lastSpawnDist >= SPAWN_INTERVAL) {
        s.lastSpawnDist += SPAWN_INTERVAL;
        const point = perimeterPoint(s.lastSpawnDist);
        s.particles.push({
          id: s.nextId++,
          x: point.x,
          y: point.y,
          vx: point.dx * 0.3 + (Math.random() - 0.5) * 0.4,
          vy: point.dy * 0.3 + (Math.random() - 0.5) * 0.4,
          radius: 5,
          spawnDist: s.lastSpawnDist,
          life: 1,
        });
      }

      const tailDist = MIN_TAIL_PX + progress * (MAX_TAIL_PX - MIN_TAIL_PX);

      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        const dBehind = s.dist - p.spawnDist;
        if (dBehind >= tailDist) {
          s.particles.splice(i, 1);
        } else {
          const t = dBehind / tailDist;
          p.life = Math.max(0.4, 1 - t * 0.7);
        }
      }

      while (s.particles.length > HARD_CAP) s.particles.shift();

      s.tick++;

      if (timestamp - lastRenderRef.current >= 33) {
        lastRenderRef.current = timestamp;
        const headPoint = perimeterPoint(s.dist);
        setFrame({ particles: [...s.particles], tick: s.tick, headX: headPoint.x, headY: headPoint.y });
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <View style={styles.container}>
      <Svg width={WIDTH} height={HEIGHT} style={StyleSheet.absoluteFill}>
        {(() => {
          const SEG_SIZE = 25;
          const segs = [];
          for (let i = 0; i < frame.particles.length; i += SEG_SIZE) {
            // include one shared vertex with the next segment so there's no visual gap
            const seg = frame.particles.slice(i, i + SEG_SIZE + 1);
            if (seg.length < 2) continue;
            const lastP = seg[seg.length - 1];
            const avgLife = seg.reduce((s, p) => s + p.life, 0) / seg.length;
            const hue = Math.round((frame.tick + lastP.life * 120) % 360);
            const points = seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
            segs.push({ key: i, points, hue, alpha: avgLife });
          }
          return segs.map(s => (
            <React.Fragment key={s.key}>
              <Polyline
                points={s.points}
                stroke={`hsla(${s.hue},100%,60%,${(s.alpha * 0.32).toFixed(2)})`}
                strokeWidth={7}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Polyline
                points={s.points}
                stroke={`hsla(${s.hue},100%,82%,${s.alpha.toFixed(2)})`}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </React.Fragment>
          ));
        })()}
        {/* Bright comet head — always visible on top so motion is clear even when tail wraps */}
        <Circle cx={frame.headX} cy={frame.headY} r={16} fill="rgba(255,255,255,0.18)" />
        <Circle cx={frame.headX} cy={frame.headY} r={9} fill="rgba(255,255,255,0.45)" />
        <Circle cx={frame.headX} cy={frame.headY} r={5} fill="#fff" />
      </Svg>

      <View style={styles.overlay}>
        <Text style={styles.countdown}>{secsLeft}</Text>
        <Text style={styles.countdownLabel}>seconds</Text>
        <TouchableOpacity onPress={onSkip} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: WIDTH,
    height: HEIGHT,
    alignSelf: 'center',
    backgroundColor: '#111',
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  overlay: { position: 'absolute', alignItems: 'center' },
  countdown: { fontSize: 56, fontWeight: '800', color: '#fff', lineHeight: 60 },
  countdownLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12, letterSpacing: 1 },
  skipBtn: {
    paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  skipText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
});
