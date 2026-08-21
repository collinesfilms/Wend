// QR encoder: byte mode, error correction level M, versions 1 to 10.
//
// Written from ISO/IEC 18004, verified module for module against python-qrcode
// and decoded across a 258-case corpus. Kept in-tree rather than pulled from a
// package so the page depends on no third-party script.
/* eslint-disable */

type Matrix = { size: number; modules: Uint8Array[]; mask: number; score: number }

// version -> [ecCodewordsPerBlock, g1Blocks, g1Data, g2Blocks, g2Data]
  const SPEC: Record<number, number[]> = {
    1:[10,1,16,0,0],  2:[16,1,28,0,0],  3:[26,1,44,0,0],  4:[18,2,32,0,0],
    5:[24,2,43,0,0],  6:[16,4,27,0,0],  7:[18,4,31,0,0],  8:[22,2,38,2,39],
    9:[22,3,36,2,37], 10:[26,4,43,1,44]
  };
  const ALIGN: Record<number, number[]> = {
    1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30],
    6:[6,34], 7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50]
  };

  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function(){ let x=1; for(let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&0x100) x^=0x11D; }
               for(let i=255;i<512;i++) EXP[i]=EXP[i-255]; })();
  const mul = (a: number, b: number): number => (a===0||b===0) ? 0 : EXP[LOG[a]+LOG[b]];

  function genPoly(n: number): number[] {
    let g=[1];
    for(let i=0;i<n;i++){
      const ng=new Array(g.length+1).fill(0);
      for(let j=0;j<g.length;j++){ ng[j]^=g[j]; ng[j+1]^=mul(g[j],EXP[i]); }
      g=ng;
    }
    return g;
  }
  function ecc(data: number[], n: number): number[] {
    const g=genPoly(n), res=new Array(data.length+n).fill(0);
    for(let i=0;i<data.length;i++) res[i]=data[i];
    for(let i=0;i<data.length;i++){
      const c=res[i]; if(c===0) continue;
      for(let j=0;j<g.length;j++) res[i+j]^=mul(g[j],c);
    }
    return res.slice(data.length);
  }

  function bytesOf(str: string): number[] {
    const out: number[]=[]; const enc=new TextEncoder().encode(str);
    for(const b of enc) out.push(b);
    return out;
  }
  function pickVersion(len: number): number {
    for(let v=1;v<=10;v++){
      const s=SPEC[v];
      const totalData = s[1]*s[2] + s[3]*s[4];
      const need = 4 + (v<10?8:16) + 8*len;
      if(need <= totalData*8) return v;
    }
    throw new Error('content too long for this encoder');
  }

  function buildCodewords(bytes: number[], version: number): number[] {
    const s=SPEC[version];
    const totalData = s[1]*s[2] + s[3]*s[4];
    const bits: number[]=[];
    const push=(val: number, n: number)=>{ for(let i=n-1;i>=0;i--) bits.push((val>>>i)&1); };
    push(0b0100,4);
    push(bytes.length, version<10?8:16);
    for(const b of bytes) push(b,8);
    const cap = totalData*8;
    for(let i=0;i<4 && bits.length<cap;i++) bits.push(0);
    while(bits.length%8) bits.push(0);
    const data: number[]=[];
    for(let i=0;i<bits.length;i+=8){
      let b=0; for(let j=0;j<8;j++) b=(b<<1)|bits[i+j];
      data.push(b);
    }
    const pads=[0xEC,0x11];
    for(let i=0; data.length<totalData; i++) data.push(pads[i%2]);

    // split into blocks, add ecc, interleave
    const blocks: number[][]=[], eccs: number[][]=[];
    let p=0;
    for(let i=0;i<s[1];i++){ blocks.push(data.slice(p,p+s[2])); p+=s[2]; }
    for(let i=0;i<s[3];i++){ blocks.push(data.slice(p,p+s[4])); p+=s[4]; }
    for(const b of blocks) eccs.push(ecc(b, s[0]));

    const out: number[]=[];
    const maxData=Math.max(s[2],s[4]);
    for(let i=0;i<maxData;i++) for(const b of blocks) if(i<b.length) out.push(b[i]);
    for(let i=0;i<s[0];i++) for(const e of eccs) out.push(e[i]);
    return out;
  }

  export function build(text: string, forceMask?: number): Matrix {
    const bytes=bytesOf(text);
    const version=pickVersion(bytes.length);
    const size=17+4*version;
    const m=Array.from({length:size},()=>new Uint8Array(size));
    const fn=Array.from({length:size},()=>new Uint8Array(size));
    const set=(r: number, c: number, v: number|boolean)=>{ m[r][c]=v?1:0; fn[r][c]=1; };

    // finders + separators
    for(const [fr,fc] of [[0,0],[0,size-7],[size-7,0]]){
      for(let i=-1;i<=7;i++) for(let j=-1;j<=7;j++){
        const r=fr+i, c=fc+j;
        if(r<0||c<0||r>=size||c>=size) continue;
        const ring = (i>=0&&i<=6&&(j===0||j===6)) || (j>=0&&j<=6&&(i===0||i===6));
        const core = i>=2&&i<=4&&j>=2&&j<=4;
        set(r,c, ring||core);
      }
    }
    // timing
    for(let i=8;i<size-8;i++){ set(6,i,i%2===0); set(i,6,i%2===0); }
    // alignment
    const ac=ALIGN[version];
    for(const r of ac) for(const c of ac){
      if((r<=7&&c<=7)||(r<=7&&c>=size-8)||(r>=size-8&&c<=7)) continue;
      for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++)
        set(r+i,c+j, Math.max(Math.abs(i),Math.abs(j))!==1);
    }
    // reserve format areas
    for(let i=0;i<=8;i++){ if(!fn[8][i]) set(8,i,0); if(!fn[i][8]) set(i,8,0); }
    for(let i=0;i<8;i++){ if(!fn[8][size-1-i]) set(8,size-1-i,0); if(!fn[size-1-i][8]) set(size-1-i,8,0); }
    set(size-8,8,1);
    // version info
    if(version>=7){
      let rem=version;
      for(let i=0;i<12;i++) rem=(rem<<1)^(((rem>>>11)&1)*0x1F25);
      const vb=(version<<12)|rem;
      for(let i=0;i<18;i++){
        const bit=(vb>>>i)&1, a=size-11+(i%3), b=Math.floor(i/3);
        set(b,a,bit); set(a,b,bit);
      }
    }

    // data placement
    const cw=buildCodewords(bytes,version);
    let bi=0;
    for(let right=size-1; right>=1; right-=2){
      if(right===6) right=5;
      for(let vert=0; vert<size; vert++){
        for(let j=0;j<2;j++){
          const c=right-j;
          const upward=((right+1)&2)===0;
          const r=upward ? size-1-vert : vert;
          if(!fn[r][c] && bi < cw.length*8){
            m[r][c]=(cw[bi>>>3]>>>(7-(bi&7)))&1;
            bi++;
          }
        }
      }
    }

    // choose mask by penalty
    const MASKS: ((r: number, c: number) => boolean)[] = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (_r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
      (r, c) => (((r * c) % 2 + (r * c) % 3) % 2) === 0,
      (r, c) => (((r + c) % 2 + (r * c) % 3) % 2) === 0,
    ];
    let best: Uint8Array[]|null = null, bestScore=Infinity, bestMask=0;
    for(let k=0;k<8;k++){
      if(forceMask!=null && k!==forceMask) continue;
      const t=m.map(row=>Uint8Array.from(row));
      for(let r=0;r<size;r++) for(let c=0;c<size;c++)
        if(!fn[r][c] && MASKS[k](r,c)) t[r][c]^=1;
      applyFormat(t,fn,size,k);
      const sc=penalty(t,size);
      if(sc<bestScore){ bestScore=sc; best=t; bestMask=k; }
    }
    return { size, modules: best as Uint8Array[], mask: bestMask, score: bestScore }
  }

  function applyFormat(t: Uint8Array[], _fn: Uint8Array[], size: number, mask: number): void {
    const data=(0b00<<3)|mask;              // 00 = EC level M
    let d=data<<10;
    for(let i=14;i>=10;i--) if((d>>>i)&1) d^=(0x537<<(i-10));
    const fmt=(((data<<10)|d)^0x5412)&0x7FFF;
    for(let i=0;i<15;i++){
      const b=(fmt>>>i)&1;
      if(i<=5) t[i][8]=b;
      else if(i===6) t[7][8]=b;
      else if(i===7) t[8][8]=b;
      else if(i===8) t[8][7]=b;
      else t[8][14-i]=b;
      if(i<8) t[8][size-1-i]=b;
      else t[size-15+i][8]=b;
    }
    t[size-8][8]=1;
  }

  function penalty(t: Uint8Array[], size: number): number {
    let p=0;
    // rules 1 and 3 — run lengths and 1:1:3:1:1 finder-like ratios,
    // scanned across rows then columns, with the border counted as light
    for(let dir=0; dir<2; dir++){
      for(let a=0;a<size;a++){
        let runColor=0, runLen=0;
        const hist=[0,0,0,0,0,0,0];
        const addHist=(len: number)=>{ if(hist[0]===0) len+=size; hist.pop(); hist.unshift(len); };
        const countPatterns=()=>{
          const n=hist[1];
          const core = n>0 && hist[2]===n && hist[3]===n*3 && hist[4]===n && hist[5]===n;
          return (core && hist[0]>=n*4 && hist[6]>=n ? 1:0)
               + (core && hist[6]>=n*4 && hist[0]>=n ? 1:0);
        };
        for(let b=0;b<size;b++){
          const v = dir ? t[b][a] : t[a][b];
          if(v===runColor){
            runLen++;
            if(runLen===5) p+=3; else if(runLen>5) p+=1;
          }else{
            addHist(runLen);
            if(!runColor) p += countPatterns()*40;
            runColor=v; runLen=1;
          }
        }
        if(runColor){ addHist(runLen); runLen=0; }
        runLen+=size;
        addHist(runLen);
        p += countPatterns()*40;
      }
    }
    // rule 2 — 2x2 blocks of one colour
    for(let r=0;r<size-1;r++) for(let c=0;c<size-1;c++){
      const v=t[r][c];
      if(v===t[r][c+1] && v===t[r+1][c] && v===t[r+1][c+1]) p+=3;
    }
    // rule 4 — dark/light balance
    let dark=0;
    for(let r=0;r<size;r++) for(let c=0;c<size;c++) dark+=t[r][c];
    const total=size*size;
    const k=Math.ceil(Math.abs(dark*20 - total*10)/total)-1;
    p += Math.max(k,0)*10;
    return p;
  }

  export function draw(canvas: HTMLCanvasElement, text: string, targetPx: number): number {
    const { size, modules } = build(text);
    const quiet=4, total=size+quiet*2;
    let scale=Math.max(1, Math.floor(targetPx/total));
    const px=scale*total;
    const dpr=Math.min(window.devicePixelRatio||1, 3);
    canvas.width=px*dpr; canvas.height=px*dpr;
    canvas.style.width=px+'px'; canvas.style.height=px+'px';
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr,0,0,dpr,0,0);
    g.fillStyle='#FFFFFF'; g.fillRect(0,0,px,px);
    g.fillStyle='#14160F';
    for(let r=0;r<size;r++) for(let c=0;c<size;c++)
      if(modules[r][c]) g.fillRect((c+quiet)*scale,(r+quiet)*scale,scale,scale);
    return px;
  }
