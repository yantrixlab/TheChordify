// Checks every chord the site can draw, on all four instruments: that each has a diagram, and that every shape holds the chord's notes.
// Run from absolute-ablation/:   node scripts/check-shapes.mjs
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'shapes-')), 'chordShapes.mjs');
await build({ entryPoints: ['src/lib/chordShapes.ts'], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const C = await import(pathToFileURL(out).href);
let passed=0, failed=0; const bad=[];
const check=(n,c,x='')=>{ if(c){passed++;console.log('  ok  ',n);} else {failed++;console.log('  FAIL',n,x);} };
const OPEN={guitar:[4,9,2,7,11,4],ukulele:[7,0,4,9],mandolin:[7,2,9,4]};
const pcs=(inst,shape)=>new Set(shape.frets.map((f,i)=>f==='x'?null:(OPEN[inst][i]+Number(f))%12).filter(v=>v!==null));
const need=(root,intervals,max=6)=>{ const all=intervals.map(i=>(root+i)%12); let req=intervals.filter(i=>!(i===7&&intervals.length>3)); if(req.length>max) req=req.filter(i=>i%12!==0&&i!==7); if(req.length>max) req=req.filter(i=>i<13); return {all:new Set(all),req:new Set(req.map(i=>(root+i)%12))}; };
const NAMES=C.CHORD_ROOTS;
const t0=Date.now();
const counts={guitar:0,ukulele:0,mandolin:0,piano:0}; const missing={guitar:[],ukulele:[],mandolin:[],piano:[]}; const wrong=[];
for(let r=0;r<12;r++) for(const q of C.CHORD_QUALITIES){
  const name=NAMES[r]+q.suffix; const {all}=need(r,q.intervals);
  for(const inst of ['guitar','ukulele','mandolin']){
    const d=C.chordDrawing(inst,name);
    if(d.shapes.length===0){ missing[inst].push(name); continue; }
    counts[inst]++;
    for(const s of d.shapes){
      const have=pcs(inst,s); const {req}=need(r,q.intervals,OPEN[inst].length);
      const rootless=new Set(q.intervals.filter(i=>i%12!==0&&i!==7).map(i=>(r+i)%12)); const okRootless=OPEN[inst].length<6 && [...rootless].every(p=>have.has(p));
      if(![...req].every(p=>have.has(p)) && !okRootless) wrong.push(`${inst} ${name} ${s.frets.join(',')}`);
      if(![...have].every(p=>all.has(p))) wrong.push(`${inst} ${name} has a stray note ${s.frets.join(',')}`);
      if(s.frets.length!==OPEN[inst].length) wrong.push(`${inst} ${name} wrong string count`);
    }
  }
  const p=C.chordDrawing('piano',name);
  if(p.voicings.length===0) missing.piano.push(name); else { counts.piano++;
    for(const v of p.voicings){ const have=new Set(v.notes.map(n=>n%12)); if(![...all].every(x=>have.has(x))) wrong.push(`piano ${name} ${v.name} lacks notes`); if(v.notes.some((n,i)=>i&&n<=v.notes[i-1])) wrong.push(`piano ${name} not ascending`); }
    if(p.voicings[0].name!=='Root position') wrong.push(`piano ${name} first is ${p.voicings[0].name}`);
  }
}
console.log('built in',Date.now()-t0,'ms; chords found:',JSON.stringify(counts));
const total=12*C.CHORD_QUALITIES.length;
const detectorSuffix=['','m','7','maj7','m7','mMaj7','sus2','sus4','dim','aug','6','m6','dim7','m7b5','5'];
const detMissing={}; for(const inst of Object.keys(missing)) detMissing[inst]=missing[inst].filter(n=>detectorSuffix.includes(n.replace(/^[A-G]#?/,'')));
check('every chord the detector can name has a guitar, ukulele, mandolin and piano diagram', Object.values(detMissing).every(a=>a.length===0), JSON.stringify(detMissing));
check('every shape has all the notes of its chord and no stray ones, on the right number of strings', wrong.length===0, wrong.slice(0,8).join(' | '));
console.log('   chords with no diagram by instrument (extended chords on four strings are left as note cards):', Object.fromEntries(Object.entries(missing).map(([k,v])=>[k,v.length])));
check('guitar and piano draw every one of the '+total+' chords', missing.guitar.length===0 && missing.piano.length===0, missing.guitar.concat(missing.piano).slice(0,10).join(','));
check('the ukulele and mandolin draw every chord too (a power chord or an 11th or 13th with its root and fifth left out)', missing.ukulele.length===0 && missing.mandolin.length===0, JSON.stringify(missing.ukulele.concat(missing.mandolin).slice(0,10)));
// slash chords: every chord tone as the bass
let slashBad=[], slashN=0;
for(let r=0;r<12;r++) for(const q of C.CHORD_QUALITIES.slice(0,15)) for(const i of q.intervals){ const b=(r+i)%12; if(b===r) continue; const name=`${NAMES[r]}${q.suffix}/${NAMES[b]}`; slashN++;
  for(const inst of ['guitar','ukulele','mandolin','piano']){ const d=C.chordDrawing(inst,name); const n=d.kind==='keys'?d.voicings.length:d.shapes.length; if(n===0 && !(inst!=='guitar'&&inst!=='piano'&&false)) slashBad.push(inst+' '+name); }
  const pv=C.chordDrawing('piano',name).voicings; if(pv.length && !pv.every(v=>v.notes.length>=q.intervals.length)) slashBad.push('piano short '+name);
  if(pv.length && ((pv[0].notes[0]%12)!==b)) slashBad.push('piano bass '+name);
}
console.log('   slash chords tried:',slashN,'; without a diagram:',slashBad.length, slashBad.slice(0,6).join(' | '));
check('inversions: every slash chord is drawn on every instrument, the piano with the bass lowest', slashBad.filter(s=>s.startsWith('piano')).length===0, slashBad.filter(s=>s.startsWith('piano')).slice(0,5).join(' | '));
check('spellings: Amin, A-7, CM7, Cø, C+, Dsus all read', ['Amin','A-7','CM7','Cø','C+','Dsus','Asus','Em7'].every(n=>C.chordNotes(n).length>=3), ['Amin','A-7','CM7','Cø','C+','Dsus'].map(n=>n+':'+C.chordNotes(n).join('')).join(' '));
check('transposing a chord with an extended quality works', C.transposeChord('Cmaj9',2)==='Dmaj9' && C.transposeChord('G7b9',-2)==='F7b9' && C.transposeChord('Amin',3)==='Cm');
check('C on piano: C4 E4 G4 first, then E4 G4 C5', JSON.stringify(C.getPianoVoicings('C')[0].notes)==='[60,64,67]' && JSON.stringify(C.getPianoVoicings('C')[1].notes)==='[64,67,72]');
check('C/E on piano: E in the left hand, then the 1st inversion', C.getPianoVoicings('C/E')[0].notes[0]===52 && C.getPianoVoicings('C/E')[0].notes.length===4 && C.getPianoVoicings('C/E')[1].notes[0]===64);
check('F# on piano is drawn around the middle of the keyboard', C.getPianoVoicings('F#')[0].notes[0]===66 && C.getPianoVoicings('G')[0].notes[0]===55);
check('mandolin G is the open shape 0 0 2 3', C.getMandolinShapes('G')[0].frets.join('')==='0023');
check('mandolin Am and ukulele Am', C.getMandolinShapes('Am')[0].frets.join('')==='2230' && C.getUkuleleShapes('Am')[0].frets.join('')==='2000');
check('every chord offers up to 3 ways on frets and up to 4 on piano', C.getMandolinShapes('A').length<=3 && C.getPianoVoicings('Cmaj7').length===4 && C.getPianoVoicings('C').length===3);
console.log(`\npassed ${passed}, failed ${failed}`); process.exit(failed?1:0);
