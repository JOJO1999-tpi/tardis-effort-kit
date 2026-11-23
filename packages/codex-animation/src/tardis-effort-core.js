// Adapted from the supplied 16-bit TARDIS Thinking Effort core.
  'use strict';
  const DEFAULT_LEVELS = ['低', '中', '高', '超高'];
  const VISUAL_STOPS = [0, 1 / 3, 2 / 3, 1];
  const STOPS = VISUAL_STOPS;
  const ACCENTS = ['#4AA8FF', '#5CE1FF', '#9A7BFF', '#FF9838'];
  const PX_H = 34; // 34 art px * 2 = 68px crisp capsule height

  function newSceneBuffer() {
    return typeof document === 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas');
  }

  function mapEffortToVisualStage(tierIndex, totalTiers, hasUltraHigh) {
    const n = Math.max(1, totalTiers | 0);
    const i = Math.max(0, Math.min(n - 1, tierIndex | 0));
    if (n === 1) return 0;
    if (n === 2) return i === 0 ? 0 : (hasUltraHigh ? 3 : 2);
    if (hasUltraHigh) {
      if (i === 0) return 0;
      if (i === n - 1) return 3;
      if (i === n - 2) return 2;
      return 1;
    }
    if (i === 0) return 0;
    if (i === n - 1) return 2;
    return 1;
  }

  function buildProfileState(profileOpts = {}) {
    const rawLevels = Array.isArray(profileOpts.levels) && profileOpts.levels.length > 0
      ? profileOpts.levels.map((v) => String(v))
      : DEFAULT_LEVELS.slice();
    const hasUltraHigh = typeof profileOpts.hasUltraHigh === 'boolean'
      ? profileOpts.hasUltraHigh
      : (rawLevels.length >= 4 && rawLevels[rawLevels.length - 1] === '超高');
    const maxVisualStage = hasUltraHigh ? 3 : 2;
    const maxVisualP = VISUAL_STOPS[maxVisualStage];
    const stageMap = rawLevels.map((_, i) => rawLevels.length > 4
      ? Math.round(i * maxVisualStage / (rawLevels.length - 1))
      : mapEffortToVisualStage(i, rawLevels.length, hasUltraHigh));
    const visualPs = stageMap.map((s, i) => rawLevels.length > 4
      ? i * maxVisualP / (rawLevels.length - 1)
      : VISUAL_STOPS[s]);
    return {
      levels: rawLevels,
      hasUltraHigh,
      stageMap,
      visualPs,
      maxVisualStage,
      maxVisualP,
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function hexRgb(h) {
    const s = h.charAt(0) === '#' ? h.slice(1) : h;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function mixRgbArr(c1, c2, t) {
    const k = clamp(t, 0, 1);
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * k),
      Math.round(c1[1] + (c2[1] - c1[1]) * k),
      Math.round(c1[2] + (c2[2] - c1[2]) * k),
    ];
  }

  function mkRng(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  }

  const BAYER4 = [
    0 / 16, 8 / 16, 2 / 16, 10 / 16,
    12 / 16, 4 / 16, 14 / 16, 6 / 16,
    3 / 16, 11 / 16, 1 / 16, 9 / 16,
    15 / 16, 7 / 16, 13 / 16, 5 / 16,
  ];
  const bayer4 = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)];

  function pxRect(g, x, y, w, h, c) {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  // =========================================================================
  // MODULE 1: PREBAKED 16-BIT SPRITES & SCENE ENGINE
  // =========================================================================
  function bakeAsciiSprite(rows, palette) {
    const h = rows.length;
    const w = rows[0].length;
    const c = newSceneBuffer();
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (ch !== '.' && palette[ch]) {
          g.fillStyle = palette[ch];
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    return c;
  }

  const TARDIS_PAL = {
    L: '#FFFDF0', // lantern bright core
    l: '#A6DBFF', // lantern glass edge
    H: '#4D8CE6', // blue edge highlight
    B: '#2761BA', // classic TARDIS blue mid
    D: '#194184', // blue shadow / frame
    S: '#0E244D', // deep panel / base shadow
    K: '#091120', // POLICE BOX signboard dark bg
    T: '#E7F0FF', // POLICE BOX crisp white sign text
    W: '#FFF4B8', // warm lit window glass
    Y: '#FFD666', // lower window warm amber tint
    P: '#F4F7FC', // white PULL TO OPEN door notice
    p: '#607394', // tiny text marks on white notice
    M: '#D8E3F2', // silver door handle
  };

  function flipHorizontalSprite(srcCanvas) {
    const c = newSceneBuffer();
    c.width = srcCanvas.width;
    c.height = srcCanvas.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(srcCanvas, 0, 0);
    return c;
  }

  function bakeTintedSilhouette(srcCanvas, hexColor) {
    const c = newSceneBuffer();
    c.width = srcCanvas.width;
    c.height = srcCanvas.height;
    const g = c.getContext('2d');
    g.drawImage(srcCanvas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = hexColor;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  const DOC10_PAL = {
    h: '#3B2112', // dark brown hair
    H: '#6B3E23', // spiky brown hair highlight
    F: '#F3C59F', // face skin
    f: '#D29B72', // jaw shadow
    E: '#241711', // eye
    C: '#F4F6FA', // crisp white collar
    R: '#A82433', // burgundy tie
    T: '#B07B45', // camel-brown trench coat
    t: '#D6A066', // trench coat lapel highlight
    d: '#6F4926', // trench coat fold shadow
    N: '#1C2436', // dark pinstripe inner suit / trousers
    n: '#2C3852', // trouser highlight
    S: '#EFEBE0', // cream Converse sneakers
    s: '#B2ADA0', // Converse rubber sole
  };

  let SPRITE_TARDIS_UPRIGHT = null;
  let SPRITE_TARDIS_BLACKOUT = null;
  let SPRITE_TARDIS_GHOST_CYAN = null;
  let SPRITE_TARDIS_GHOST_AMBER = null;
  let SPRITE_DOCTOR_10 = null;
  let SPRITE_DOCTOR_10_WALK_R1 = null;
  let SPRITE_DOCTOR_10_WALK_R2 = null;
  let SPRITE_DOCTOR_10_WALK_R3 = null;
  let SPRITE_DOCTOR_10_WALK_L1 = null;
  let SPRITE_DOCTOR_10_WALK_L2 = null;
  let SPRITE_DOCTOR_10_WALK_L3 = null;
  let WALK_CYCLE_R = null;
  let WALK_CYCLE_L = null;

  function ensureSpritesBaked() {
    if (SPRITE_TARDIS_UPRIGHT) return;

    const tardisRows = [
      '......L......',
      '.....lLl.....',
      '....DDHDD....',
      '..HHBBBBBBDD.',
      '.HHBBBBBBBBDS',
      '.KTTKTKTTKTKS',
      '.KKKKKKKKKKKS',
      '.HBBBBBBBBDBS',
      '.HBWDBDWDBWDS',
      '.HBDDBDDDDDDS',
      '.HBYDBDYDBYDS',
      '.HBBBBBBBBDBS',
      '.HBPPPBSDSSDS',
      '.HBPpPBSDSSDS',
      '.HBPPPBMDSSDS',
      '.HBBBBBBBBDBS',
      '.HBSSSBSBSSDS',
      '.HBSSSBSBSSDS',
      '.HBSSSBSBSSDS',
      '.HDDDDDDDDDDS',
      'SSSSSSSSSSSSS',
      'SSSSSSSSSSSSS',
    ];
    SPRITE_TARDIS_UPRIGHT = bakeAsciiSprite(tardisRows, TARDIS_PAL);
    SPRITE_TARDIS_BLACKOUT = bakeAsciiSprite(tardisRows, {
      L: '#18243b', l: '#223654', H: '#274367', B: '#1b3051', D: '#142541',
      S: '#0c182b', K: '#08101f', T: '#304565', W: '#142541', Y: '#162a47',
      P: '#34435a', p: '#1c293c', M: '#34435c',
    });

    SPRITE_TARDIS_GHOST_CYAN = bakeTintedSilhouette(SPRITE_TARDIS_UPRIGHT, '#6AEFFF');
    SPRITE_TARDIS_GHOST_AMBER = bakeTintedSilhouette(SPRITE_TARDIS_UPRIGHT, '#FFAA40');

    SPRITE_DOCTOR_10 = bakeAsciiSprite([
      '...HhH....',
      '..hHHHh...',
      '..hFFEF...',
      '...FFf....',
      '...CRC....',
      '.tdTRTt...',
      'dTTRNNTd..',
      'dTTNNNtd..',
      '.TTNNTTd..',
      '.TTTNNTd..',
      '.dTTNTd...',
      '.dTTnTd...',
      '..TTnT....',
      '..d.nN....',
      '...NNn....',
      '..nN.Nn...',
      '..Ss..Ss..',
    ], DOC10_PAL);

    SPRITE_DOCTOR_10_WALK_R1 = bakeAsciiSprite([
      '....HhH...',
      '..hhHHHH..',
      '..hhFFEF..',
      '...fFFf...',
      '...CRC....',
      '..dTRTt...',
      '.dTTNRtt..',
      '.dTTNNTt..',
      'dTTTNNTd..',
      'dTTTNNT...',
      'dTTTNd....',
      '.dTTnT....',
      '..dTnN....',
      '..nN.nN...',
      '.nN...Nn..',
      '.n.....N..',
      '.Ss....Ss.',
    ], DOC10_PAL);

    SPRITE_DOCTOR_10_WALK_R2 = bakeAsciiSprite([
      '....HhH...',
      '..hhHHHH..',
      '..hhFFEF..',
      '...fFFf...',
      '...CRC....',
      '..dTRTt...',
      '.dTTNRtt..',
      '.dTTNNTt..',
      'dTTTNNTd..',
      '.dTTNNT...',
      '.dTTNd....',
      '..dTnT....',
      '...TnN....',
      '...nNN....',
      '...NNn....',
      '...nNn....',
      '...SsSs...',
    ], DOC10_PAL);

    SPRITE_DOCTOR_10_WALK_R3 = bakeAsciiSprite([
      '....HhH...',
      '..hhHHHH..',
      '..hhFFEF..',
      '...fFFf...',
      '...CRC....',
      '..dTRTt...',
      '.dTTNRtt..',
      '.dTTNNTt..',
      'dTTTNNTd..',
      'dTTTNNT...',
      'dTTTNd....',
      '.dTTnT....',
      '..dTnN....',
      '..nNnN....',
      '..N..Nn...',
      '..n...Nn..',
      '..Ss...Ss.',
    ], DOC10_PAL);

    SPRITE_DOCTOR_10_WALK_L1 = flipHorizontalSprite(SPRITE_DOCTOR_10_WALK_R1);
    SPRITE_DOCTOR_10_WALK_L2 = flipHorizontalSprite(SPRITE_DOCTOR_10_WALK_R2);
    SPRITE_DOCTOR_10_WALK_L3 = flipHorizontalSprite(SPRITE_DOCTOR_10_WALK_R3);

    WALK_CYCLE_R = [
      SPRITE_DOCTOR_10_WALK_R1,
      SPRITE_DOCTOR_10_WALK_R2,
      SPRITE_DOCTOR_10_WALK_R3,
      SPRITE_DOCTOR_10_WALK_R2,
    ];
    WALK_CYCLE_L = [
      SPRITE_DOCTOR_10_WALK_L1,
      SPRITE_DOCTOR_10_WALK_L2,
      SPRITE_DOCTOR_10_WALK_L3,
      SPRITE_DOCTOR_10_WALK_L2,
    ];
  }


  function drawTardisOpenDoor(g, drawX, drawY, openAmt, groundY) {
    if (openAmt <= 0.04) return;
    const openW = clamp(Math.round(openAmt * 4), 1, 4);
    const doorX = drawX + 7;
    const doorY = drawY + 8;
    const doorH = 12;

    // Warm golden console-room glow spilling from open doorway
    pxRect(g, doorX, doorY, openW, doorH, '#FFD666');
    if (openW >= 2) {
      pxRect(g, doorX + 1, doorY + 1, Math.max(1, openW - 1), doorH - 2, '#FFF7CE');
    }
    // Slight dark door-leaf hinge thickness on the left edge of the opening
    pxRect(g, doorX, doorY, 1, doorH, '#163B7A');

    // Warm golden puddle light cast onto London cobblestones in front of doorway
    g.save();
    g.globalAlpha = clamp(openAmt * 0.45, 0, 0.45);
    g.fillStyle = '#FFE48C';
    g.fillRect(doorX, groundY, openW + 3, 1);
    g.fillStyle = '#FFD060';
    g.fillRect(doorX + 1, groundY + 1, openW + 5, 1);
    g.restore();
  }

  function getTardisTrackNorm(p, maxVisualP = 1) {
    const s1 = STOPS[1];
    const maxP = Math.max(s1, maxVisualP);
    const s1Track = lerp(0.13, 0.81, clamp(s1 / maxP, 0, 1));
    if (p <= s1) {
      const u = clamp(p / s1, 0, 1);
      if (u <= 0.46) return 0.13;
      return lerp(0.13, s1Track, smoothstep(0.46, 1.0, u));
    }
    const spanP = Math.max(0.001, maxP - s1);
    return lerp(s1Track, 0.81, clamp((p - s1) / spanP, 0, 1));
  }

  // Static deterministic starfield, cloud bands, rain & speed lines
  const R = mkRng(4099);
  const STARS = Array.from({ length: 84 }, () => ({
    x: R(),
    y: R(),
    z: 0.35 + R() * 1.15,
    ph: R() * Math.PI * 2,
    col: R() > 0.72 ? '#8BF5FF' : R() > 0.44 ? '#FFE999' : '#FFFFFF',
    big: R() > 0.84,
  }));

  const ORBIT_CLOUDS = Array.from({ length: 10 }, () => ({
    x: R(),
    y: 0.66 + R() * 0.28,
    w: 7 + Math.floor(R() * 10),
    sp: 0.35 + R() * 0.55,
  }));

  const RAIN_DROPS = Array.from({ length: 28 }, () => ({
    x: R(),
    y: R(),
    sp: 0.8 + R() * 0.8,
  }));

  const R_FX = mkRng(9011);
  const SPEED_LINES = Array.from({ length: 26 }, (_, idx) => ({
    x: R_FX(),
    y: 1 + Math.floor(R_FX() * (PX_H - 2)),
    len: 4 + Math.floor(R_FX() * 10),
    sp: 0.75 + R_FX() * 0.75,
    fg: idx % 4 === 0,
    colIdx: idx % 3,
  }));

  const STRATO_CLOUDS = Array.from({ length: 14 }, () => ({
    x: R_FX(),
    y: R_FX(),
    w: 12 + Math.floor(R_FX() * 16),
    h: 2 + Math.floor(R_FX() * 2),
    sp: 0.7 + R_FX() * 0.7,
  }));

  function fillDitheredBandSky(g, pxW, h, hexStops, spread = 0.08) {
    const rgbs = hexStops.map(hexRgb);
    const n = rgbs.length - 1;
    for (let y = 0; y < h; y++) {
      const pos = (y / Math.max(1, h - 1)) * n;
      const idx = Math.min(n - 1, Math.floor(pos));
      const frac = pos - idx;
      for (let x = 0; x < pxW; x++) {
        const d = frac + (bayer4(x, y) - 0.5) * spread;
        const rgb = d > 0.5 ? rgbs[idx + 1] : rgbs[idx];
        g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  function buildStageCaches(pxW) {
    const pxH = PX_H;

    // 1) London evening skyline & wet cobblestone street
    const londonBg = newSceneBuffer();
    londonBg.width = pxW;
    londonBg.height = pxH;
    const lg = londonBg.getContext('2d');
    fillDitheredBandSky(lg, pxW, 27, ['#080E1E', '#0D1730', '#132243', '#1B3056', '#25406B'], 0.25);

    // Distant London Eye silhouette on the right-mid horizon
    const eyeCx = Math.round(pxW * 0.72);
    const eyeCy = 17;
    const eyeR = 8;
    for (let a = 0; a < 32; a++) {
      const th = (a / 32) * Math.PI * 2;
      pxRect(lg, eyeCx + Math.cos(th) * eyeR, eyeCy + Math.sin(th) * eyeR, 1, 1, '#3B5C8E');
      if (a % 4 === 0) {
        pxRect(lg, eyeCx + Math.cos(th) * (eyeR * 0.55), eyeCy + Math.sin(th) * (eyeR * 0.55), 1, 1, '#263E66');
      }
      if (a % 8 === 0) {
        pxRect(lg, eyeCx + Math.cos(th) * (eyeR - 1), eyeCy + Math.sin(th) * (eyeR - 1), 1, 1, '#79A8DE');
      }
    }
    pxRect(lg, eyeCx - 1, eyeCy, 1, 11, '#223659');
    pxRect(lg, eyeCx + 1, eyeCy, 1, 11, '#223659');

    // Victorian terraced roofline across horizon
    const rngL = mkRng(771);
    const windows = [];
    for (let bx = 0; bx < pxW; bx += 11) {
      const bw = 9 + Math.floor(rngL() * 6);
      const bh = 5 + Math.floor(rngL() * 7);
      const by = 27 - bh;
      pxRect(lg, bx, by, bw, bh, '#10192D');
      pxRect(lg, bx + 2, by - 2, 2, 2, '#131F36'); // chimney
      if (rngL() > 0.45) {
        windows.push([bx + 3, by + 2, '#E6B85C']);
      }
      if (rngL() > 0.65 && bw > 10) {
        windows.push([bx + 6, by + 3, '#D8A24A']);
      }
    }

    // Big Ben (Elizabeth Tower) iconic silhouette around 44% width
    const benX = Math.round(pxW * 0.44);
    pxRect(lg, benX - 3, 11, 7, 16, '#141E34');
    pxRect(lg, benX - 4, 9, 9, 3, '#1A2742');
    pxRect(lg, benX - 2, 6, 5, 3, '#17223B');
    pxRect(lg, benX - 1, 3, 3, 3, '#1B2947');
    pxRect(lg, benX, 1, 1, 2, '#2B406B'); // spire
    pxRect(lg, benX - 2, 12, 5, 5, '#293956');
    pxRect(lg, benX - 1, 13, 3, 3, '#19243a');

    // Classic red British telephone box accent far right
    const phoneX = Math.round(pxW * 0.87);
    pxRect(lg, phoneX, 20, 4, 7, '#7A1922');
    pxRect(lg, phoneX + 1, 21, 2, 3, '#A82632');

    // Victorian iron streetlamp around 80% width
    const lampX = Math.round(pxW * 0.78);
    pxRect(lg, lampX, 15, 1, 13, '#161D2C');
    pxRect(lg, lampX - 1, 13, 3, 2, '#26354b');
    pxRect(lg, lampX - 1, 12, 3, 1, '#1E283D');

    // Wet cobblestone pavement (y = 27..33)
    pxRect(lg, 0, 27, pxW, 7, '#121826');
    for (let y = 27; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        if ((x + (y % 2) * 2) % 4 === 0 && (y % 2 === 0)) {
          lg.fillStyle = '#1D263B';
          lg.fillRect(x, y, 2, 1);
        } else if (bayer4(x, y) > 0.8) {
          lg.fillStyle = '#0D121E';
          lg.fillRect(x, y, 1, 1);
        }
      }
    }
    // Bake the unlit street independently of the lighting layers.
    const blackoutBg = newSceneBuffer();
    blackoutBg.width = pxW;
    blackoutBg.height = pxH;
    const dark = blackoutBg.getContext('2d');
    dark.drawImage(londonBg, 0, 0);
    pxRect(dark, 0, 0, pxW, pxH, 'rgba(1, 5, 15, 0.48)');

    for (const [x, y, color] of windows) pxRect(lg, x, y, 1, 1, color);
    pxRect(lg, benX - 2, 12, 5, 5, '#FFE084');
    pxRect(lg, benX - 1, 13, 3, 3, '#FFF6C8');
    pxRect(lg, benX, 13, 1, 2, '#3C2F1E');
    pxRect(lg, benX, 14, 2, 1, '#3C2F1E');
    pxRect(lg, phoneX + 1, 22, 2, 1, '#FFD480');
    pxRect(lg, lampX - 1, 13, 3, 2, '#FFE28A');
    pxRect(lg, lampX, 13, 1, 1, '#FFFFFF');
    pxRect(lg, lampX - 4, 11, 9, 7, 'rgba(255, 214, 110, 0.16)');
    pxRect(lg, lampX - 3, 29, 7, 1, 'rgba(255, 206, 102, 0.25)');
    pxRect(lg, lampX - 2, 31, 5, 1, 'rgba(255, 206, 102, 0.16)');

    // 2) Earth Orbit horizon (curved planet bottom ~13 rows)
    const earthBg = newSceneBuffer();
    earthBg.width = pxW;
    earthBg.height = pxH;
    const eg = earthBg.getContext('2d');
    fillDitheredBandSky(eg, pxW, pxH, ['#040814', '#060D20', '#08132B', '#0B1A38', '#0E2247'], 0.22);
    const earthCx = pxW * 0.5;
    const earthR = Math.max(130, pxW * 1.15);
    const earthCy = pxH + earthR - 13;
    for (let y = 17; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        const dx = x - earthCx;
        const dy = y - earthCy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rim = dist - earthR;
        if (rim < 2.4 && rim >= 0) {
          // Cyan orbital atmosphere glow
          const alpha = 1 - rim / 2.4;
          eg.fillStyle = alpha > 0.55 ? '#84EEFF' : '#2E82EA';
          eg.fillRect(x, y, 1, 1);
        } else if (rim < 0) {
          // Ocean + deterministic pixel continents
          const lon = x * 0.085;
          const lat = (y - 20) * 0.30;
          const n = Math.sin(lon * 0.9 + Math.cos(lat * 1.3)) + Math.cos(lon * 1.8 - lat * 0.8) * 0.55;
          if (rim > -1.3) {
            eg.fillStyle = '#8CF2FF';
          } else if (n > 0.45) {
            eg.fillStyle = n > 0.88 ? '#C29F58' : (bayer4(x, y) > 0.5 ? '#42A462' : '#2E824E');
          } else {
            eg.fillStyle = rim > -3.4 ? '#287CE6' : (bayer4(x, y) > 0.6 ? '#1754AC' : '#103B82');
          }
          eg.fillRect(x, y, 1, 1);
        }
      }
    }

    // 3) Deep Space Bayer-dithered nebula + ringed planet
    const spaceBg = newSceneBuffer();
    spaceBg.width = pxW;
    spaceBg.height = pxH;
    const sg = spaceBg.getContext('2d');
    const cVoid = hexRgb('#04050F');
    const cDeep = hexRgb('#0D0B28');
    const cIndigo = hexRgb('#1D174E');
    const cViolet = hexRgb('#4D2480');
    const cTeal = hexRgb('#155E7B');
    for (let y = 0; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        const nx = x / pxW;
        const ny = y / pxH;
        const wave = Math.sin(nx * 5.2 + ny * 3.1) * 0.5 + Math.cos(nx * 9.5 - ny * 4.4) * 0.3;
        const band = Math.exp(-Math.pow((ny - 0.52 + Math.sin(nx * 4.0) * 0.14) * 3.1, 2));
        const val = clamp(band * (0.58 + wave * 0.42), 0, 1);
        const dith = val + (bayer4(x, y) - 0.5) * 0.14;
        let rgb = cVoid;
        if (dith > 0.74) rgb = nx > 0.50 ? cTeal : cViolet;
        else if (dith > 0.48) rgb = cIndigo;
        else if (dith > 0.25) rgb = cDeep;
        sg.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        sg.fillRect(x, y, 1, 1);
      }
    }
    // Small distant ringed pixel planet (left-top sky)
    const pCx = Math.round(pxW * 0.24);
    const pCy = 9;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy <= 10) {
          sg.fillStyle = dx + dy < -1 ? '#E8B8A2' : dx + dy > 1 ? '#6A3E52' : '#B56E6E';
          sg.fillRect(pCx + dx, pCy + dy, 1, 1);
        }
      }
    }
    for (let rx = -6; rx <= 6; rx++) {
      const ry = Math.round(rx * 0.32);
      if (Math.abs(rx) >= 3 || ry >= 0) {
        sg.fillStyle = Math.abs(rx) > 4 ? '#A894C8' : '#E8D2AA';
        sg.fillRect(pCx + rx, pCy + ry, 1, 1);
      }
    }

    // 4) Precomputed Polar Lookup Tables for 10th Doctor Time Vortex
    const vx = pxW * 0.94;
    const vy = pxH * 0.47;
    const count = pxW * pxH;
    const vortexR = new Float32Array(count);
    const vortexLogR = new Float32Array(count);
    const vortexAng = new Float32Array(count);
    for (let y = 0; y < pxH; y++) {
      for (let x = 0; x < pxW; x++) {
        const idx = y * pxW + x;
        const dx = (x - vx) * 0.56; // subtle tunnel foreshortening
        const dy = y - vy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        vortexR[idx] = dist;
        vortexLogR[idx] = Math.log(dist + 1.5);
        vortexAng[idx] = Math.atan2(dy, dx);
      }
    }

    return {
      pxW,
      pxH,
      londonBg,
      blackoutBg,
      londonLights: { lampX, benX, phoneX },
      earthBg,
      spaceBg,
      vortexR,
      vortexLogR,
      vortexAng,
      vortexImg: new ImageData(pxW, pxH),
      vortexCanvas: (() => {
        const c = newSceneBuffer();
        c.width = pxW;
        c.height = pxH;
        return c;
      })(),
    };
  }

  function renderTimeVortexLayer(cache, t, opacity) {
    const { pxW, pxH, vortexR, vortexLogR, vortexAng, vortexImg, vortexCanvas } = cache;
    const data = vortexImg.data;
    const speed = t * 4.4;
    const rot = t * 1.85;
    const a255 = Math.round(clamp(opacity, 0, 1) * 255);

    for (let y = 0; y < pxH; y++) {
      const rowOff = y * pxW;
      for (let x = 0; x < pxW; x++) {
        const i = rowOff + x;
        const dist = vortexR[i];
        const lr = vortexLogR[i];
        const ang = vortexAng[i];

        // Logarithmic spiral depth so concentric 10th-Doctor blue & orange streams fill the entire tunnel
        const phase = lr * 4.6 - speed * 0.9;
        const waveBlue = Math.sin(ang * 2.0 + phase - rot * 0.45 + Math.cos(lr * 2.4 - t * 1.4) * 0.5);
        const waveOrange = Math.sin(ang * 2.0 + Math.PI + phase - rot * 0.45 - Math.sin(lr * 2.0 + t * 1.2) * 0.45);
        const ridge = Math.cos(ang * 6.0 - lr * 3.6 + speed * 1.1) * 0.34;

        const bVal = clamp((waveBlue + ridge + 0.32) * 0.56, 0, 1);
        const oVal = clamp((waveOrange - ridge * 0.45 + 0.24) * 0.56, 0, 1);

        // Bright fiery/electric throat near vanishing point, dark pinhole at dead center
        const throat = Math.exp(-Math.pow((dist - 4.0) / 4.4, 2));
        const coreVoid = smoothstep(0.6, 2.5, dist);
        const dith = bayer4(x, y) - 0.5;

        let r = 6, g = 12, b = 30;
        if (oVal > bVal + 0.03) {
          const level = clamp(oVal + throat * 0.38 + dith * 0.16, 0, 1);
          if (level > 0.87) { r = 255; g = 212; b = 96; }
          else if (level > 0.64) { r = 236; g = 104; b = 18; }
          else if (level > 0.36) { r = 138; g = 40; b = 8; }
          else { r = 42; g = 10; b = 8; }
        } else {
          const level = clamp(bVal + throat * 0.34 + dith * 0.16, 0, 1);
          if (level > 0.87) { r = 136; g = 232; b = 255; }
          else if (level > 0.62) { r = 38; g = 128; b = 232; }
          else if (level > 0.34) { r = 16; g = 54; b = 142; }
          else { r = 7; g = 18; b = 52; }
        }

        // Core pinhole blend
        r = Math.round(r * coreVoid + 12 * (1 - coreVoid));
        g = Math.round(g * coreVoid + 22 * (1 - coreVoid));
        b = Math.round(b * coreVoid + 52 * (1 - coreVoid));

        const p4 = i << 2;
        data[p4] = r;
        data[p4 + 1] = g;
        data[p4 + 2] = b;
        data[p4 + 3] = a255;
      }
    }

    const vg = vortexCanvas.getContext('2d');
    vg.putImageData(vortexImg, 0, 0);

    // High-speed radial temporal streaks & occasional pixel lightning arcs
    vg.globalAlpha = clamp(opacity, 0, 1);
    const vx = pxW * 0.94;
    const vy = pxH * 0.47;
    for (let s = 0; s < 14; s++) {
      const ang = (s / 14) * Math.PI * 2 + Math.sin(s * 3.1) * 0.2;
      const travel = ((t * (1.8 + (s % 3) * 0.45) + s * 0.19) % 1);
      const r0 = 3 + travel * pxW * 0.88;
      const len = 3 + travel * 6;
      const sx = Math.round(vx + Math.cos(ang) * r0);
      const sy = Math.round(vy + Math.sin(ang) * r0 * 0.55);
      const ex = Math.round(vx + Math.cos(ang) * (r0 + len));
      const ey = Math.round(vy + Math.sin(ang) * (r0 + len) * 0.55);
      if (sx >= 0 && sx < pxW && sy >= 0 && sy < pxH) {
        vg.fillStyle = s % 2 === 0 ? '#A8F2FF' : '#FFE07A';
        vg.fillRect(sx, sy, Math.max(1, Math.abs(ex - sx) > 2 ? 2 : 1), 1);
        if (ex >= 0 && ex < pxW && ey >= 0 && ey < pxH) {
          vg.fillRect(ex, ey, 1, 1);
        }
      }
    }

    // Subtle intermittent crackling temporal lightning bolt
    const boltPhase = Math.floor(t * 7.5);
    if (boltPhase % 9 === 0 || boltPhase % 13 === 0) {
      const startX = Math.round(vx - 14 - (boltPhase % 5) * 9);
      const topSide = boltPhase % 2 === 0 ? 5 : pxH - 7;
      vg.fillStyle = topSide < 15 ? '#D8FAFF' : '#FFE89A';
      for (let k = 0; k < 8; k++) {
        const bx = startX - k * 3;
        const by = topSide + ((k + boltPhase) % 3) - 1;
        if (bx >= 0 && bx < pxW && by >= 0 && by < pxH) {
          vg.fillRect(bx, by, 2, 1);
        }
      }
    }
    vg.globalAlpha = 1;
  }

  function drawDynamicEarth(g, pxW, cx, topY, r, earthR0, t, reduced) {
    const cy = topY + r;
    const minX = Math.max(0, Math.floor(cx - r - 3));
    const maxX = Math.min(pxW - 1, Math.ceil(cx + r + 3));
    const minY = Math.max(0, Math.floor(cy - r - 3));
    const maxY = Math.min(PX_H - 1, Math.ceil(cy + r + 3));
    if (minX > maxX || minY > maxY) return;

    const shrinkFrac = clamp(Math.log(earthR0 / Math.max(2, r)) / Math.log(earthR0 / 4.0), 0, 1);
    const rimW = lerp(2.4, 1.3, shrinkFrac);
    const scale = Math.min(4.2, Math.pow(earthR0 / Math.max(2, r), 0.52));
    const cloudShift = reduced ? 0 : t * 1.8;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const rim = dist - r;
        if (rim < rimW && rim >= 0) {
          const alpha = 1 - rim / rimW;
          g.fillStyle = alpha > 0.55 ? '#84EEFF' : '#2E82EA';
          g.fillRect(x, y, 1, 1);
        } else if (rim < 0) {
          const lon = ((x - cx) * scale + cx) * 0.085;
          const lat = (y - topY + 1) * 0.30 * Math.min(2.4, scale);
          const n = Math.sin(lon * 0.9 + Math.cos(lat * 1.3)) + Math.cos(lon * 1.8 - lat * 0.8) * 0.55;
          const cloud = Math.sin(lon * 1.4 - cloudShift + lat * 2.1);
          if (rim > -1.2) {
            g.fillStyle = '#8CF2FF';
          } else if (cloud > 0.82) {
            g.fillStyle = '#F2FAFF';
          } else if (n > 0.45) {
            g.fillStyle = n > 0.88 ? '#C29F58' : (bayer4(x, y) > 0.5 ? '#42A462' : '#2E824E');
          } else {
            g.fillStyle = rim > -3.0 ? '#287CE6' : (bayer4(x, y) > 0.6 ? '#1754AC' : '#103B82');
          }
          g.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  function drawRecedingEarth(g, pxW, u12, t, reduced) {
    const earthR0 = Math.max(130, pxW * 1.15);
    const s = smoothstep(0.0, 0.88, u12);
    if (s >= 0.999) return;
    const r = earthR0 * Math.pow(4.0 / earthR0, s);
    const topY = lerp(PX_H - 13, 21.5, s);
    const cx = s < 0.52
      ? lerp(pxW * 0.5, pxW * 0.16, smoothstep(0, 0.52, s))
      : lerp(pxW * 0.16, -12, smoothstep(0.52, 1.0, s));
    drawDynamicEarth(g, pxW, cx, topY, r, earthR0, t, reduced);
  }

  function drawLondonAtmosphere(g, cache, pxW, dropY, t, reduced) {
    g.drawImage(cache.londonBg, 0, dropY);
    if (!reduced) {
      g.fillStyle = 'rgba(170, 205, 255, 0.26)';
      for (let i = 0; i < RAIN_DROPS.length; i++) {
        const d = RAIN_DROPS[i];
        const rx = Math.floor(((d.x * pxW) - t * 14 * d.sp) % pxW + pxW) % pxW;
        const ry = Math.floor(((d.y * 28) + t * 28 * d.sp) % 28);
        g.fillRect(rx, ry + dropY, 1, 2);
      }
      const mistShift = Math.round((t * 4) % 18);
      g.fillStyle = 'rgba(130, 165, 215, 0.14)';
      for (let mx = -mistShift; mx < pxW; mx += 18) {
        g.fillRect(mx, 23 + dropY, 10, 1);
        g.fillRect(mx + 6, 25 + dropY, 8, 1);
      }
    }
  }

  function drawWarpFlashOverlay(cg, pxW, tx, effFlash) {
    if (effFlash <= 0.02) return;
    cg.save();
    cg.globalAlpha = effFlash * 0.72;
    cg.fillStyle = '#D8FAFF';
    cg.fillRect(0, 0, pxW, PX_H);

    cg.globalAlpha = effFlash * 0.95;
    cg.fillStyle = '#FFFFFF';
    const beamH = Math.max(2, Math.round(effFlash * 10));
    cg.fillRect(0, Math.round(PX_H / 2 - beamH / 2), pxW, beamH);

    cg.fillStyle = '#FFE488';
    for (let k = 0; k < 10; k++) {
      const sy = 3 + ((k * 7) % (PX_H - 6));
      const sx = Math.round(tx - 24 + k * 8);
      cg.fillRect(sx, sy, 6 + (k % 5) * 3, 1);
    }
    cg.restore();
  }

  function ensureRenderBuffers(cacheRef, cssW, pxW) {
    if (!cacheRef.current || cacheRef.current.pxW !== pxW) {
      cacheRef.current = buildStageCaches(pxW);
    }
    const cache = cacheRef.current;
    if (!cache.artCanvas) {
      cache.artCanvas = newSceneBuffer();
      cache.artCanvas.width = pxW;
      cache.artCanvas.height = PX_H;
    } else if (cache.artCanvas.width !== pxW) {
      cache.artCanvas.width = pxW;
    }
    if (!cache.compCanvas) {
      cache.compCanvas = newSceneBuffer();
      cache.compCanvas.width = cssW;
      cache.compCanvas.height = 68;
    } else if (cache.compCanvas.width !== cssW) {
      cache.compCanvas.width = cssW;
    }
    return cache;
  }

  function blitCompToDisplay(displayCanvas, compCanvas, cssW, dpr) {
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(68 * dpr);
    if (displayCanvas.width !== targetW || displayCanvas.height !== targetH) {
      displayCanvas.width = targetW;
      displayCanvas.height = targetH;
    }
    const dg = displayCanvas.getContext('2d');
    dg.imageSmoothingEnabled = false;
    dg.clearRect(0, 0, targetW, targetH);
    dg.drawImage(compCanvas, 0, 0, targetW, targetH);
  }

  function drawSpeedLines(g, pxW, t, intensity, inVortex, foreground, reduced) {
    if (intensity <= 0.03) return;
    const baseSpeed = lerp(52, 138, inVortex ? 0.85 : 0.35);
    const colsSpace = ['#FFFFFF', '#8CF2FF', '#A78BFF'];
    const colsVortex = ['#FFFFFF', '#8CF2FF', '#FFD96B'];
    const palette = inVortex ? colsVortex : colsSpace;

    g.save();
    for (let i = 0; i < SPEED_LINES.length; i++) {
      const ln = SPEED_LINES[i];
      if (ln.fg !== foreground) continue;
      const travel = reduced ? 0 : t * baseSpeed * ln.sp;
      const len = Math.round(ln.len * (inVortex ? 1.55 : 1.0) * (0.55 + intensity * 0.5));
      const rx = Math.floor((((ln.x * pxW) - travel) % (pxW + 24) + (pxW + 24)) % (pxW + 24)) - 12;
      g.globalAlpha = intensity * (foreground ? 0.54 : 0.72);
      g.fillStyle = palette[ln.colIdx];
      g.fillRect(rx, ln.y, len, 1);
      if (len >= 9) {
        g.globalAlpha = intensity * (foreground ? 0.24 : 0.32);
        g.fillRect(rx + len, ln.y, 3, 1);
      }
    }
    g.restore();
  }

  function drawRigidTardis(cg, sprite, cxPx, cyPx, angleRad, scaleX, scaleY) {
    cg.save();
    cg.translate(Math.round(cxPx), Math.round(cyPx));
    if (Math.abs(angleRad) > 0.0005) {
      cg.rotate(angleRad);
    }
    cg.imageSmoothingEnabled = false;
    const dw = Math.round(sprite.width * scaleX);
    const dh = Math.round(sprite.height * scaleY);
    cg.drawImage(sprite, Math.round(-dw / 2), Math.round(-dh / 2), dw, dh);
    cg.restore();
  }

  function drawRotatedBowArc(cg, cxPx, cyPx, angleRad, scaleX, scaleY, ghostMix, inVortexCut) {
    if (ghostMix <= 0.2) return;
    cg.save();
    cg.translate(Math.round(cxPx), Math.round(cyPx));
    if (Math.abs(angleRad) > 0.0005) {
      cg.rotate(angleRad);
    }
    cg.scale(scaleX, scaleY);
    cg.globalAlpha = ghostMix * 0.72;
    cg.fillStyle = '#A6F4FF';
    cg.fillRect(7, -7, 1, 14);
    if (inVortexCut) {
      cg.globalAlpha = 0.90;
      cg.fillStyle = '#FFFFFF';
      cg.fillRect(9, -5, 1, 11);
      cg.fillStyle = '#7CEEFF';
      cg.fillRect(8, -8, 1, 3);
      cg.fillRect(8, 6, 1, 3);
      cg.fillStyle = '#FFD068';
      cg.fillRect(7, -10, 1, 2);
      cg.fillRect(7, 9, 1, 2);
    }
    cg.restore();
  }

  function renderMaterializeScene(displayCanvas, state, cache, cssW, pxW) {
    const m = clamp(state.cutscene.progress, 0, 1);
    const t = state.t;
    const reduced = state.reducedMotion;
    const g = cache.artCanvas.getContext('2d');
    g.imageSmoothingEnabled = false;

    const tx = pxW * 0.13;
    const ty = 20.5;
    const drawX = Math.round(tx - SPRITE_TARDIS_UPRIGHT.width / 2);
    const drawY = Math.round(ty - SPRITE_TARDIS_UPRIGHT.height / 2);

    // Phase 1: cut back to empty rainy London street
    drawLondonAtmosphere(g, cache, pxW, 0, t, reduced);

    let tardisAlpha = 0;
    let osc = 0;
    let matU = 0;
    if (m >= 0.11 && m < 0.62) {
      matU = clamp((m - 0.11) / 0.51, 0, 1);
      osc = Math.sin(matU * Math.PI * 5.0);
      tardisAlpha = matU >= 0.92
        ? 1.0
        : clamp(Math.pow(matU, 0.72) * 0.92 + osc * 0.34 * (1 - matU * 0.65), 0.04, 1.0);
    } else if (m >= 0.62) {
      tardisAlpha = 1.0;
    }

    if (tardisAlpha > 0.02) {
      g.save();
      g.globalAlpha = tardisAlpha * 0.26;
      g.fillStyle = '#6AB8FF';
      g.fillRect(drawX, Math.min(PX_H - 1, drawY + 22), 13, 1);
      g.restore();
    }

    // Materialization shimmer bars around the footprint while phasing in
    if (m >= 0.11 && m < 0.60 && !reduced) {
      g.save();
      g.globalAlpha = (1 - matU) * 0.52;
      for (let sx = 0; sx < 13; sx += 2) {
        if (Math.sin(t * 22 + sx * 1.9) > -0.1) {
          g.fillStyle = sx % 4 === 0 ? '#FFE694' : '#7CEEFF';
          g.fillRect(drawX + sx, drawY + 1, 1, 20);
        }
      }
      g.restore();
    }

    const scaleX = cssW / pxW;
    const scaleY = 68 / PX_H;
    const cg = cache.compCanvas.getContext('2d');
    cg.imageSmoothingEnabled = false;
    cg.clearRect(0, 0, cssW, 68);
    cg.drawImage(cache.artCanvas, 0, 0, cssW, 68);

    const cxPx = tx * scaleX;
    const cyPx = ty * scaleY;

    // Ghostly cyan aura on materialization crests
    if (m >= 0.11 && m < 0.60 && osc > 0) {
      cg.save();
      cg.globalAlpha = osc * (1 - matU) * 0.52;
      drawRigidTardis(cg, SPRITE_TARDIS_GHOST_CYAN, cxPx, cyPx, 0, scaleX, scaleY);
      cg.restore();
    }

    if (tardisAlpha > 0.01) {
      cg.save();
      cg.globalAlpha = tardisAlpha;
      drawRigidTardis(cg, SPRITE_TARDIS_UPRIGHT, cxPx, cyPx, 0, scaleX, scaleY);
      cg.restore();
    }

    // Roof lantern pulsing with materialization waves + solid lock-in star flare
    if (m >= 0.11) {
      const solidFlare = m >= 0.55 && m < 0.66 ? 1.0 : 0;
      const beacon = Math.max(solidFlare, m < 0.62 ? Math.max(0.35, osc) * tardisAlpha : 0.68);
      cg.save();
      cg.scale(scaleX, scaleY);
      const lx = Math.round(tx);
      const ly = Math.round(ty - 10.5);
      cg.globalAlpha = clamp(beacon, 0.25, 1);
      cg.fillStyle = '#FFFFFF';
      cg.fillRect(lx, ly, 1, 1);
      if (solidFlare > 0.5 || (m < 0.62 && osc > 0.35)) {
        cg.fillStyle = '#96E8FF';
        const arm = solidFlare > 0.5 ? 2 : 1;
        cg.fillRect(lx - arm, ly, arm * 2 + 1, 1);
        cg.fillRect(lx, ly - arm, 1, arm * 2 + 1);
      }
      cg.restore();
    }

    // Phase 3: door swings open, 10th Doctor walks OUT facing right, door shuts & Doctor leans
    if (m >= 0.60) {
      const doorOpen = smoothstep(0.60, 0.69, m) * (1 - smoothstep(0.88, 0.96, m));
      cg.save();
      cg.scale(scaleX, scaleY);
      cg.imageSmoothingEnabled = false;

      if (doorOpen > 0.04) {
        drawTardisOpenDoor(cg, drawX, drawY, doorOpen, Math.min(PX_H - 2, drawY + 21));
      }

      if (m >= 0.66) {
        const docY = drawY + 5;
        let docX = drawX + 12;
        let docSprite = SPRITE_DOCTOR_10;
        let clipDoor = false;
        if (m < 0.91) {
          const exitProg = smoothstep(0.66, 0.91, m);
          docX = Math.round(lerp(drawX + 6, drawX + 13, exitProg));
          docSprite = WALK_CYCLE_R[Math.floor(exitProg * 7) % 4];
          clipDoor = exitProg < 0.55;
        } else {
          const settleProg = smoothstep(0.91, 1.0, m);
          docX = Math.round(lerp(drawX + 13, drawX + 12, settleProg));
        }
        cg.save();
        if (clipDoor) {
          cg.beginPath();
          cg.rect(drawX + 7, drawY - 1, pxW - (drawX + 7), 24);
          cg.clip();
        }
        cg.drawImage(docSprite, docX, docY);
        cg.restore();
      }
      cg.restore();
    }

    // Initial cut flash entering London
    if (m < 0.11) {
      const cutFlash = 1 - m / 0.11;
      cg.save();
      cg.scale(scaleX, scaleY);
      drawWarpFlashOverlay(cg, pxW, tx, cutFlash * 0.85);
      cg.restore();
    }

    blitCompToDisplay(displayCanvas, cache.compCanvas, cssW, state.pixelRatio);
  }

  function renderApproachEarthScene(displayCanvas, state, cache, cssW, pxW) {
    const a = clamp(state.cutscene.progress, 0, 1);
    const s = smoothstep(0.0, 1.0, a);
    const t = state.t;
    const reduced = state.reducedMotion;
    const g = cache.artCanvas.getContext('2d');
    g.imageSmoothingEnabled = false;

    const maxVisualP = state.maxVisualP !== undefined ? state.maxVisualP : 1;
    const tx = pxW * lerp(
      getTardisTrackNorm(STOPS[2], maxVisualP),
      getTardisTrackNorm(STOPS[1], maxVisualP),
      smoothstep(0.08, 0.96, a)
    );
    let ty = lerp(16.5, 13.8, s);
    if (!reduced) {
      ty += Math.sin(t * 3.0) * lerp(0.55, 1.0, s);
    }
    const angleDeg = lerp(32, 14, s) + (!reduced ? Math.sin(t * 2.0) * lerp(1.2, 2.2, s) : 0);
    const angleRad = (angleDeg * Math.PI) / 180;

    // Orbital base sky + Deep Space scrolling leftward off-screen
    g.fillStyle = '#050A18';
    g.fillRect(0, 0, pxW, PX_H);

    const spaceAlpha = 1 - smoothstep(0.18, 0.78, a);
    if (spaceAlpha > 0.02) {
      g.save();
      g.globalAlpha = spaceAlpha;
      const slideX = -Math.round(smoothstep(0.0, 0.82, a) * pxW * 0.42);
      g.drawImage(cache.spaceBg, slideX, 0);
      g.restore();
    }

    // Stars stream right-to-left (continued forward flight) and decelerate smoothly
    const starSpeed = lerp(42, 0, smoothstep(0.0, 0.88, a));
    for (let i = 0; i < STARS.length; i++) {
      const st = STARS[i];
      const travel = reduced ? 0 : t * starSpeed * st.z;
      const sx = Math.floor((((st.x * pxW) - travel) % pxW + pxW) % pxW);
      const sy = Math.round(st.y * (PX_H - 2));
      const tw = reduced ? 0.78 : 0.48 + 0.52 * Math.sin(t * 2.6 + st.ph);
      g.globalAlpha = tw;
      g.fillStyle = st.col;
      g.fillRect(sx, sy, !reduced && starSpeed > 18 && st.z > 1.05 ? 2 : 1, 1);
    }
    g.globalAlpha = 1;

    // Earth approaches from ahead-right and grows smoothly to full orbital horizon
    const earthR0 = Math.max(130, pxW * 1.15);
    const r = 4.5 * Math.pow(earthR0 / 4.5, s);
    const topY = lerp(22.0, PX_H - 13, s);
    const cx = lerp(pxW * 1.08, pxW * 0.50, Math.pow(s, 0.82));
    drawDynamicEarth(g, pxW, cx, topY, r, earthR0, t, reduced);

    if (s > 0.76) {
      g.save();
      g.globalAlpha = smoothstep(0.76, 1.0, s) * 0.85;
      for (let i = 0; i < ORBIT_CLOUDS.length; i++) {
        const cl = ORBIT_CLOUDS[i];
        const drift = reduced ? 0 : t * cl.sp * 4.5;
        const clx = Math.floor(((cl.x * pxW + drift) % (pxW + 16)) - 8);
        const cly = Math.round(cl.y * PX_H);
        if (cly < PX_H - 1) {
          g.fillStyle = '#FFFFFF';
          g.fillRect(clx, cly, cl.w, 1);
          g.fillStyle = '#C9E7FF';
          g.fillRect(clx + 1, cly + 1, Math.max(2, cl.w - 3), 1);
        }
      }
      g.restore();
    }

    const speedIntensity = lerp(0.75, 0.0, smoothstep(0.10, 0.84, a));
    drawSpeedLines(g, pxW, t, speedIntensity, false, false, reduced);

    // Fading Artron energy stream
    const wakeStrength = 1 - smoothstep(0.15, 0.72, a);
    if (wakeStrength > 0.03) {
      const wakeLen = Math.round(lerp(28, 8, a));
      g.save();
      for (let k = 0; k < wakeLen; k++) {
        const u = k / wakeLen;
        const wx = Math.round(tx - 6 - k);
        if (wx < 0) break;
        const wave = reduced ? 0 : Math.sin(t * 14 - k * 0.45) * (0.9 + u * 1.4);
        g.globalAlpha = wakeStrength * (1 - u) * 0.82;
        g.fillStyle = u < 0.42 ? '#8AF4FF' : '#3C88FF';
        const yMid = Math.round(ty + wave);
        if (yMid >= 0 && yMid < PX_H) g.fillRect(wx, yMid, 1, 1);
      }
      g.restore();
    }

    const scaleX = cssW / pxW;
    const scaleY = 68 / PX_H;
    const cg = cache.compCanvas.getContext('2d');
    cg.imageSmoothingEnabled = false;
    cg.clearRect(0, 0, cssW, 68);
    cg.drawImage(cache.artCanvas, 0, 0, cssW, 68);

    const cxPx = tx * scaleX;
    const cyPx = ty * scaleY;
    const ghostMix = 1 - smoothstep(0.15, 0.72, a);
    if (ghostMix > 0.05) {
      cg.save();
      cg.globalAlpha = ghostMix * 0.22;
      drawRigidTardis(cg, SPRITE_TARDIS_GHOST_CYAN, (tx - 3.5) * scaleX, cyPx, angleRad, scaleX, scaleY);
      cg.restore();
    }

    drawRigidTardis(cg, SPRITE_TARDIS_UPRIGHT, cxPx, cyPx, angleRad, scaleX, scaleY);
    drawRotatedBowArc(cg, cxPx, cyPx, angleRad, scaleX, scaleY, ghostMix, false);

    // Rotated roof beacon
    cg.save();
    cg.scale(scaleX, scaleY);
    cg.fillStyle = '#FFFFFF';
    cg.globalAlpha = 0.75;
    cg.fillRect(Math.round(tx + Math.sin(angleRad) * 10.5), Math.round(ty - Math.cos(angleRad) * 10.5), 1, 1);
    drawSpeedLines(cg, pxW, t, speedIntensity, false, true, reduced);
    cg.restore();

    blitCompToDisplay(displayCanvas, cache.compCanvas, cssW, state.pixelRatio);
  }

  function renderFlashCutScene(displayCanvas, state, cache, cssW, pxW) {
    const c = clamp(state.cutscene.progress, 0, 1);
    const toIdx = state.cutscene.toIdx;
    const inTarget = c >= 0.32;
    const sceneP = inTarget ? STOPS[toIdx] : STOPS[3];
    const txOffset = inTarget ? -lerp(7, 0, smoothstep(0.32, 0.92, c)) : 0;
    const flashAmt = inTarget
      ? Math.pow(1 - smoothstep(0.32, 0.76, c), 1.4)
      : smoothstep(0.0, 0.32, c);

    // Delegate base scene cleanly at target stop with arrival offset + flash overlay
    renderTardisScene(displayCanvas, {
      p: sceneP,
      t: state.t,
      hovering: state.hovering,
      reducedMotion: state.reducedMotion,
      maxVisualP: state.maxVisualP,
      txOffset,
      cssWidth: cssW,
      pixelRatio: state.pixelRatio,
      overrideFlash: flashAmt,
      cutscene: null,
    }, { current: cache });
  }

  function renderLondonPower(display, state, cache, cssW, pxW) {
    const sequence = state.cutscene;
    const lit = sequence ? sequence.powerOn ? sequence.progress : 1 - sequence.progress : 0;
    const { lampX, benX, phoneX } = cache.londonLights;
    const g = cache.artCanvas.getContext('2d');
    g.globalAlpha = 1;
    g.drawImage(cache.blackoutBg, 0, 0);
    g.globalAlpha = smoothstep(0.12, 0.8, lit);
    g.drawImage(cache.londonBg, 0, 0);
    const lightPatch = (x, y, width, height, amount) => {
      if (amount <= 0) return;
      g.globalAlpha = amount;
      g.drawImage(cache.londonBg, x, y, width, height, x, y, width, height);
    };
    lightPatch(lampX - 4, 11, 9, 7, smoothstep(0.04, 0.22, lit));
    lightPatch(lampX - 4, 28, 9, 5, smoothstep(0.09, 0.26, lit));
    lightPatch(benX - 2, 12, 5, 5, smoothstep(0.22, 0.38, lit));
    lightPatch(phoneX, 20, 4, 7, smoothstep(0.35, 0.50, lit));
    g.globalAlpha = 1;

    const scaleX = cssW / pxW;
    const scaleY = 68 / PX_H;
    const displayContext = cache.compCanvas.getContext('2d');
    displayContext.imageSmoothingEnabled = false;
    displayContext.clearRect(0, 0, cssW, 68);
    displayContext.drawImage(cache.artCanvas, 0, 0, cssW, 68);
    const tx = pxW * 0.13;
    const ty = 20.5;
    const x = Math.round(tx - SPRITE_TARDIS_UPRIGHT.width / 2);
    const y = Math.round(ty - SPRITE_TARDIS_UPRIGHT.height / 2);
    drawRigidTardis(displayContext, SPRITE_TARDIS_BLACKOUT, tx * scaleX, ty * scaleY, 0, scaleX, scaleY);
    displayContext.save();
    displayContext.globalAlpha = smoothstep(0.42, 0.71, lit);
    drawRigidTardis(displayContext, SPRITE_TARDIS_UPRIGHT, tx * scaleX, ty * scaleY, 0, scaleX, scaleY);
    displayContext.restore();

    if (lit > 0.42) {
      displayContext.save();
      displayContext.scale(scaleX, scaleY);
      const charge = smoothstep(0.42, 0.68, lit);
      const pulse = sequence?.powerOn && lit < 0.67 ? 0.62 + Math.sin(lit * 145) * 0.32 : 0.7;
      displayContext.globalAlpha = charge * pulse;
      pxRect(displayContext, tx, ty - 10.5, 1, 1, '#c5f2ff');
      pxRect(displayContext, x, Math.min(PX_H - 1, y + 22), 13, 1, '#6ab8ff');
      displayContext.globalAlpha = 1;
      const door = smoothstep(0.62, 0.78, lit) * (1 - smoothstep(0.89, 1, lit));
      drawTardisOpenDoor(displayContext, x, y, door, Math.min(PX_H - 2, y + 21));
      const step = smoothstep(0.70, 0.96, lit);
      if (step > 0) {
        displayContext.globalAlpha = smoothstep(0, 0.3, step);
        const doctor = step >= 0.96 ? SPRITE_DOCTOR_10
          : (sequence?.powerOn ? WALK_CYCLE_R : WALK_CYCLE_L)[Math.min(3, Math.floor(step * 4))];
        displayContext.drawImage(doctor, x + Math.round(5 + step * 7), y + 5);
      }
      displayContext.restore();
    }
    blitCompToDisplay(display, cache.compCanvas, cssW, state.pixelRatio);
  }

  function renderTardisScene(displayCanvas, state, cacheRef) {
    ensureSpritesBaked();
    const cssW = state.cssWidth ?? 380;
    if (cssW <= 0) return;

    const pxW = Math.max(120, Math.round(cssW / 2));
    const cache = ensureRenderBuffers(cacheRef, cssW, pxW);

    if (state.cutscene?.type === 'power' || (!state.cutscene && state.p < 0)) {
      renderLondonPower(displayCanvas, state, cache, cssW, pxW);
      return;
    }

    if (state.cutscene) {
      if (state.cutscene.type === 'materialize') {
        renderMaterializeScene(displayCanvas, state, cache, cssW, pxW);
        return;
      }
      if (state.cutscene.type === 'approachEarth') {
        renderApproachEarthScene(displayCanvas, state, cache, cssW, pxW);
        return;
      }
      if (state.cutscene.type === 'flashCut') {
        renderFlashCutScene(displayCanvas, state, cache, cssW, pxW);
        return;
      }
    }

    const g = cache.artCanvas.getContext('2d');
    g.imageSmoothingEnabled = false;

    const p = clamp(state.p, 0, 1);
    const t = state.t;
    const reduced = state.reducedMotion;

    const s1 = STOPS[1];
    const s2 = STOPS[2];
    const u01 = clamp(p / s1, 0, 1);
    const u12 = clamp((p - s1) / (s2 - s1), 0, 1);
    const u23 = clamp((p - s2) / (1 - s2), 0, 1);

    // Choreographed stage blend weights
    const wLondon = 1 - smoothstep(0.68, 0.90, u01);
    const wCloud = Math.sin(smoothstep(0.48, 0.92, u01) * Math.PI);
    const wEarth = smoothstep(0.54, 0.86, u01) * (1 - smoothstep(0.76, 0.98, u12));
    const inVortexCut = p >= s2 && u23 >= 0.52;
    const wSpace = !inVortexCut ? smoothstep(0.14, 0.72, u12) : 0;
    const wVortex = inVortexCut ? 1 : 0;
    const flashAmt = state.overrideFlash !== undefined
      ? state.overrideFlash
      : (p >= s2 ? Math.pow(Math.max(0, 1 - Math.abs(u23 - 0.52) / 0.24), 1.5) : 0);

    // TARDIS position on shared horizontal track & choreographed vertical flight path
    const maxVisualP = state.maxVisualP !== undefined ? state.maxVisualP : 1;
    const trackX = pxW * getTardisTrackNorm(p, maxVisualP) + (state.txOffset || 0);
    let tx = trackX;
    let ty = 20.5;
    if (p <= s1) {
      if (u01 <= 0.46) {
        ty = 20.5; // parked firmly on London cobblestones during Doctor boarding
      } else {
        const up = smoothstep(0.46, 0.78, u01);
        const settle = smoothstep(0.76, 1.0, u01);
        ty = lerp(20.5, 12.0, up);
        ty = lerp(ty, 13.8, settle);
      }
    } else if (p <= s2) {
      ty = lerp(13.8, 16.5, smoothstep(0.08, 0.78, u12));
    } else {
      ty = 16.5;
    }

    // Rigid-body clockwise rotation angle (exact 90-degree corners preserved, zero parallelogram skew)
    let angleDeg = 0;
    if (p <= s1) {
      if (u01 > 0.46) {
        const liftAng = smoothstep(0.46, 0.96, u01) * 14;
        const floatRock = !reduced ? Math.sin(t * 1.6) * 2.4 * smoothstep(0.75, 1.0, u01) : 0;
        angleDeg = liftAng + floatRock;
      }
    } else if (p <= s2) {
      const baseBank = lerp(14, 32, smoothstep(0.10, 0.85, u12));
      const floatRock = !reduced ? Math.sin(t * 1.6) * 2.4 * (1 - smoothstep(0.25, 0.75, u12)) : 0;
      const cruiseSway = !reduced ? Math.sin(t * 2.6) * 1.2 * smoothstep(0.35, 0.90, u12) : 0;
      angleDeg = baseBank + floatRock + cruiseSway;
    } else if (!inVortexCut) {
      angleDeg = 32 + (!reduced ? Math.sin(t * 2.8) * 1.2 : 0);
    } else {
      // Moderate ("一般") Time Vortex rigid-body roll & turbulence
      angleDeg = 36 + (!reduced ? (Math.sin(t * 6.4) * 2.4 + Math.cos(t * 10.2) * 0.9) : 0);
    }
    const angleRad = (angleDeg * Math.PI) / 180;

    // Position bob / turbulence
    if (!reduced) {
      if (p <= s1) {
        if (u01 > 0.46) {
          const hover = smoothstep(0.75, 1.0, u01);
          ty += Math.sin(t * 2.3) * 1.0 * hover;
          tx += Math.cos(t * 1.4) * 0.35 * hover;
        }
      } else if (p <= s2) {
        const bobMix = 1 - smoothstep(0.25, 0.75, u12);
        const glideMix = smoothstep(0.35, 0.9, u12);
        ty += Math.sin(t * 2.3) * 1.0 * bobMix + Math.sin(t * 3.2) * 0.55 * glideMix;
      } else if (!inVortexCut) {
        ty += Math.sin(t * 3.6) * 0.65;
      } else {
        ty += Math.sin(t * 7.2) * 0.8 + Math.sin(t * 11.8) * 0.35;
        tx += Math.cos(t * 5.6) * 0.5;
      }
    }

    const drawX = Math.round(tx - SPRITE_TARDIS_UPRIGHT.width / 2);
    const drawY = Math.round(ty - SPRITE_TARDIS_UPRIGHT.height / 2);

    g.fillStyle = '#050814';
    g.fillRect(0, 0, pxW, PX_H);

    // --- LAYER 1: LONDON ---
    const dropY = Math.round(smoothstep(0.46, 0.84, u01) * 34);
    const doorOpen = p <= s1 ? smoothstep(0.03, 0.16, u01) * (1 - smoothstep(0.34, 0.45, u01)) : 0;

    if (wLondon > 0.01) {
      g.save();
      g.globalAlpha = wLondon;
      drawLondonAtmosphere(g, cache, pxW, dropY, t, reduced);
      g.restore();
    }

    // --- LAYER 2: EARTH ORBIT & RECEDING ROUND EARTH (中 -> 高) ---
    if (wEarth > 0.01) {
      g.save();
      g.globalAlpha = wEarth;
      const earthRise = Math.round((1 - smoothstep(0.62, 1.0, u01)) * 22);
      if (u12 <= 0.01) {
        g.drawImage(cache.earthBg, 0, earthRise);
      } else {
        g.fillStyle = '#050A18';
        g.fillRect(0, 0, pxW, PX_H);
        drawRecedingEarth(g, pxW, u12, t, reduced);
      }

      for (let i = 0; i < 36; i++) {
        const s = STARS[i];
        const sx = Math.round(s.x * pxW);
        const sy = Math.round(s.y * 20);
        const tw = reduced ? 0.75 : 0.45 + 0.55 * Math.sin(t * 2.2 + s.ph);
        g.globalAlpha = wEarth * tw;
        g.fillStyle = s.col;
        g.fillRect(sx, sy, 1, 1);
      }

      if (u12 <= 0.16) {
        g.globalAlpha = wEarth * (1 - u12 / 0.16) * 0.85;
        for (let i = 0; i < ORBIT_CLOUDS.length; i++) {
          const cl = ORBIT_CLOUDS[i];
          const drift = reduced ? 0 : t * cl.sp * 4.5;
          const cx = Math.floor(((cl.x * pxW + drift) % (pxW + 16)) - 8);
          const cy = Math.round(cl.y * PX_H) + earthRise;
          if (cy < PX_H - 1) {
            g.fillStyle = '#FFFFFF';
            g.fillRect(cx, cy, cl.w, 1);
            g.fillStyle = '#C9E7FF';
            g.fillRect(cx + 1, cy + 1, Math.max(2, cl.w - 3), 1);
          }
        }
      }
      g.restore();
    }

    // --- LAYER 3: DEEP SPACE SLIDING IN FROM RIGHT ---
    if (wSpace > 0.01) {
      g.save();
      g.globalAlpha = wSpace;
      const slideX = Math.round((1 - smoothstep(0.18, 0.92, u12)) * pxW * 0.38);
      g.drawImage(cache.spaceBg, slideX, 0);

      const warpBoost = p >= s2 ? smoothstep(0.05, 0.52, u23) * 65 : 0;
      const speedMult = 12 + smoothstep(0.1, 1.0, u12) * 32 + warpBoost;
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const travel = reduced ? 0 : t * speedMult * s.z;
        const sx = Math.floor((((s.x * pxW) - travel) % pxW + pxW) % pxW);
        const sy = Math.round(s.y * (PX_H - 2));
        const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(t * 3.1 + s.ph);
        g.globalAlpha = wSpace * tw;
        g.fillStyle = s.col;
        const streak = !reduced ? (warpBoost > 15 ? 4 : (s.z > 1.05 ? 2 : 1)) : 1;
        g.fillRect(sx, sy, streak, 1);
      }

      if (p >= s2 && u23 > 0.12 && u23 < 0.52) {
        const charge = smoothstep(0.12, 0.52, u23);
        g.globalAlpha = charge * 0.55;
        g.fillStyle = '#7CEEFF';
        g.fillRect(Math.round(pxW * 0.92), 6, 3, PX_H - 12);
        g.fillStyle = '#FFFFFF';
        g.fillRect(Math.round(pxW * 0.94), 10, 2, PX_H - 20);
      }
      g.restore();
    }

    // --- LAYER 4: 10TH DOCTOR DEEP BLUE + ORANGE TIME VORTEX ---
    if (wVortex > 0.01) {
      renderTimeVortexLayer(cache, reduced ? 0.6 : t, wVortex);
      g.drawImage(cache.vortexCanvas, 0, 0);
    }

    // --- STRATOSPHERE CLOUD SWEEP DURING LIFTOFF (低 <-> 中) ---
    if (wCloud > 0.04) {
      g.save();
      for (let i = 0; i < STRATO_CLOUDS.length; i++) {
        const cl = STRATO_CLOUDS[i];
        const fallY = ((u01 - 0.46) / 0.54) * 42 * cl.sp + cl.y * PX_H;
        const cy = Math.floor(((fallY % (PX_H + 8)) + (PX_H + 8)) % (PX_H + 8)) - 4;
        const cx = Math.round(cl.x * pxW - cl.w * 0.5);
        g.globalAlpha = wCloud * (i % 2 === 0 ? 0.72 : 0.46);
        g.fillStyle = i % 3 === 0 ? '#DCEEFF' : '#8EB8E8';
        g.fillRect(cx, cy, cl.w, cl.h);
        g.fillStyle = '#FFFFFF';
        g.fillRect(cx + 2, cy, Math.max(2, cl.w - 5), 1);
      }
      g.restore();
    }

    // --- BACKGROUND SPEED LINES (高 & 超高) ---
    const speedIntensity = inVortexCut
      ? 1.0
      : (p >= s2 ? smoothstep(0.0, 0.5, u23) * 0.4 + 0.68 : smoothstep(0.35, 0.92, u12) * 0.75);
    drawSpeedLines(g, pxW, t, speedIntensity, inVortexCut, false, reduced);

    // --- HORIZONTAL ARTRON STREAM ---
    const wakeStrength = inVortexCut ? 1.0 : smoothstep(0.28, 0.85, u12);
    if (wakeStrength > 0.02) {
      const wakeLen = Math.round(lerp(16, 40, inVortexCut ? 1.0 : u12));
      g.save();
      for (let k = 0; k < wakeLen; k++) {
        const u = k / wakeLen;
        const wx = Math.round(tx - 6 - k);
        if (wx < 0) break;
        const wave = reduced ? 0 : Math.sin(t * 14 - k * 0.45) * (0.9 + u * 1.6);
        g.globalAlpha = wakeStrength * (1 - u) * 0.85;
        const col = (k + (reduced ? 0 : Math.floor(t * 18))) % 5 === 0
          ? '#FFE07A'
          : (u < 0.42 ? '#8AF4FF' : '#3C88FF');
        const yMid = Math.round(ty + wave);
        const yTop = Math.round(ty - 6 + wave * 0.7);
        const yBot = Math.round(ty + 7 - wave * 0.7);
        g.fillStyle = col;
        if (yMid >= 0 && yMid < PX_H) g.fillRect(wx, yMid, 1, 1);
        if (k % 2 === 0 && yTop >= 0 && yTop < PX_H) g.fillRect(wx, yTop, 1, 1);
        if (k % 2 === 1 && yBot >= 0 && yBot < PX_H) {
          g.fillStyle = inVortexCut ? '#FF9838' : '#7E64FF';
          g.fillRect(wx, yBot, 1, 1);
        }
      }
      g.restore();
    }

    // --- LIFTOFF IGNITION SPARKS UNDER PLINTH (低 -> 中) ---
    const igniteGlow = p <= s1 ? Math.sin(smoothstep(0.38, 0.58, u01) * Math.PI) : 0;
    if (igniteGlow > 0.05 && !reduced) {
      g.save();
      g.globalAlpha = igniteGlow * 0.75;
      for (let sx = -5; sx <= 5; sx += 2) {
        const sy = Math.round(drawY + 21 + ((t * 16 + Math.abs(sx)) % 4));
        if (sy < PX_H) {
          g.fillStyle = sx % 4 === 0 ? '#FFE694' : '#7CEEFF';
          g.fillRect(Math.round(tx + sx), sy, 1, 2);
        }
      }
      g.restore();
    }

    if (wLondon > 0.2) {
      g.save();
      g.globalAlpha = wLondon * 0.26;
      g.fillStyle = '#6AB8FF';
      g.fillRect(drawX, Math.min(PX_H - 1, drawY + 22), 13, 1);
      g.restore();
    }

    // --- COMPOSITE ON 68px PIXEL-CRISP CANVAS FOR RIGID-BODY ROTATION ---
    const scaleX = cssW / pxW;
    const scaleY = 68 / PX_H;
    const cg = cache.compCanvas.getContext('2d');
    cg.imageSmoothingEnabled = false;
    cg.clearRect(0, 0, cssW, 68);
    cg.drawImage(cache.artCanvas, 0, 0, cssW, 68);

    const cxPx = tx * scaleX;
    const cyPx = ty * scaleY;

    // Rotated rigid-body ghost afterimages
    const ghostMix = inVortexCut ? 1.0 : smoothstep(0.45, 0.95, u12);
    if (ghostMix > 0.05) {
      cg.save();
      cg.globalAlpha = ghostMix * (inVortexCut ? 0.30 : 0.22);
      drawRigidTardis(cg, SPRITE_TARDIS_GHOST_CYAN, (tx - 3.5) * scaleX, cyPx, angleRad, scaleX, scaleY);
      if (inVortexCut) {
        cg.globalAlpha = 0.18;
        drawRigidTardis(cg, SPRITE_TARDIS_GHOST_AMBER, (tx - 7.0) * scaleX, cyPx, angleRad, scaleX, scaleY);
      }
      cg.restore();
    }

    // Rigid-body rotated TARDIS (90-degree corners intact, never parallelogram-skewed)
    drawRigidTardis(cg, SPRITE_TARDIS_UPRIGHT, cxPx, cyPx, angleRad, scaleX, scaleY);

    // Open doorway + 10th Doctor boarding (only active while parked in London at 0 deg)
    if (doorOpen > 0.04 || (wLondon > 0.01 && u01 < 0.37)) {
      cg.save();
      cg.scale(scaleX, scaleY);
      cg.imageSmoothingEnabled = false;

      if (doorOpen > 0.04) {
        drawTardisOpenDoor(cg, drawX, drawY, doorOpen, Math.min(PX_H - 2, drawY + 21));
      }

      if (wLondon > 0.01 && u01 < 0.37) {
        const walkProg = smoothstep(0.02, 0.36, u01);
        const docY = drawY + 5;
        let docSprite = SPRITE_DOCTOR_10;
        let docX = drawX + 12;
        if (walkProg > 0.01) {
          const stepOut = smoothstep(0.0, 0.28, walkProg);
          const stepIn = smoothstep(0.28, 1.0, walkProg);
          docX = Math.round(lerp(drawX + 12, drawX + 13, stepOut) - stepIn * 9);
          docSprite = WALK_CYCLE_L[Math.floor(walkProg * 9) % 4];
        }

        cg.save();
        cg.globalAlpha = wLondon * (1 - smoothstep(0.28, 0.36, u01));
        if (walkProg > 0.36) {
          cg.beginPath();
          cg.rect(drawX + 7, drawY - 1, pxW - (drawX + 7), 24);
          cg.clip();
        }
        cg.drawImage(docSprite, docX, docY);

        if (!reduced && walkProg <= 0.02) {
          if (Math.sin(t * 2.8) > 0.45) {
            pxRect(cg, docX + 1, docY + 11, 1, 2, '#B07B45');
          }
          if (Math.sin(t * 1.1) > 0.96) {
            pxRect(cg, docX + 4, docY + 2, 1, 1, '#F3C59F');
          }
          if (state.hovering) {
            const sonicAlpha = 0.4 + 0.45 * Math.sin(t * 6.0);
            cg.fillStyle = `rgba(92, 238, 255, ${sonicAlpha.toFixed(2)})`;
            cg.fillRect(docX + 5, docY + 8, 1, 1);
          }
        }
        cg.restore();
      }
      cg.restore();
    }

    // Rotated leading-edge slipstream & curved bow-shock arc
    drawRotatedBowArc(cg, cxPx, cyPx, angleRad, scaleX, scaleY, ghostMix, inVortexCut);

    // Exact rotated roof lantern beacon + 4-point star flare
    const lampArtX = tx + Math.sin(angleRad) * 10.5;
    const lampArtY = ty - Math.cos(angleRad) * 10.5;
    const pulse = reduced ? 0.75 : 0.45 + 0.55 * Math.sin(t * (inVortexCut ? 9.5 : 3.6));
    const beaconBoost = Math.max(pulse, igniteGlow);
    if (beaconBoost > 0.35) {
      cg.save();
      cg.scale(scaleX, scaleY);
      const lx = Math.round(lampArtX);
      const ly = Math.round(lampArtY);
      cg.globalAlpha = clamp(beaconBoost * (0.48 + p * 0.52), 0.3, 1);
      cg.fillStyle = '#FFFFFF';
      cg.fillRect(lx, ly, 1, 1);
      if (inVortexCut || igniteGlow > 0.35 || beaconBoost > 0.78) {
        cg.fillStyle = inVortexCut ? '#FFF3B0' : '#96E8FF';
        const arm = (inVortexCut && beaconBoost > 0.7) || igniteGlow > 0.5 ? 2 : 1;
        cg.fillRect(lx - arm, ly, arm * 2 + 1, 1);
        cg.fillRect(lx, ly - arm, 1, arm * 2 + 1);
      }
      cg.restore();
    }

    // Foreground speed lines & warp flash overlay
    cg.save();
    cg.scale(scaleX, scaleY);
    drawSpeedLines(cg, pxW, t, speedIntensity, inVortexCut, true, reduced);
    drawWarpFlashOverlay(cg, pxW, tx, reduced ? Math.min(0.25, flashAmt) : flashAmt);
    cg.restore();

    blitCompToDisplay(displayCanvas, cache.compCanvas, cssW, state.pixelRatio);
  }
