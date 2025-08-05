import { useState, useEffect } from "react";
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
  NAVCAM: "Navigation"
};

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [sol, setSol] = useState(1000);
  const [rover, setRover] = useState("Curiosity");
  const [camera, setCamera] = useState("");
  const [temps, setTemps] = useState([]);
  const [mapPoints, setMapPoints] = useState([]);

  // Fetch rover photos
  useEffect(() => {
    const fetchPhotos = async () => {
      const url = `https://api.nasa.gov/mars-photos/api/v1/rovers/${rover.toLowerCase()}/photos`;
      const res = await axios.get(url, { params: { sol, api_key: NASA_API_KEY, camera: camera || undefined } });
      setPhotos(res.data.photos);
    };
    fetchPhotos();
  }, [sol, rover, camera]);

  // Fetch temperature data
  useEffect(() => {
    const fetchTemps = async () => {
      const url = `https://api.nasa.gov/insight_weather/?api_key=${NASA_API_KEY}&feedtype=json&ver=1.0`;
      const res = await axios.get(url);
      const sols = res.data.sol_keys || [];
      const tempsData = sols.map(sol => ({
        sol,
        avg: res.data[sol]?.AT?.av ?? null
      })).filter(t => t.avg !== null);
      setTemps(tempsData);
    };
    fetchTemps();
  }, []);

  // Generate fake lat/lon points for photos (NASA API doesn’t provide exact coords)
  useEffect(() => {
    setMapPoints(photos.map(() => ({
      lat: -4.5 + Math.random() * 0.2,
      lon: 137.4 + Math.random() * 0.2
    })));
  }, [photos]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Mars Rover Browser</h1>

      {/* Rover controls */}
      <div>
        <label>Sol: </label>
        <input type="number" value={sol} onChange={(e) => setSol(e.target.value)} />
        <label> Rover: </label>
        <select value={rover} onChange={(e) => setRover(e.target.value)}>
          {ROVERS.map(r => <option key={r}>{r}</option>)}
        </select>
        <label> Camera: </label>
        <select value={camera} onChange={(e) => setCamera(e.target.value)}>
          <option value="">All</option>
          {Object.entries(CAMERAS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </div>

      {/* Photos */}
      <h2>Rover Photos</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {photos.map(p => (
          <img key={p.id} src={p.img_src} alt="Mars" width={200} />
        ))}
      </div>

      {/* Temperature chart */}
      <h2>Temperature Trend</h2>
      <Plot
        data={[{
          x: temps.map(t => t.sol),
          y: temps.map(t => t.avg),
          type: "scatter",
          mode: "lines+markers",
          marker: { color: "red" }
        }]}
        layout={{
          title: "Average Mars Temperature",
          xaxis: { title: "Sol" },
          yaxis: { title: "Temp (°C)" },
          template: "plotly_dark"
        }}
        style={{ width: "100%", height: "400px" }}
      />

      {/* Map */}
      <h2>Image Locations (approximate)</h2>
      <MapContainer center={[-4.5, 137.4]} zoom={8} style={{ height: "400px", width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {mapPoints.map((p, i) => (
          <Marker key={i} position={[p.lat, p.lon]}>
            <Popup>Mars Photo {i + 1}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
