import React, { useState, useEffect } from "react";
import Navbar from "../components/Navbar.jsx";
import Footer from "../components/Footer.jsx";
import Button from "../components/UI/Button.jsx";
import { BrowserProvider, ethers, keccak256, toUtf8Bytes } from "ethers";
import contract from "../contracts/LandRegistry.sol/AllLandRegistry.json";
import SuccessPage from "./SuccessPage.jsx";
import { useVerifyData } from "../contaxts/verifyDataContext.jsx";

// Map Imports & CSS
import {
  MapContainer,
  TileLayer,
  Marker,
  Polygon,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons issue in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Map Click & Cursor Handler Helper Component
function MapClickHandler({ onMapClick, pointsCount }) {
  const map = useMap();

  useEffect(() => {
    if (pointsCount < 4) {
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.getContainer().style.cursor = "grab";
    }
  }, [pointsCount, map]);

  useMapEvents({
    click(e) {
      if (pointsCount < 4) {
        onMapClick([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

// Auto Recenter / Fly to First Marker Component
function MapFlyToLocation({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) {
      map.flyTo(points[0], 17, { duration: 1.2, easeLinearity: 0.25 });
    }
  }, [points, map]);
  return null;
}

export default function SubmitBlockchain() {
  const { verifyData } = useVerifyData();
  const { ethereum } = window;
    

  const [points, setPoints] = useState([]);

  const [formData, setFormData] = useState({
    fullName: verifyData?.name || "Sk Rijwan",
    aadhaarNo: verifyData?.aadhaar || "689257557011",
    plotNo: "",
    area:"",
    price: "",
    location: verifyData?.address || "",
  });

  const [blocksubmit, setBlocksubmit] = useState(false);
  const [BlockData, setBlockData] = useState({});

  const [fileData, setFileData] = useState({
    file: null,
    previewUrl: null,
    name: "",
    size: "",
    type: "",
  });

  const [ipfsimge, setipfsimg] = useState("");
  const [imagefile, setImagefile] = useState();
  const [loder, setLoder] = useState(false);
  const [ipfsStatus, setIpfsStatus] = useState("idle");

  const encodeCoordinate = (point) => {
    if (!point) return 0n;
    const [lat, lng] = point;
    const normalizedLat = Math.round((lat + 90) * 1_000_000);
    const normalizedLng = Math.round((lng + 180) * 1_000_000);
    return BigInt(normalizedLat) * 1_000_000_000n + BigInt(normalizedLng);
  };
  const toWeiPrice = (price) => ethers.parseEther(String(price || "0"));
  const calculateAreaSqFt = (pts) => {
    if (pts.length < 3) return "";

    const validPoints = pts.filter(
      ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng),
    );
    if (validPoints.length < 3) return "";

    const earthRadiusMeters = 6378137;
    const metersToSqFt = 10.76391041671;
    const centerLat =
      validPoints.reduce((sum, [lat]) => sum + lat, 0) / validPoints.length;
    const centerLng =
      validPoints.reduce((sum, [, lng]) => sum + lng, 0) / validPoints.length;
    const centerLatRad = (centerLat * Math.PI) / 180;

    const projectedPoints = validPoints.map(([lat, lng]) => {
      const x =
        (((lng - centerLng) * Math.PI) / 180) *
        earthRadiusMeters *
        Math.cos(centerLatRad);
      const y = (((lat - centerLat) * Math.PI) / 180) * earthRadiusMeters;
      return [x, y];
    });

    const areaSqMeters =
      Math.abs(
        projectedPoints.reduce((sum, [x1, y1], index) => {
          const [x2, y2] = projectedPoints[(index + 1) % projectedPoints.length];
          return sum + x1 * y2 - x2 * y1;
        }, 0),
      ) / 2;

    return (areaSqMeters * metersToSqFt).toFixed(2);
  };

  const updatePlotNoFromPoints = (pts) => {
    const pointsString = pts
      .map(
        (pt, idx) => `P${idx + 1}: (${pt[0].toFixed(5)}, ${pt[1].toFixed(5)})`,
      )
      .join(" | ");

    setFormData((prev) => ({
      ...prev,
      plotNo: pointsString,
      area: pts.length === 4 ? calculateAreaSqFt(pts) : "",
    }));
  };

  // --- MAP HANDLERS ---
  const handleAddPoint = (latlng) => {
    if (points.length < 4) {
      const newPoints = [...points, latlng];
      setPoints(newPoints);
      updatePlotNoFromPoints(newPoints);
    }
  };

  const handleRemovePoint = (index) => {
    const updatedPoints = points.filter((_, i) => i !== index);
    setPoints(updatedPoints);
    updatePlotNoFromPoints(updatedPoints);
  };

  const handleDragMarker = (index, event) => {
    const { lat, lng } = event.target.getLatLng();
    const updatedPoints = [...points];
    updatedPoints[index] = [lat, lng];
    setPoints(updatedPoints);
    updatePlotNoFromPoints(updatedPoints);
  };

  const handleClearMap = () => {
    setPoints([]);
    setFormData((prev) => ({ ...prev, plotNo: "", area: "" }));
  };

  // --- FORM HANDLERS ---
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const isImage = selectedFile.type.startsWith("image/");
      const preview = isImage ? URL.createObjectURL(selectedFile) : null;
      const fileSizeKB = (selectedFile.size / 1024).toFixed(2);

      const newFileData = {
        file: selectedFile,
        previewUrl: preview,
        name: selectedFile.name,
        size: fileSizeKB,
        type: selectedFile.type,
      };

      setFileData(newFileData);
      setImagefile(selectedFile);
      setIpfsStatus("pending");
    }
  };

  const handleIPFSUpload = async (e) => {
    e.preventDefault();
    setIpfsStatus("pending");
    setLoder(true);
    if (!fileData.file) return;

    try {
      const imgdata = new FormData();
      imgdata.append("file", imagefile);
      const requesturl = `https://api.pinata.cloud/pinning/pinFileToIPFS`;

      const uploadrequest = await fetch(requesturl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_PINATA_JWT}`,
        },
        body: imgdata,
      });

      const upload = await uploadrequest.json();
      setipfsimg(upload.IpfsHash);
      setLoder(false);
      setIpfsStatus("uploaded");
    } catch (err) {
      console.error(err);
      setLoder(false);
      alert("IPFS Upload Failed!");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (points.length !== 4) {
      alert("Please mark exactly 4 coordinate points on the map!");
      return;
    }

    setLoder(true);
    if (fileData.file && ipfsStatus !== "uploaded") {
      alert("Please upload the document to IPFS first!");
      setLoder(false);
      return;
    }

    try {
      if (!ethereum) {
        alert("Please install or unlock MetaMask first!");
        setLoder(false);
        return;
      }

      const hashedId = keccak256(toUtf8Bytes(formData.aadhaarNo));
      const WalletProvider = new BrowserProvider(ethereum);
      const singer = await WalletProvider.getSigner();
      const submitLandDatatnx = new ethers.Contract(
        import.meta.env.VITE_CONTRACT_DEPOLY_ADDRESS,
        contract.abi,
        singer,
      );

      const encodedPoints = [0, 1, 2, 3].map((index) => encodeCoordinate(points[index]));
      const imageHash = ipfsimge.trim();

      if (!imageHash) {
        alert("Please upload the document to IPFS first!");
        setLoder(false);
        return;
      }


      const Landdata = await submitLandDatatnx.AddNewLand(
        formData.fullName.trim(),
        hashedId,
        encodedPoints[0],
        encodedPoints[1],
        encodedPoints[2],
        encodedPoints[3],
        toWeiPrice(formData.price),
        String(formData.area).trim(),
        formData.location.trim(),
        imageHash,
      );

      await Landdata.wait();
      setBlockData(Landdata);
      setLoder(false);
      setBlocksubmit(true);
    } catch (err) {
      console.error(err);
      setLoder(false);
      alert("Blockchain minting failed!");
    }
  };

  const clearForm = () => {
    setFormData({
      fullName: "",
      aadhaarNo: "",
      plotNo: "",
      area: "",
      price: "",
      location: "",
    });
    setPoints([]);
    setFileData({
      file: null,
      previewUrl: null,
      name: "",
      size: "",
      type: "",
    });
    setIpfsStatus("idle");
  };

  if (blocksubmit) {
    return (
      <div className="min-h-screen bg-[#F0F0F0] text-[#121212] font-['Outfit'] flex flex-col">
        <SuccessPage hash={BlockData.hash} aadher={formData.aadhaarNo} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F0F0] text-[#121212] font-['Outfit'] flex flex-col">
      <Navbar />

      <main className="grow flex items-center justify-center p-4 md:p-8">
        <div className="w-full max-w-5xl bg-white border-4 border-[#121212] shadow-[8px_8px_0px_0px_#121212] relative transition-shadow duration-200">
          {/* Header Strip */}
          <div className="bg-[#1040C0] p-6 border-b-4 border-[#121212] flex flex-col md:flex-row justify-between items-center text-white gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-black uppercase tracking-tighter">
                Mint Land NFT
              </h1>
              <p className="font-bold tracking-widest text-[#F0C020] uppercase text-sm mt-1">
                Secure Registry Protocol
              </p>
            </div>
            <div className="flex items-center gap-2 bg-[#121212] border-2 border-[#F0C020] px-4 py-2 shadow-[3px_3px_0px_0px_#F0C020]">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-90"></div>
              <span className="font-bold font-mono text-sm tracking-wider">
                0x71C...9A23
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 md:p-10 space-y-8">
            {/* User Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="flex flex-col">
                <label className="text-lg font-black uppercase tracking-tight mb-2 flex justify-between">
                  <span>Legal Full Name</span>
                  <span className="text-[#D02020] text-xs pt-1">Verified</span>
                </label>
                <input
                  type="text"
                  name="fullName"
                  placeholder="Enter as per Govt ID"
                  value={formData.fullName}
                  onChange={handleChange}
                  readOnly
                  required
                  className="p-4 border-4 border-[#121212] bg-[#F0F0F0] font-bold focus:outline-none focus:bg-white transition-colors duration-150"
                />
              </div>

              <div className="flex flex-col">
                <label className="text-lg font-black uppercase tracking-tight mb-2 flex justify-between">
                  <span>Aadhaar Number</span>
                  <span className="text-[#D02020] text-xs pt-1">Encrypted</span>
                </label>
                <input
                  type="text"
                  name="aadhaarNo"
                  placeholder="12-Digit Identity Number"
                  value={formData.aadhaarNo}
                  onChange={handleChange}
                  readOnly
                  maxLength={12}
                  required
                  className="p-4 border-4 border-[#121212] bg-[#F0F0F0] font-bold focus:outline-none focus:bg-white transition-colors duration-150 tracking-widest"
                />
              </div>
            </div>

            {/* --- MAP INTEGRATION AREA --- */}
            <div className="flex flex-col space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                  <span>Plot Map Boundary Marker</span>
                  <span className="text-xs font-medium normal-case bg-blue-50 text-blue-900 px-2 py-0.5 rounded border border-blue-300">
                    Click map to add corner points
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-black bg-[#121212] text-white px-3 py-1 border-2 border-[#121212]">
                    {points.length}/4 Points
                  </span>
                  {points.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearMap}
                      className="text-xs font-bold text-red-600 hover:text-red-700 uppercase border-2 border-red-600 px-2 py-0.5 bg-red-50 hover:bg-red-100 transition-colors duration-150"
                    >
                      Clear Points
                    </button>
                  )}
                </div>
              </div>

              {/* Point Coordinates Badges */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((idx) => {
                  const pt = points[idx];
                  return (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-2.5 border-3 border-[#121212] font-mono text-xs font-black transition-colors duration-150 ${pt
                          ? "bg-[#F0C020] text-[#121212]"
                          : "bg-[#F0F0F0] text-gray-400 border-dashed"
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="uppercase text-[10px] tracking-wider text-gray-700">
                          Point {idx + 1} (P{idx + 1})
                        </span>
                        {pt && (
                          <button
                            type="button"
                            onClick={() => handleRemovePoint(idx)}
                            title="Remove Point"
                            className="bg-[#121212] text-white font-bold px-1.5 py-0.5 hover:bg-red-600 transition-colors duration-150 ml-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {/* input */}
                      <div>
                        <input
                          type="number"
                          step="any"
                          placeholder="Latitude"
                          value={pt ? pt[0] : ""}
                          onChange={(e) => {
                            const rawData = e.target.value;
                            const val =
                              rawData === "" ? 0 : parseFloat(rawData);
                            const currentLng = pt ? pt[1] : 85.96;

                            if (!isNaN(val)) {
                              const updated = [...points];
                              updated[idx] = [val, currentLng];
                              setPoints(updated);
                              updatePlotNoFromPoints(updated);
                            }
                          }}
                          className="w-1/2 p-1 border-2 border-[#121212] bg-white text-[11px] font-bold focus:outline-none"
                        />

                        <input
                          type="number"
                          step="any"
                          placeholder="Longitude"
                          value={pt ? pt[1] : ""}
                          onChange={(e) => {
                            const rawData = e.target.value;
                            const val =
                              rawData === "" ? 0 : parseFloat(rawData);
                            const currentLat = pt ? pt[0] : 22.273;
                            if (!isNaN(val)) {
                              const updated = [...points];
                              updated[idx] = [currentLat, val];
                              setPoints(updated);
                              updatePlotNoFromPoints(updated);
                            }
                          }}
                          className="w-1/2 p-1 border-2 border-[#121212] bg-white text-[11px] font-bold focus:outline-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Interactive Leaflet Map */}
              <div className="border-4 border-[#121212] shadow-[4px_4px_0px_0px_#121212] overflow-hidden relative">
                <MapContainer
                  center={[22.273, 85.96]}
                  zoom={15}
                  scrollWheelZoom={true}
                  doubleClickZoom={true}
                  style={{ height: "360px", width: "100%" }}
                  className="z-0"
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />

                  <MapClickHandler
                    onMapClick={handleAddPoint}
                    pointsCount={points.length}
                  />

                  <MapFlyToLocation points={points} />

                  {/* Selected Points Markers */}
                  {points.map((pt, idx) => (
                    <Marker
                      key={idx}
                      position={pt}
                      draggable={true}
                      eventHandlers={{
                        dragend: (e) => handleDragMarker(idx, e),
                      }}
                    >
                      <Popup>
                        <div className="font-sans text-xs font-bold text-[#121212]">
                          <strong>Point {idx + 1}</strong>
                          <br />
                          Drag marker to adjust position accurately.
                          <br />
                          <button
                            type="button"
                            onClick={() => handleRemovePoint(idx)}
                            className="mt-2 text-red-600 underline font-bold"
                          >
                            Remove this point
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  ))}

                  {/* Polygon outline */}
                  {points.length > 1 && (
                    <Polygon
                      positions={points}
                      pathOptions={{
                        color: "#1040C0",
                        fillColor: "#F0C020",
                        fillOpacity: 0.35,
                        weight: 3,
                        dashArray: points.length < 4 ? "5, 5" : undefined,
                      }}
                    />
                  )}
                </MapContainer>
              </div>

              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 flex items-center gap-1 mt-1">
                💡 <span className="text-[#1040C0] font-bold">Tip:</span> Click
                up to 4 corner locations to draw property boundaries. Markers
                can be dragged to fine-tune placement.
              </p>
            </div>

            {/* Total Area & Physical Location */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="flex flex-col">
                <label className="text-lg font-black uppercase tracking-tight mb-2">
                  Total Area
                </label>
                <div className="flex shadow-[3px_3px_0px_0px_#121212]">
                  <input
                    type="number"
                    name="area"
                    placeholder="2400"
                    value={formData.area}
                    onChange={handleChange}
                    required
                    className="w-full p-4 border-4 border-r-0 border-[#121212] bg-[#F0F0F0] font-bold focus:outline-none focus:bg-white"
                  />
                  <div className="bg-[#121212] text-white flex items-center justify-center px-4 border-4 border-[#121212] font-black uppercase tracking-wider text-sm">
                    Sq Ft
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-lg font-black uppercase tracking-tight mb-2">
                  Total Price (ETH)
                </label>
                <div className="flex shadow-[3px_3px_0px_0px_#121212]">
                  <input
                    type="number"
                    name="price"
                    placeholder="ET 0.1"
                    value={formData.price}
                    onChange={handleChange}
                    required
                    className="w-full p-4 border-4 border-r-0 border-[#121212] bg-[#F0F0F0] font-bold focus:outline-none focus:bg-white"
                  />
                  <div className="bg-[#121212] text-white flex items-center justify-center px-4 border-4 border-[#121212] font-black uppercase tracking-wider text-sm">
                    Sq Ft
                  </div>
                </div>
              </div>

              <div className="flex flex-col md:col-span-2">
                <label className="text-lg font-black uppercase tracking-tight mb-2">
                  Physical Address / Location
                </label>
                <textarea
                  name="location"
                  placeholder="Complete property address with pincode..."
                  value={formData.location}
                  onChange={handleChange}
                  required
                  rows="2"
                  className="w-full p-4 border-4 border-[#121212] bg-[#F0F0F0] font-bold focus:outline-none focus:bg-white shadow-[3px_3px_0px_0px_#121212] resize-none"
                ></textarea>
              </div>
            </div>

            {/* Document Upload Section */}
            <div className="flex flex-col">
              <label className="text-lg font-black uppercase tracking-tight mb-2 flex justify-between">
                <span>Property Image / Registry Document</span>
                {ipfsStatus === "uploaded" && (
                  <span className="text-[#1040C0] font-extrabold text-sm pt-1">
                    ✓ IPFS Uploaded
                  </span>
                )}
              </label>

              <div
                className={`relative border-4 border-dashed border-[#121212] p-6 text-center transition-colors duration-200 cursor-pointer shadow-[4px_4px_0px_0px_#121212] ${ipfsStatus === "uploaded"
                    ? "bg-[#1040C0]/5 border-solid border-[#1040C0]"
                    : "bg-[#F0C020]/10 hover:bg-[#F0C020]/15"
                  }`}
              >
                <input
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*,.pdf"
                  required={ipfsStatus === "idle"}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />

                <div className="flex flex-col items-center justify-center space-y-3">
                  {fileData.previewUrl ? (
                    <div className="z-20 flex flex-col items-center">
                      <img
                        src={fileData.previewUrl}
                        alt="Preview"
                        className="h-32 w-auto object-cover border-3 border-[#121212] mb-3 shadow-[3px_3px_0px_0px_#121212]"
                      />
                      <p
                        className={`font-black text-sm bg-white border-2 border-[#121212] px-3 py-1 shadow-[2px_2px_0px_0px_#121212] ${ipfsStatus === "uploaded"
                            ? "text-[#1040C0]"
                            : "text-[#121212]"
                          }`}
                      >
                        {fileData.name} ({fileData.size} KB)
                      </p>
                    </div>
                  ) : fileData.file ? (
                    <div className="z-20 flex flex-col items-center">
                      <div className="w-12 h-12 mb-2 bg-[#121212] flex justify-center items-center text-white font-black text-base border-2 border-[#121212]">
                        PDF
                      </div>
                      <p
                        className={`font-black text-sm bg-white border-2 border-[#121212] px-3 py-1 shadow-[2px_2px_0px_0px_#121212] ${ipfsStatus === "uploaded"
                            ? "text-[#1040C0]"
                            : "text-[#121212]"
                          }`}
                      >
                        {fileData.name} ({fileData.size} KB)
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div className="w-10 h-10 mx-auto mb-2 flex justify-center items-center bg-[#121212]">
                        <div className="w-0 h-0 border-l-6 border-r-6 border-b-10 border-l-transparent border-r-transparent border-b-[#F0F0F0]"></div>
                      </div>
                      <p className="font-black uppercase text-base text-[#121212]">
                        Click or Drag File to Upload
                      </p>
                      <p className="font-medium text-xs text-gray-600 mt-1">
                        Supports JPG, PNG or PDF formats (Max 5MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col md:flex-row gap-4 border-t-4 border-[#121212] pt-8">
              <Button
                variant="primary"
                className="w-full md:w-2/3 text-lg py-4 flex justify-center items-center gap-3 font-black shadow-[4px_4px_0px_0px_#121212] active:scale-[0.99] transition-transform duration-100"
                type={ipfsStatus === "pending" ? "button" : "submit"}
                onClick={
                  ipfsStatus === "pending" ? handleIPFSUpload : undefined
                }
              >
                {ipfsStatus === "pending" ? (
                  loder ? (
                    <>
                      <div
                        className="w-5 h-5 border-3 rounded-full border-white border-t-transparent animate-spin"
                        role="status"
                        aria-label="loading"
                      ></div>
                      UPLOADING TO IPFS...
                    </>
                  ) : (
                    "Upload Document to IPFS"
                  )
                ) : loder ? (
                  <>
                    <div
                      className="w-5 h-5 border-3 rounded-full border-white border-t-transparent animate-spin"
                      role="status"
                      aria-label="loading"
                    ></div>
                    MINTING BLOCKCHAIN TRANSACTION...
                  </>
                ) : (
                  "Mint Land NFT to Blockchain"
                )}
              </Button>

              <button
                type="button"
                className="w-full md:w-1/3 bg-white text-[#121212] border-4 border-[#121212] font-black uppercase tracking-wider hover:bg-red-50 hover:text-red-600 transition-colors duration-150 py-4 shadow-[4px_4px_0px_0px_#121212] active:scale-[0.99]"
                onClick={clearForm}
              >
                Clear Form
              </button>
            </div>
          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}

