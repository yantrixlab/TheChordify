import { memo } from 'react';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

const W = 84;
const H = 60;

/** A small drawing of each instrument's neck (or keys), in `color`, with its finger dots in `dot`. */
function InstrumentArt({ kind, color, dot }) {
  const parts = [];
  if (kind === 'piano') {
    const keys = 7;
    const kw = 68 / keys;
    for (let i = 0; i < keys; i++) parts.push(<Rect key={`w${i}`} x={8 + i * kw} y={6} width={kw} height={48} rx={2} fill="none" stroke={color} strokeWidth={1.6} />);
    [1, 2, 4, 5, 6].forEach((i) => parts.push(<Rect key={`b${i}`} x={8 + i * kw - 3.2} y={6} width={6.4} height={29} rx={1.5} fill={color} />));
    parts.push(<Circle key="d1" cx={8 + 2.5 * kw} cy={46} r={2.6} fill={dot} />, <Circle key="d2" cx={8 + 4.5 * kw} cy={46} r={2.6} fill={dot} />);
  } else {
    // a neck: strings down, frets across, a thick nut at the top
    const strings = kind === 'guitar' ? 6 : kind === 'ukulele' ? 4 : 8;
    const left = kind === 'guitar' ? 17 : kind === 'ukulele' ? 26 : 24;
    const right = W - left;
    const xs = [];
    if (kind === 'mandolin') {
      // four pairs of strings
      [0, 1, 2, 3].forEach((p) => {
        const c = left + ((right - left) * (p + 0.5)) / 4;
        xs.push(c - 2.2, c + 2.2);
      });
    } else {
      for (let i = 0; i < strings; i++) xs.push(left + ((right - left) * i) / (strings - 1));
    }
    const top = 8;
    const bottom = 54;
    const fretY = [0, 1, 2, 3, 4].map((r) => top + ((bottom - top) * r) / 4);
    xs.forEach((x, i) => parts.push(<Line key={`s${i}`} x1={x} y1={top} x2={x} y2={bottom} stroke={color} strokeWidth={1.3} />));
    fretY.forEach((y, i) => parts.push(<Line key={`f${i}`} x1={left - 2} y1={y} x2={right + 2} y2={y} stroke={color} strokeWidth={i === 0 ? 3.2 : 1.3} />));
    const cell = (bottom - top) / 4;
    const spots =
      kind === 'guitar'
        ? [[1, 1], [2, 2], [4, 2]]
        : kind === 'ukulele'
          ? [[1, 1], [2, 2]]
          : [[1, 1], [3, 2]];
    spots.forEach(([s, r], i) => parts.push(<Circle key={`d${i}`} cx={xs[Math.min(s, xs.length - 1)]} cy={top + cell * (r - 0.5)} r={3.4} fill={dot} />));
  }
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {parts}
    </Svg>
  );
}

export default memo(InstrumentArt);
