import { memo } from 'react';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';

// Line icons on a 24 x 24 grid. Each is a list of shapes; `fill: true` fills it instead of drawing its outline.
const ICONS = {
  discover: [['circle', { cx: 12, cy: 12, r: 10 }], ['polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76' }]],
  search: [['circle', { cx: 11, cy: 11, r: 8 }], ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]],
  library: [['rect', { x: 3, y: 3, width: 7, height: 7 }], ['rect', { x: 14, y: 3, width: 7, height: 7 }], ['rect', { x: 14, y: 14, width: 7, height: 7 }], ['rect', { x: 3, y: 14, width: 7, height: 7 }]],
  toolkit: [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
  premium: [['path', { d: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z' }]],
  settings: [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z' }],
  ],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5' }]],
  heart: [['path', { d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' }]],
  close: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
  more: [['circle', { cx: 12, cy: 5, r: 1.7, fill: true }], ['circle', { cx: 12, cy: 12, r: 1.7, fill: true }], ['circle', { cx: 12, cy: 19, r: 1.7, fill: true }]],
  share: [['path', { d: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13' }]],
  upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12' }]],
  back: [['path', { d: 'M15 18l-6-6 6-6' }]],
  forward: [['path', { d: 'M9 18l6-6-6-6' }]],
  down: [['path', { d: 'M6 9l6 6 6-6' }]],
  up: [['path', { d: 'M18 15l-6-6-6 6' }]],
  play: [['polygon', { points: '6 3 20 12 6 21 6 3', fill: true }]],
  pause: [['rect', { x: 6, y: 4, width: 4, height: 16, fill: true }], ['rect', { x: 14, y: 4, width: 4, height: 16, fill: true }]],
  restart: [['polygon', { points: '19 20 9 12 19 4 19 20', fill: true }], ['line', { x1: 5, y1: 4, x2: 5, y2: 20 }]],
  loop: [['path', { d: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3' }]],
  volume: [['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }], ['path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14' }]],
  mute: [['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }], ['line', { x1: 23, y1: 9, x2: 17, y2: 15 }], ['line', { x1: 17, y1: 9, x2: 23, y2: 15 }]],
  timer: [['circle', { cx: 12, cy: 13, r: 8 }], ['path', { d: 'M12 9v4l3 2M9 2h6' }]],
  check: [['path', { d: 'M20 6L9 17l-5-5' }]],
  lock: [['rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
  star: [['polygon', { points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2' }]],
  // the Toolkit's four tools
  tuner: [['path', { d: 'M3.8 17a8.2 8.2 0 0 1 16.4 0' }], ['path', { d: 'M12 17l3.2-6' }], ['circle', { cx: 12, cy: 17, r: 1.3, fill: true }], ['path', { d: 'M12 5.2v1.8M5.6 8l1.3 1.3M18.4 8l-1.3 1.3' }]],
  metronome: [['path', { d: 'M8.2 21h7.6L13.6 4.5h-3.2z' }], ['path', { d: 'M12 16.5L16.2 7.5' }], ['circle', { cx: 16.2, cy: 7.5, r: 1.1, fill: true }], ['path', { d: 'M9 21v-1.8h6V21' }]],
  practice: [['rect', { x: 5, y: 3.5, width: 14, height: 17, rx: 2 }], ['path', { d: 'M5 9h14M5 14.5h14M10 3.5v17M14.5 3.5v17' }], ['circle', { cx: 12.2, cy: 11.7, r: 1.3, fill: true }], ['circle', { cx: 7.6, cy: 6.3, r: 1.1, fill: true }]],
  'chord-detector': [['rect', { x: 9, y: 2.8, width: 6, height: 11.2, rx: 3 }], ['path', { d: 'M5.2 11.5a6.8 6.8 0 0 0 13.6 0M12 18.3v3' }]],
};

const SHAPES = { circle: Circle, line: Line, path: Path, polygon: Polygon, rect: Rect };

export const Icon = memo(function Icon({ name, size = 24, color = '#000', strokeWidth = 2, filled = false }) {
  const shapes = ICONS[name] || [];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapes.map(([tag, props], i) => {
        const Shape = SHAPES[tag];
        const { fill, ...rest } = props;
        return <Shape key={i} {...rest} fill={fill || filled ? color : 'none'} stroke={fill ? 'none' : color} />;
      })}
    </Svg>
  );
});
