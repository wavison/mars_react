import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import Plot from "react-plotly.js";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./edges.css"; // effect classes + variables

const NASA_API_KEY = "3tGJehPh5AY4tV7wlm63TD3qylzoRBFlXhlBKB84"; // Replace with your API key
const ROVERS = ["Curiosity", "Opportunity", "Spirit", "Perseverance"];
const CAMERAS = {
  FHAZ: "Front Hazard",
  RHAZ: "Rear Hazard",
  MAST: "Mast Camera",
  CHEMCAM: "ChemCam",
  NAVCAM: "Navigation",
};

// Optional: if your image host blocks canvas export via CORS,
// set this to your proxy endpoint like: "https://your-worker.example/proxy"
const IMAGE_PROXY = ""; // leave empty to try direct; set to enable proxy (see notes)

/* ---------------- SVG Filters (for live preview) ----------------- */
function SvgFilters() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      {/* Sobel Edges (white on black) */}
      <filter id="sobel-edges">
        <feColorMatrix
          type="matrix"
          values={`
            0.2126 0.7152 0.0722 0 0
            0.2126 0.7152 0.0722 0 0
            0.2126 0.7152 0.0722 0 0
            0       0      0      1 0
          `}
          result="gray"
        />
        <feConvolveMatrix order="3" kernelMatrix="-1 0 1 -2 0 2 -1 0 1" preserveAlpha="true" in="gray" result="gx" />
        <feConvolveMatrix order="3" kernelMatrix="-1 -2 -1 0 0 0 1 2 1" preserveAlpha="true" in="gray" result="gy" />
        <feComposite in="gx" in2="gx" operator="arithmetic" k1="0" k2="0" k3="1" k4="0" result="gx2" />
        <feComposite in="gy" in2="gy" operator="arithmetic" k1="0" k2="0" k3="1" k4="0" result="gy2" />
        <feComposite in="gx2" in2="gy2" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="sum" />
        <feComponentTransfer in="sum">
          <feFuncR type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="0.5" offset="0" />
        </feComponentTransfer>
        {/* Invert to white-on-black */}
        <feComponentTransfer>
          <feFuncR type="table" tableValues="1 0" />
          <feFuncG type="table" tableValues="1 0" />
          <feFuncB type="table" tableValues="1 0" />
        </feComponentTransfer>
      </filter>

      {/* Sharpen (classic 3x3 kernel) */}
      <filter id="sharpen">
        <feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" preserveAlpha="true" />
      </filter>

      {/* Colored edges (for outline overlay preview) */}
      <filter id="sobel-colored-edges">
        <feColorMatrix
          type="matrix"
          values={`
            0.2126 0.7152 0.0722 0 0
            0.2126 0.7152 0.0722 0 0
            0.2126 0.7152 0.0722 0 0
            0       0      0      1 0
          `}
          result="gray"
        />
        <feConvolveMatrix order="3" kernelMatrix="-1 0 1 -2 0 2 -1 0 1" preserveAlpha="true" in="gray" result="gx" />
        <feConvolveMatrix order="3" kernelMatrix="-1 -2 -1 0 0 0 1 2 1" preserveAlpha="true" in="gray" result="gy" />
        <feComposite in="gx" in2="gx" operator="arithmetic" k1="0" k2="0" k3="1" k4="0" result="gx2" />
        <feComposite in="gy" in2="gy" operator="arithmetic" k1="0" k2="0" k3="1" k4="0" result="gy2" />
        <feComposite in="gx2" in2="gy2" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="sum" />
        <feComponentTransfer in="sum">
          <feFuncR type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="0.5" offset="0" />
        </feComponentTransfer>
        <feColorMatrix type="luminanceToAlpha" result="edgeAlpha" />
        <feFlood flood-color="rgb(255,0,0)" result="edgeColor" />
        <feComposite in="edgeColor" in2="edgeAlpha" operator="in" result="coloredEdges" />
        <feMerge>
          <feMergeNode in="coloredEdges" />
        </feMerge>
      </filter>
    </svg>
  );
}

/* ---------------- Pixel Ops for Download ----------------- */
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
function toGray(r,g,b) { return 0.2126*r + 0.7152*g + 0.0722*b; }
function contrastByte(v, c) { return clamp((v - 128) * c + 128); }

function sobelMagnitude(gray, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const tl = gray[i - W - 1], tc = gray[i - W], tr = gray[i - W + 1];
      const ml = gray[i - 1],               mr = gray[i + 1];
      const bl = gray[i + W - 1], bc = gray[i + W], br = gray[i + W + 1];
      const gx = -tl + tr - 2*ml + 2*mr - bl + br;
      const gy = -tl - 2*tc - tr + bl + 2*bc + br;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function dilate(src, W, H, radius) {
  if (radius <= 0) return src;
  const out = new Float32Array(W * H);
  const r = Math.max(1, Math.round(radius));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= W) continue;
          const v = src[yy * W + xx];
          if (v > m) m = v;
        }
      }
      out[y * W + x] = m;
    }
  }
  return out;
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r=0,g=0,b=0;
  if (0 <= hp && hp < 1) [r,g,b] = [c,x,0];
  else if (1 <= hp && hp < 2) [r,g,b] = [x,c,0];
  else if (2 <= hp && hp < 3) [r,g,b] = [0,c,x];
  else if (3 <= hp && hp < 4) [r,g,b] = [0,x,c];
  else if (4 <= hp && hp < 5) [r,g,b] = [x,0,c];
  else if (5 <= hp && hp < 6) [r,g,b] = [c,0,x];
  const m = v - c;
  return [ (r+m)*255, (g+m)*255, (b+m)*255 ];
}

async function loadImageCORS(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("Image load failed."));
    img.src = url.replace(/^http:/, "https:");
  });
}

async function downloadProcessed(effect, params, imgUrl, filenameBase) {
  try {
    const srcUrl = (IMAGE_PROXY ? `${IMAGE_PROXY}?url=${encodeURIComponent(imgUrl)}` : imgUrl).replace(/^http:/,"https:");
    const img = await loadImageCORS(srcUrl);
    const W = img.naturalWidth, H = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, W, H);
    } catch (e) {
      alert("Canvas export was blocked by CORS. If this happens often, set IMAGE_PROXY in App.js (see comment at top).");
      return;
    }
    const data = imageData.data;

    if (effect === "sharpen") {
      const src = new Uint8ClampedArray(data);
      const idx = (x,y,c)=> ((y*W+x)*4+c);
      for (let y=1;y<H-1;y++){
        for (let x=1;x<W-1;x++){
          for (let c=0;c<3;c++){
            const v = 5*src[idx(x,y,c)]
              - src[idx(x-1,y,c)] - src[idx(x+1,y,c)]
              - src[idx(x,y-1,c)] - src[idx(x,y+1,c)];
            data[idx(x,y,c)] = contrastByte(v, params.sharpenContrast || 1.0);
          }
          data[idx(x,y,3)] = 255;
        }
      }
    } else if (effect === "threshold") {
      const T = 128 * (params.threshShift || 1.0);
      const inv = !!params.threshInvert;
      for (let i=0;i<data.length;i+=4){
        const g = toGray(data[i], data[i+1], data[i+2]);
        const v = g >= T ? 255 : 0;
        const out = inv ? 255 - v : v;
        data[i] = data[i+1] = data[i+2] = out;
        data[i+3] = 255;
      }
    } else if (effect === "edges") {
      const gray = new Float32Array(W*H);
      for (let y=0,i=0;y<H;y++){
        for (let x=0;x<W;x++,i+=4){
          gray[(y*W)+x] = toGray(data[i], data[i+1], data[i+2]);
        }
      }
      let mag = sobelMagnitude(gray, W, H);
      let maxV = 0;
      for (let i=0;i<mag.length;i++){ if (mag[i]>maxV) maxV = mag[i]; }
      const scale = maxV ? 255/maxV : 1;
      for (let i=0;i<mag.length;i++) mag[i]*=scale;

      const inverted = new Float32Array(W*H);
      for (let i=0;i<mag.length;i++) inverted[i] = 255 - mag[i];

      const B = params.edgeThreshold || 1.0;
      const C = params.edgeStrength || 1.8;
      for (let i=0;i<inverted.length;i++){
        let v = inverted[i] * B;
        v = contrastByte(v, C);
        inverted[i] = v;
      }

      const radius = Math.max(0, Math.round((params.edgeThickness || 0)));
      let thick = radius>0 ? dilate(inverted, W, H, radius) : inverted;

      const RC = params.edgeRecontrast || 1.0;
      for (let i=0;i<thick.length;i++){
        thick[i] = contrastByte(thick[i], RC);
      }

      for (let i=0,j=0;i<data.length;i+=4,j++){
        const v = clamp(thick[j]);
        data[i]=data[i+1]=data[i+2]=v; data[i+3]=255;
      }

    } else if (effect === "outline") {
      const srcRGB = new Uint8ClampedArray(data);
      const gray = new Float32Array(W*H);
      for (let y=0,i=0;y<H;y++){
        for (let x=0;x<W;x++,i+=4){
          gray[(y*W)+x] = toGray(srcRGB[i], srcRGB[i+1], srcRGB[i+2]);
        }
      }
      let mag = sobelMagnitude(gray, W, H);
      let maxV = 0; for (let i=0;i<mag.length;i++) if (mag[i]>maxV) maxV = mag[i];
      const invMax = maxV ? 1/maxV : 0;
      for (let i=0;i<mag.length;i++) mag[i]*=invMax;

      const radius = Math.max(0, Math.round(params.outlineWidth || 0));
      if (radius>0) {
        const tmp255 = new Float32Array(mag.length);
        for (let i=0;i<mag.length;i++) tmp255[i] = mag[i]*255;
        const d = dilate(tmp255, W, H, radius);
        for (let i=0;i<mag.length;i++) mag[i] = d[i]/255;
      }

      const hue = params.outlineHue || 200;
      const sat = params.outlineSaturation || 3.0;
      const op  = params.outlineOpacity ?? 0.9;

      const [rC,gC,bC] = hsvToRgb(((hue%360)+360)%360, Math.min(1, sat/3), 1);
      const cr = rC/255, cg = gC/255, cb = bC/255;

      for (let i=0,j=0;i<data.length;i+=4,j++){
        const ar = data[i]/255, ag = data[i+1]/255, ab = data[i+2]/255;
        const alpha = Math.max(0, Math.min(1, mag[j]*op));
        const br = cr, bg = cg, bb = cb;
        const or = 1 - (1 - ar) * (1 - br*alpha);
        const og = 1 - (1 - ag) * (1 - bg*alpha);
        const ob = 1 - (1 - ab) * (1 - bb*alpha);
        data[i] = clamp(Math.round(or*255));
        data[i+1] = clamp(Math.round(og*255));
        data[i+2] = clamp(Math.round(ob*255));
        data[i+3] = 255;
      }
    } else {
      // original: nothing to change
    }

    ctx.putImageData(imageData, 0, 0);
    const a = document.createElement("a");
    a.download = `${filenameBase}-${effect}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  } catch (e) {
    console.error(e);
    alert("Failed to export image. Details in console.");
  }
}

/* ---------------- Helpers for wind rose ----------------- */
function compassPointToDeg(pt) {
  if (!pt) return null;
  const map = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
    "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
    "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
    "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5
  };
  const k = String(pt).toUpperCase();
  return map[k] ?? null;
}

function buildRoseFromWD(WD) {
  if (!WD || typeof WD !== "object") return null;
  const sectors = [];
  for (const key of Object.keys(WD)) {
    const s = WD[key];
    if (!s) continue;
    const ct = typeof s.ct === "number" ? s.ct : 0;
    if (ct <= 0) continue;
    const deg = typeof s.compass_degrees === "number" ? s.compass_degrees : compassPointToDeg(s.compass_point);
    const label = s.compass_point || (typeof deg === "number" ? `${deg}°` : key);
    if (deg == null) continue;
    sectors.push({ deg, label, ct });
  }
  if (!sectors.length) return null;
  sectors.sort((a,b)=>a.deg-b.deg);
  const theta = sectors.map(s=>s.deg);
  const labels = sectors.map(s=>s.label);
  const r = sectors.map(s=>s.ct);
  return { theta, labels, r };
}

/* ---------------- App ----------------- */
export default function App() {
  const [photos, setPhotos] = useState([]);
  const [sol, setSol] = useState(1000);
  const [rover, setRover] = useState("Curiosity");
  const [camera, setCamera] = useState("");
  const [temps, setTemps] = useState([]);
  const [mapPoints, setMapPoints] = useState([]);

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Effect mode: 'none' | 'edges' | 'sharpen' | 'threshold' | 'outline'
  const [effect, setEffect] = useState("edges");

  // Edges controls
  const [edgeStrength, setEdgeStrength] = useState(1.8);
  const [edgeThreshold, setEdgeThreshold] = useState(1.0);
  const [edgeThickness, setEdgeThickness] = useState(0.0);
  const [edgeRecontrast, setEdgeRecontrast] = useState(1.0);

  // Sharpen controls
  const [sharpenContrast, setSharpenContrast] = useState(1.2);

  // Threshold controls
  const [threshShift, setThreshShift] = useState(1.0);
  const [threshInvert, setThreshInvert] = useState(false);

  // Outline controls
  const [outlineWidth, setOutlineWidth] = useState(1.5);
  const [outlineHue, setOutlineHue] = useState(200);
  const [outlineOpacity, setOutlineOpacity] = useState(0.9);
  const [outlineSaturation, setOutlineSaturation] = useState(3);

  useEffect(() => {
    const fetchPhotos = async () => {
      const url = `https://api.nasa.gov/mars-photos/api/v1/rovers/${rover.toLowerCase()}/photos`;
      const res = await axios.get(url, {
        params: { sol, api_key: NASA_API_KEY, camera: camera || undefined },
      });
      setPhotos(res.data.photos);
      setSelectedIndex(0);
    };
    fetchPhotos();
  }, [sol, rover, camera]);

  useEffect(() => {
    const fetchTemps = async () => {
      const url = `https://api.nasa.gov/insight_weather/?api_key=${NASA_API_KEY}&feedtype=json&ver=1.0`;
      const res = await axios.get(url);
      const sols = res.data.sol_keys || [];
      const tdata = sols
        .map((s) => {
          const d = res.data[s] || {};
          return {
            sol: Number(s),
            at: d.AT?.av ?? null,
            pre: d.PRE?.av ?? null,
            hws: d.HWS?.av ?? null,
            season: d.Season ?? null,
            wd: d.WD ?? null,
          };
        })
        .filter((t) => t.at !== null || t.pre !== null);
      setTemps(tdata);
    };
    fetchTemps();
  }, []);

  useEffect(() => {
    setMapPoints(
      photos.map(() => ({
        lat: -4.5 + Math.random() * 0.2,
        lon: 137.4 + Math.random() * 0.2,
      }))
    );
  }, [photos]);

  const openLightbox = (index) => {
    setSelectedIndex(index);
    setIsLightboxOpen(true);
    document.body.style.overflow = "hidden";
  };
  const closeLightbox = () => {
    setIsLightboxOpen(false);
    document.body.style.overflow = "";
  };
  const showPrev = useCallback(() => {
    setSelectedIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);
  const showNext = useCallback(() => {
    setSelectedIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  useEffect(() => {
    if (!isLightboxOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLightboxOpen, showPrev, showNext]);

  const selected = photos[selectedIndex];

  // Build a 7-sol window centered on current sol (sol-3..sol+3)
  const tempWindow = useMemo(() => {
    const m = new Map(temps.map((t) => [Number(t.sol), t]));
    const xs = Array.from({ length: 7 }, (_, i) => Number(sol) - 3 + i);
    const yAT = xs.map((x) => (m.has(x) ? m.get(x).at : null));
    const yPRE = xs.map((x) => (m.has(x) ? m.get(x).pre : null));
    const center = m.get(Number(sol)) || null;
    const hasAny = yAT.some((v) => v !== null) || yPRE.some((v) => v !== null);
    const rose = center && center.wd ? buildRoseFromWD(center.wd) : null;
    return { xs, yAT, yPRE, center, rose, hasAny };
  }, [temps, sol]);

  // Preview image under current effect
  const renderMainImage = () => {
    if (!selected) return null;

    if (effect === "outline") {
      return (
        <div className="outline-wrap" style={{ position: "relative" }}>
          <img
            src={selected.img_src}
            alt="Mars photo original"
            style={{
              maxWidth: "95vw",
              maxHeight: "80vh",
              borderRadius: 8,
              display: "block",
              margin: "0 auto",
            }}
          />
          <img
            src={selected.img_src}
            alt="Outline overlay"
            className="outline-overlay"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              mixBlendMode: "screen",
              opacity: outlineOpacity,
              ["--outline-hue"] : `${outlineHue}deg`,
              ["--outline-sat"] : outlineSaturation,
              ["--outline-blur"]: `${outlineWidth}px`,
            }}
          />
        </div>
      );
    }

    const effectClass =
      effect === "edges" ? "edge-view" :
      effect === "sharpen" ? "sharpen-view" :
      effect === "threshold" ? "threshold-view" : "";

    const styleVars =
      effect === "edges" ? {
        ["--edge-contrast"]: edgeStrength,
        ["--edge-brightness"]: edgeThreshold,
        ["--edge-blur"]: `${edgeThickness}px`,
        ["--edge-recontrast"]: edgeRecontrast,
      } : effect === "sharpen" ? {
        ["--sharpen-contrast"]: sharpenContrast
      } : effect === "threshold" ? {
        ["--thresh-shift"]: threshShift,
        ["--thresh-invert"]: threshInvert ? 1 : 0,
      } : {};

    return (
      <img
        src={selected.img_src}
        alt={`Mars photo — ${selected.camera?.full_name || selected.camera?.name || "Camera"} — ${selected.earth_date}`}
        className={effectClass}
        style={{
          maxWidth: "95vw",
          maxHeight: "80vh",
          borderRadius: 8,
          display: "block",
          margin: "0 auto",
          ...styleVars,
        }}
      />
    );
  };

  const handleDownloadEffect = async () => {
    if (!selected) return;
    await downloadProcessed(
      effect === "none" ? "original" : effect,
      {
        edgeStrength, edgeThreshold, edgeThickness, edgeRecontrast,
        sharpenContrast,
        threshShift, threshInvert,
        outlineWidth, outlineHue, outlineOpacity, outlineSaturation
      },
      selected.img_src,
      `${(selected.rover?.name || rover || "rover")}-${selected.id || selected.earth_date || "image"}`
    );
  };

  return (
    <div style={{ padding: 20 }}>
      <SvgFilters />

      <h1>Mars Rover Browser</h1>

      {/* Rover controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Sol:{" "}
          <input
            type="number"
            value={sol}
            onChange={(e) => setSol(Number(e.target.value))}
            style={{ width: 100, marginLeft: 6 }}
          />
        </label>
        <label>
          Rover:{" "}
          <select value={rover} onChange={(e) => setRover(e.target.value)}>
            {ROVERS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          Camera:{" "}
          <select value={camera} onChange={(e) => setCamera(e.target.value)}>
            <option value="">All</option>
            {Object.entries(CAMERAS).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span style={{ opacity: 0.7 }}>
          Showing {photos.length} photo{photos.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Photos grid */}
      <h2 style={{ marginTop: 16 }}>Rover Photos</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {photos.map((p, idx) => (
          <button
            key={p.id}
            onClick={() => openLightbox(idx)}
            style={{
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              lineHeight: 0,
            }}
            aria-label={`Open photo ${idx + 1} taken by ${p.camera?.full_name || p.camera?.name} on ${p.earth_date}`}
            title="Click to open"
          >
            <img
              src={p.img_src}
              alt={`Mars photo — ${p.camera?.full_name || p.camera?.name || "Camera"} — ${p.earth_date}`}
              width={200}
              style={{ borderRadius: 8, display: "block" }}
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {/* Temperature + Pressure */}
      <h2>Temperature & Pressure (Centered on Sol {Number(sol)})</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <Plot
          data={[
            {
              x: tempWindow.xs,
              y: tempWindow.yAT,
              type: "scatter",
              mode: "lines+markers",
              name: "Avg Temp (°C)",
            },
            {
              x: tempWindow.xs,
              y: tempWindow.yPRE,
              type: "scatter",
              mode: "lines+markers",
              name: "Avg Pressure (Pa)",
              yaxis: "y2",
            },
            ...(tempWindow.center && tempWindow.center.at != null ? [{
              x: [Number(sol)],
              y: [tempWindow.center.at],
              type: "scatter",
              mode: "markers",
              name: "Current Temp",
              marker: { size: 12, symbol: "circle-open" },
            }] : [])
          ]}
          layout={{
            xaxis: { title: "Sol", range: [Number(sol)-3-0.5, Number(sol)+3+0.5], dtick: 1 },
            yaxis: { title: "Temp (°C)" },
            yaxis2: { title: "Pressure (Pa)", overlaying: "y", side: "right" },
            showlegend: true,
            template: "plotly_dark",
            margin: { t: 10, r: 50, b: 50, l: 50 },
            shapes: [
              {
                type: "line",
                x0: Number(sol), x1: Number(sol),
                yref: "paper", y0: 0, y1: 1,
                line: { dash: "dot", width: 1 }
              }
            ]
          }}
          style={{ width: "100%", height: "360px" }}
          config={{ displayModeBar: false }}
        />
        {!tempWindow.hasAny && (
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: -8 }}>
            No InSight temp/pressure data available for this 7-sol window.
          </div>
        )}
        {tempWindow.center && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {tempWindow.center.season && (
              <span style={{ fontSize: 12, background: "rgba(255,255,255,0.08)", padding: "4px 8px", borderRadius: 6 }}>
                Season: {tempWindow.center.season}
              </span>
            )}
            {tempWindow.center.hws != null && (
              <span style={{ fontSize: 12, opacity: 0.8 }}>Wind speed avg: {tempWindow.center.hws.toFixed(2)} m/s</span>
            )}
            {tempWindow.center.pre != null && (
              <span style={{ fontSize: 12, opacity: 0.8 }}>Pressure avg: {Math.round(tempWindow.center.pre)} Pa</span>
            )}
          </div>
        )}
      </div>

      {/* Wind rose */}
      <h2 style={{ marginTop: 16 }}>Wind Rose (Sol {Number(sol)})</h2>
      {tempWindow.rose ? (
        <Plot
          data={[{
            type: "barpolar",
            r: tempWindow.rose.r,
            theta: tempWindow.rose.theta,
            name: "Counts",
            hovertemplate: "%{theta}° — %{r} counts<extra></extra>"
          }]}
          layout={{
            template: "plotly_dark",
            margin: { t: 10, r: 10, b: 10, l: 10 },
            polar: {
              angularaxis: { direction: "clockwise", rotation: 90, tickmode: "array", tickvals: tempWindow.rose.theta, ticktext: tempWindow.rose.labels },
              radialaxis: { visible: true, ticks: "", showline: false, gridcolor: "rgba(255,255,255,0.15)" }
            },
            showlegend: false,
          }}
          style={{ width: "100%", height: "360px" }}
          config={{ displayModeBar: false }}
        />
      ) : (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          No wind direction distribution available for this sol.
        </div>
      )}

      {/* Map */}
      <h2>Image Locations (approximate)</h2>
      <MapContainer
        center={[-4.5, 137.4]}
        zoom={4}
        style={{ height: "400px", width: "100%" }}
      >
        {/* Mars basemap from OpenPlanetary (MOLA color). Uses Web Mercator XYZ tiles. */}
        <TileLayer
          url="https://s3-eu-west-1.amazonaws.com/whereonmars.cartodb.net/mola-color/{z}/{x}/{y}.png"
          tms={true}
          attribution="&copy; OpenPlanetaryMap & MOLA (USGS/NASA)"
        />
        {mapPoints.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lon]}>
            <Popup>Mars Photo {i + 1}</Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* LIGHTBOX MODAL */}
      {isLightboxOpen && selected && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeLightbox}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "95vw",
              maxHeight: "95vh",
            }}
          >
            {/* Close button */}
            <button
              onClick={closeLightbox}
              aria-label="Close"
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.3)",
                borderRadius: 6,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              ✕
            </button>

            {/* Prev / Next */}
            {photos.length > 1 && (
              <>
                <button
                  onClick={showPrev}
                  aria-label="Previous image"
                  style={{
                    position: "absolute",
                    left: -6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 6,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  ‹
                </button>
                <button
                  onClick={showNext}
                  aria-label="Next image"
                  style={{
                    position: "absolute",
                    right: -6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.3)",
                    borderRadius: 6,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  ›
                </button>
              </>
            )}

            {/* Big image */}
            {renderMainImage()}

            {/* Caption / meta & controls */}
            <div
              style={{
                color: "#fff",
                marginTop: 8,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <strong>{selected.rover?.name || rover}</strong> • {selected.camera?.full_name || selected.camera?.name}
                {" "}• Sol {sol} • {selected.earth_date}
              </div>

              {/* Controls */}
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, opacity: 0.85 }}>Effect</label>
                <select value={effect} onChange={(e) => setEffect(e.target.value)}>
                  <option value="none">Original</option>
                  <option value="edges">Edges</option>
                  <option value="sharpen">Sharpen</option>
                  <option value="threshold">Threshold</option>
                  <option value="outline">Outline overlay</option>
                </select>

                {/* Edges controls */}
                {effect === "edges" && (
                  <>
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Strength</label>
                    <input type="range" min={0.5} max={4} step={0.1}
                      value={edgeStrength} onChange={(e) => setEdgeStrength(parseFloat(e.target.value))} style={{ width: 120 }} />
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Threshold</label>
                    <input type="range" min={0.6} max={1.8} step={0.05}
                      value={edgeThreshold} onChange={(e) => setEdgeThreshold(parseFloat(e.target.value))} style={{ width: 120 }} />
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Thickness</label>
                    <input type="range" min={0} max={4} step={0.1}
                      value={edgeThickness} onChange={(e) => setEdgeThickness(parseFloat(e.target.value))} style={{ width: 120 }} />
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Re-contrast</label>
                    <input type="range" min={1} max={6} step={0.1}
                      value={edgeRecontrast} onChange={(e) => setEdgeRecontrast(parseFloat(e.target.value))} style={{ width: 120 }} />
                  </>
                )}

                {/* Sharpen controls */}
                {effect === "sharpen" && (
                  <>
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Amount</label>
                    <input type="range" min={0.8} max={2.5} step={0.05}
                      value={sharpenContrast} onChange={(e) => setSharpenContrast(parseFloat(e.target.value))} style={{ width: 160 }} />
                    <span style={{ fontSize: 12, opacity: 0.75 }}>{sharpenContrast.toFixed(2)}×</span>
                  </>
                )}

                {/* Threshold controls */}
                {effect === "threshold" && (
                  <>
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Level</label>
                    <input type="range" min={0.6} max={1.6} step={0.02}
                      value={threshShift} onChange={(e) => setThreshShift(parseFloat(e.target.value))} style={{ width: 160 }} />
                    <span style={{ fontSize: 12, opacity: 0.75 }}>{threshShift.toFixed(2)}</span>
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Invert</label>
                    <input type="checkbox" checked={threshInvert} onChange={(e) => setThreshInvert(e.target.checked)} />
                  </>
                )}

                {/* Outline controls */}
                {effect === "outline" && (
                  <>
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Width</label>
                    <input type="range" min={0} max={4} step={0.1}
                      value={outlineWidth} onChange={(e) => setOutlineWidth(parseFloat(e.target.value))} style={{ width: 120 }} />
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Hue</label>
                    <input type="range" min={0} max={360} step={1}
                      value={outlineHue} onChange={(e) => setOutlineHue(parseInt(e.target.value, 10))} style={{ width: 140 }} />
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Saturation</label>
                    <input type="range" min={0.5} max={6} step={0.1}
                      value={outlineSaturation} onChange={(e) => setOutlineSaturation(parseFloat(e.target.value))} style={{ width: 120 }} />
                    <label style={{ fontSize: 12, opacity: 0.85 }}>Opacity</label>
                    <input type="range" min={0} max={1} step={0.05}
                      value={outlineOpacity} onChange={(e) => setOutlineOpacity(parseFloat(e.target.value))} style={{ width: 120 }} />
                  </>
                )}

                {/* Download buttons */}
                <a
                  href={selected.img_src}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.3)",
                    textDecoration: "none",
                  }}
                >
                  Open original
                </a>
                <a
                  href={selected.img_src}
                  download
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.3)",
                    textDecoration: "none",
                  }}
                >
                  Download original
                </a>
                <button
                  onClick={handleDownloadEffect}
                  title="Export the current effect as a PNG (may require CORS)"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.3)",
                    cursor: "pointer",
                    opacity: effect === "none" ? 0.5 : 1,
                  }}
                  disabled={effect === "none"}
                >
                  Download {effect === "outline" ? "outline" : effect} PNG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
