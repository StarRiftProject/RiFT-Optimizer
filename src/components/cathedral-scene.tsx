// The cathedral. Pure SVG so it scales to any window and costs nothing to draw.
//
// Built in layers, back to front: sky and stone, the arch, the angel, the
// stained glass, the light shafts, the floor, then the candles in front. Every
// animated layer opts out under prefers-reduced-motion in app.css.

export function CathedralScene({ animate = true }: { animate?: boolean }) {
  const still = animate ? '' : ' rift-scene--still'
  return (
    <div className={`rift-scene${still}`} aria-hidden="true">
      <svg
        className="cathedral-art"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <defs>
          {/* the whole hall sits under one very dark wash so the candles read */}
          <radialGradient id="cath-void" cx="50%" cy="38%" r="72%">
            <stop offset="0" stopColor="#1b1a1e" />
            <stop offset=".34" stopColor="#0e0d10" />
            <stop offset=".68" stopColor="#070607" />
            <stop offset="1" stopColor="#030304" />
          </radialGradient>

          {/* stone columns catch a little light on their inner faces */}
          <linearGradient id="cath-stone" x1="0" x2="1">
            <stop offset="0" stopColor="#0a090b" />
            <stop offset=".42" stopColor="#26242a" />
            <stop offset=".62" stopColor="#171519" />
            <stop offset="1" stopColor="#080709" />
          </linearGradient>

          <linearGradient id="cath-stone-deep" x1="0" x2="1">
            <stop offset="0" stopColor="#060608" />
            <stop offset=".5" stopColor="#1b191e" />
            <stop offset="1" stopColor="#050506" />
          </linearGradient>

          {/* glass is the only real colour in the scene */}
          <linearGradient id="cath-glass" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#dfe7ef" stopOpacity=".34" />
            <stop offset=".45" stopColor="#9aa8b8" stopOpacity=".16" />
            <stop offset="1" stopColor="#4a5566" stopOpacity=".05" />
          </linearGradient>

          {/* the shafts widen and fade as they fall */}
          <linearGradient id="cath-shaft" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#e8eef6" stopOpacity=".3" />
            <stop offset=".42" stopColor="#cfd8e4" stopOpacity=".13" />
            <stop offset="1" stopColor="#b9c4d2" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="cath-floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#15141a" stopOpacity=".9" />
            <stop offset=".45" stopColor="#0a0a0d" stopOpacity=".95" />
            <stop offset="1" stopColor="#040406" />
          </linearGradient>

          {/* candle flame: white core, warm halo, no saturated colour */}
          <radialGradient id="cath-flame" cx="50%" cy="62%" r="52%">
            <stop offset="0" stopColor="#fff8ec" />
            <stop offset=".38" stopColor="#f3d9a8" stopOpacity=".8" />
            <stop offset="1" stopColor="#c99a52" stopOpacity="0" />
          </radialGradient>

          <filter id="cath-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id="cath-softer" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter id="cath-bloom" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="3.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width="1600" height="900" fill="url(#cath-void)" />

        {/* ---- back wall: the arcade of arches down both sides ---- */}
        <g className="cath-arcade">
          <path d="M0 900V300h92v600z" fill="url(#cath-stone-deep)" />
          <path d="M1600 900V300h-92v600z" fill="url(#cath-stone-deep)" />

          {/*
            a pointed gothic arch, built from two arcs meeting at a point.
            repeated at three depths so the hall reads as receding.
          */}
          {[
            { x: 132, s: 1, o: 0.5 },
            { x: 268, s: 0.78, o: 0.34 },
            { x: 382, s: 0.6, o: 0.22 },
          ].map((a, i) => (
            <path
              key={`l${i}`}
              d={`M${a.x} 900V${430 - a.s * 40}Q${a.x + 62 * a.s} ${300 - a.s * 40} ${a.x + 124 * a.s} ${430 - a.s * 40}V900z`}
              fill="url(#cath-stone)"
              opacity={a.o}
            />
          ))}
          {[
            { x: 1344, s: 1, o: 0.5 },
            { x: 1208, s: 0.78, o: 0.34 },
            { x: 1094, s: 0.6, o: 0.22 },
          ].map((a, i) => (
            <path
              key={`r${i}`}
              d={`M${a.x} 900V${430 - a.s * 40}Q${a.x - 62 * a.s} ${300 - a.s * 40} ${a.x - 124 * a.s} ${430 - a.s * 40}V900z`}
              fill="url(#cath-stone)"
              opacity={a.o}
            />
          ))}

          {/* the vault ribs overhead */}
          <g fill="none" stroke="#4a4650" strokeOpacity=".26" strokeWidth="2.4">
            <path d="M132 300Q800 40 1468 300" />
            <path d="M268 340Q800 120 1332 340" />
            <path d="M382 372Q800 200 1218 372" />
            <path d="M800 44v300" strokeOpacity=".14" />
          </g>
        </g>

        {/* ---- the nave window, high and centred, where all the light starts ---- */}
        <g className="cath-glass-group">
          <path
            d="M800 62q150 132 150 300H650q0-168 150-300z"
            fill="url(#cath-glass)"
            stroke="#6d7787"
            strokeOpacity=".3"
            strokeWidth="2"
          />
          {/* tracery */}
          <g fill="none" stroke="#8b95a5" strokeOpacity=".26" strokeWidth="1.6">
            <path d="M800 62v300M650 362h300M650 250h300M650 160h300" />
            <circle cx="800" cy="200" r="34" />
            <circle cx="724" cy="300" r="22" />
            <circle cx="876" cy="300" r="22" />
          </g>
        </g>

        {/* ---- light shafts falling from the window to the floor ---- */}
        <g className="cath-shafts">
          <path d="M660 120 640 900h150l-30-780z" fill="url(#cath-shaft)" opacity=".5" />
          <path d="M800 90 760 900h150l-70-810z" fill="url(#cath-shaft)" opacity=".62" />
          <path d="M940 120 990 900h-150l40-780z" fill="url(#cath-shaft)" opacity=".38" />
        </g>

        {/* ---- the angel, left of frame, hooded and bowed ---- */}
        <g className="cath-angel" opacity=".94">
          {/* wings, behind the body */}
          <path
            d="M330 690q-96-190-52-330 12 130 66 196-16-104 6-190 44 78 60 168 26-66 74-98 6 92-34 194 52-64 96-70-18 128-96 216z"
            fill="#0d0c10"
            stroke="#3a3742"
            strokeOpacity=".42"
            strokeWidth="1.6"
          />
          {/* robe */}
          <path
            d="M300 700q-14-140 34-208 22-32 60-34 40 2 62 36 46 66 30 206z"
            fill="url(#cath-stone)"
            stroke="#453f4d"
            strokeOpacity=".34"
            strokeWidth="1.4"
          />
          {/* hood and head, tilted down */}
          <path
            d="M394 470q34-16 62 8 22 22 8 52-16 30-46 24-32-8-34-44z"
            fill="#141318"
            stroke="#4a4453"
            strokeOpacity=".38"
            strokeWidth="1.3"
          />
          {/* the hands, folded */}
          <path d="M432 566q26 10 30 34" fill="none" stroke="#4a4453" strokeOpacity=".4" strokeWidth="2.4" />
          {/* rim light down the left edge of the robe */}
          <path
            d="M334 700q-10-134 34-202"
            fill="none"
            stroke="#aab4c4"
            strokeOpacity=".3"
            strokeWidth="1.6"
          />
        </g>

        {/* ---- floor: dark, wet, holding the reflections ---- */}
        <g className="cath-floor">
          <path d="M0 640h1600v260H0z" fill="url(#cath-floor)" />
          {/* the window's reflection, wobbling */}
          <g opacity=".2" filter="url(#cath-soft)">
            <path d="M760 660h80l40 240H720z" fill="#c9d4e2" opacity=".5" />
          </g>
          {/* the angel's reflection, softer and darker */}
          <g opacity=".12" filter="url(#cath-softer)">
            <path d="M296 660h300l40 240H250z" fill="#0a0a0d" />
          </g>
          {/* candle reflections, bright and narrow */}
          <g opacity=".26" filter="url(#cath-soft)">
            {[
              [148, 660, 9, 240],
              [214, 660, 7, 200],
              [1392, 660, 9, 240],
              [1326, 660, 7, 200],
            ].map(([x, y, w, h], i) => (
              <rect key={i} x={Number(x) - Number(w) / 2} y={y} width={w} height={h} fill="#e8cfa0" opacity=".55" rx="3" />
            ))}
          </g>
        </g>

        {/* ---- candle clusters: back rows small, front rows large ---- */}
        <g className="cath-candles">
          {/* far row, both sides */}
          {[
            [96, 596, 3.1], [124, 592, 3.6], [150, 598, 3.2], [176, 594, 3.7],
            [1424, 596, 3.1], [1452, 592, 3.6], [1478, 598, 3.2], [1504, 594, 3.7],
          ].map(([x, y, s], i) => (
            <g key={`f${i}`} transform={`translate(${x} ${y}) scale(${s})`}>
              <rect x="-2.6" y="-30" width="5.2" height="30" fill="#d8d2c4" opacity=".72" />
              <circle className="cath-flame" cx="0" cy="-34" r="9" fill="url(#cath-flame)" filter="url(#cath-bloom)" />
            </g>
          ))}
          {/* near row: the big stand on the left */}
          <g transform="translate(150 690)">
            <rect x="-42" y="-8" width="84" height="10" rx="2" fill="#191719" stroke="#3c3843" strokeOpacity=".5" />
            <rect x="-6" y="-56" width="12" height="50" fill="#151417" stroke="#3c3843" strokeOpacity=".4" />
            {[-28, -9, 10, 29].map((x, i) => (
              <g key={i} transform={`translate(${x} -60)`}>
                <rect x="-4" y="-46" width="8" height="46" fill="#e2dccd" opacity=".8" />
                <circle className="cath-flame cath-flame--near" cx="0" cy="-52" r="15" fill="url(#cath-flame)" filter="url(#cath-bloom)" />
              </g>
            ))}
          </g>
          {/* and on the right */}
          <g transform="translate(1392 690)">
            <rect x="-42" y="-8" width="84" height="10" rx="2" fill="#191719" stroke="#3c3843" strokeOpacity=".5" />
            <rect x="-6" y="-56" width="12" height="50" fill="#151417" stroke="#3c3843" strokeOpacity=".4" />
            {[-28, -9, 10, 29].map((x, i) => (
              <g key={i} transform={`translate(${x} -60)`}>
                <rect x="-4" y="-46" width="8" height="46" fill="#e2dccd" opacity=".8" />
                <circle className="cath-flame cath-flame--near" cx="0" cy="-52" r="15" fill="url(#cath-flame)" filter="url(#cath-bloom)" />
              </g>
            ))}
          </g>
        </g>

        {/* the altar cross at the far end, the only vertical in the centre */}
        <g className="cath-altar" opacity=".8">
          <rect x="795" y="300" width="10" height="132" fill="#2a2730" />
          <rect x="762" y="322" width="76" height="9" fill="#2a2730" />
          <circle cx="800" cy="298" r="9" fill="none" stroke="#6b6577" strokeOpacity=".7" strokeWidth="2" />
        </g>

        {/* candle glow that spills onto the surrounding stone */}
        <g filter="url(#cath-softer)" opacity=".2">
          <ellipse cx="150" cy="620" rx="120" ry="70" fill="#e8cfa0" />
          <ellipse cx="1392" cy="620" rx="120" ry="70" fill="#e8cfa0" />
          <ellipse cx="800" cy="380" rx="220" ry="150" fill="#cfd8e4" opacity=".5" />
        </g>
      </svg>
      <div className="scene-grain" />
      <div className="scene-scrim" />
    </div>
  )
}