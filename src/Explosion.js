import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');
const CX = W / 2;
const CY = H / 2;
const NUM_BRANCHES = 40;
const MAX_POINTS = 10;
const DURATION_MS = 3000; // hard 3-second cap

function rand(min, max) { return Math.random() * (max - min) + min; }

export default function Explosion({ onDone }) {
  const [frame, setFrame] = useState({ branches: [], tick: 0 });
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const lastRenderRef = useRef(0);
  const startTimeRef = useRef(null);

  useEffect(() => {
    const branches = [];
    for (let i = 0; i < NUM_BRANCHES; i++) {
      const startX = CX + rand(-15, 15);
      const startY = CY + rand(-15, 15);
      branches.push({
        id: i,
        angle: rand(0, Math.PI * 2),
        vel: rand(8, 22),
        hue: 200 + rand(-80, 80),
        life: 1,
        decay: rand(0.008, 0.018),
        points: [{ x: startX, y: startY }],
      });
    }
    stateRef.current = { branches, tick: 0 };

    const loop = (timestamp) => {
      const s = stateRef.current;
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;

      for (let j = s.branches.length - 1; j >= 0; j--) {
        const b = s.branches[j];
        b.life -= b.decay;
        if (b.life <= 0) {
          s.branches.splice(j, 1);
          continue;
        }
        const last = b.points[b.points.length - 1];
        b.points.push({
          x: last.x + Math.cos(b.angle) * b.vel,
          y: last.y + Math.sin(b.angle) * b.vel,
        });
        if (b.points.length > MAX_POINTS) b.points.shift();
        b.angle += rand(-1, 1) * b.vel * 0.03;
        b.vel *= 0.96;
        b.hue += 0.4;
      }

      s.tick++;

      if (elapsed >= DURATION_MS) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onDone && onDone();
        return;
      }

      if (timestamp - lastRenderRef.current >= 33) {
        lastRenderRef.current = timestamp;
        setFrame({ branches: [...s.branches], tick: s.tick });
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      <Svg width={W} height={H}>
        {frame.branches.map(b => {
          if (b.life <= 0 || b.points.length < 2) return null;
          const pts = b.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          const alpha = b.life;
          const hue = Math.round(b.hue) % 360;
          const glow = `hsla(${hue},100%,55%,${(alpha * 0.35).toFixed(2)})`;
          const core = `hsla(${hue},100%,82%,${alpha.toFixed(2)})`;
          return (
            <React.Fragment key={b.id}>
              <Polyline points={pts} stroke={glow} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Polyline points={pts} stroke={core} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.92)',
    zIndex: 999,
    elevation: 999,
  },
});
