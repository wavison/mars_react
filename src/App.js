import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Plot from "react-plotly.js";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const NASA_API_KEY = "3tGJehPh5AY4tV7wlm63TD3qylzoRBFlXhlBKB84"; // Replace with your API key
const ROVERS = ["Curiosity", "Opportunity", "Spirit", "Perseverance"];
const CAMERAS = {
  FHAZ: "Front Hazard",
  RHAZ: "Rear Hazard",
  MAST: "Mast Camera",
  CHEMCAM: "ChemCam",
  NAVCAM: "Navigation",
};

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [sol, setSol] = useState(1000);
  const [rover, setRover] = useState("Curiosity");
  const [camera, setCamera] = useState("");
  const [temps, setTemps] = useState([]);
  const [mapPoints, setMapPoints] = useState([]);

  // NEW: lightbox state
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fetch rover photos
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

  // Fetch temperature data
  useEffect(() => {
    const fetchTemps = async () => {
      const url = `https://api.nasa.gov/insight_weather/?api_key=${NASA_API_KEY}&feedtype=json&ver=1.0`;
      const res = await axios.get(url);
      const sols = res.data.sol_keys || [];
      const tempsData = sols
        .map((s) => ({ sol: s, avg: res.data[s]?.AT?.av ?? null }))
        .filter((t) => t.avg !== null);
      setTemps(tempsData);
    };
    fetchTemps();
  }, []);

  // Generate fake lat/lon points for photos (NASA API doesn’t provide exact coords)
  useEffect(() => {
    setMapPoints(
      photos.map(() => ({
        lat: -4.5 + Math.random() * 0.2,
        lon: 137.4 + Math.random() * 0.2,
      }))
    );
  }, [photos]);

  // Lightbox helpers
  const openLightbox = (index) => {
    setSelectedIndex(index);
    setIsLightboxOpen(true);
    // Prevent background scroll when open
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

  // Keyboard navigation when lightbox is open
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

  return (
    <div style={{ padding: 20 }}>
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

      {/* Photos */}
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

      {/* Temperature chart */}
      <h2>Temperature Trend</h2>
      <Plot
        data={[
          {
            x: temps.map((t) => t.sol),
            y: temps.map((t) => t.avg),
            type: "scatter",
            mode: "lines+markers",
            marker: { color: "red" },
          },
        ]}
        layout={{
          title: "Average Mars Temperature",
          xaxis: { title: "Sol" },
          yaxis: { title: "Temp (°C)" },
          template: "plotly_dark",
        }}
        style={{ width: "100%", height: "400px" }}
      />

      {/* Map */}
      <h2>Image Locations (approximate)</h2>
      <MapContainer
        center={[-4.5, 137.4]}
        zoom={8}
        style={{ height: "400px", width: "100%" }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
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
            <img
              src={selected.img_src}
              alt={`Mars photo — ${selected.camera?.full_name || selected.camera?.name || "Camera"} — ${selected.earth_date}`}
              style={{
                maxWidth: "95vw",
                maxHeight: "80vh",
                borderRadius: 8,
                display: "block",
                margin: "0 auto",
              }}
            />

            {/* Caption / meta */}
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
              <div style={{ display: "flex", gap: 8 }}>
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
                  Download
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
