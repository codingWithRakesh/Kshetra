import React, { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { ShoppingCart, User, MapPin, X, CheckCircle2 } from "lucide-react";
import contract from "../contracts/LandRegistry.sol/AllLandRegistry.json";
// Import the ABI specifically for the individual LandRegistry contract
import childContract from "../contracts/LandRegistry.sol/LandRegistry.json";
import { ethers, keccak256, toUtf8Bytes } from "ethers";
import axios from "axios";

// Leaflet Imports
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// 💡 HELPER: Extract raw coordinates for Leaflet map mapping
const getRawCoordinate = (encodedPoint) => {
  const encoded = BigInt(encodedPoint.toString());
  const lat = Number(encoded / 1_000_000_000n) / 1_000_000 - 90;
  const lng = Number(encoded % 1_000_000_000n) / 1_000_000 - 180;
  return [lat, lng];
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getLogsInChunks = async (contractInstance, filter, startBlock, endBlock) => {
  const CHUNK_SIZE = 9900;
  let allEvents = [];

  for (let currentFrom = startBlock; currentFrom <= endBlock; currentFrom += CHUNK_SIZE) {
    const currentTo = Math.min(currentFrom + CHUNK_SIZE - 1, endBlock);
    const chunkEvents = await contractInstance.queryFilter(filter, currentFrom, currentTo);
    allEvents = allEvents.concat(chunkEvents);
    await sleep(300);
  }
  return allEvents;
};

const ModalMapBounds = ({ coordinates }) => {
  const map = useMap();
  useEffect(() => {
    if (coordinates && coordinates.length > 0) {
      const bounds = L.latLngBounds(coordinates);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [coordinates, map]);
  return null;
};

const SliceBuy = () => {
  const [marketplaceAssets, setmarketplaceAssets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // 💡 Modal Flow States
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [purchaseStep, setPurchaseStep] = useState("review"); // 'review' | 'aadhaar' | 'otp' | 'processing' | 'success' | 'buy' | 'error'
  const [buyerAadhaar, setBuyerAadhaar] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [aadhaarOTP, setAadhaarOTP] = useState("");
  const [personName, setPersonName] = useState(""); // Default name, can be updated after OTP verification

  useEffect(() => {
    const fetchAllData = async () => {
      try {
        const infuraProvider = new ethers.JsonRpcProvider(
          import.meta.env.VITE_INFURA_URL
        );
        const Landcontratcget = new ethers.Contract(
          import.meta.env.VITE_CONTRACT_DEPOLY_ADDRESS,
          contract.abi,
          infuraProvider
        );

        const depocontract = await Landcontratcget.filters.SaveLandRegistry();
        const latestBlock = await infuraProvider.getBlockNumber();
        const deployBlock = Number(import.meta.env.VITE_CONTRACT_DEPLOY_BLOCK || 11348788);

        const event = await getLogsInChunks(Landcontratcget, depocontract, deployBlock, latestBlock);
        let currentUserWallet = "";
        if (window.ethereum) {
          const accounts = await window.ethereum.request({ method: "eth_accounts" });
          if (accounts.length > 0) currentUserWallet = accounts[0].toLowerCase();
        }
        if (event.length > 0) {
          // Use Promise.all because we are making async contract calls inside the map
          const parsedAssets = await Promise.all(event.map(async (e, index) => {
            const raw = e.args;
            const rawCoords = [raw[2], raw[3], raw[4], raw[5]].map(getRawCoordinate);
            const registryWallet = raw[11];

            const childContractInstance = new ethers.Contract(
              registryWallet,
              childContract.abi,
              infuraProvider
            );

            // 💡 NEW: Fetch the CURRENT state variables from the contract
            const liveOwner = await childContractInstance.Owner();
            const liveAadhaarHash = await childContractInstance.AadhaarHash();
            const liveFullName = await childContractInstance.FullName();

            return {
              id: e.transactionHash + "-" + index,
              rawCoordinates: rawCoords,
              plotNoString: rawCoords.map((c, idx) => `P${idx + 1}: (${c[0].toFixed(5)}, ${c[1].toFixed(5)})`).join(" | "),
              price: ethers.formatEther(raw[6]),
              area: raw[7],
              location: raw[8],
              image: `https://amber-wonderful-kite-814.mypinata.cloud/ipfs/${raw[9]}`,
              registryWallet: registryWallet,

              // 💡 Override the historical event data with the LIVE data
              ownerName: liveFullName,
              currentAadhaarHash: liveAadhaarHash,
              currentOwnerWallet: liveOwner,
              isOwnedByMe: liveOwner.toLowerCase() === currentUserWallet
            };
          }));

          setmarketplaceAssets(parsedAssets);
        }
      } catch (error) {
        console.error("Error fetching marketplace data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []);

  // Open Modal & Reset Flow
  const handleBuyClick = (asset) => {
    setSelectedAsset(asset);
    setPurchaseStep("review");
    setBuyerAadhaar("");
    setIsModalOpen(true);
  };

  const handleAadhaarSubmit = async () => {
    if (buyerAadhaar.length !== 12) return alert("Please enter a valid 12-digit ID.");
    setPurchaseStep("processing");
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_SERVER_URL}/api/aadhar/send-otp`,
        {
          aadharNumber: buyerAadhaar,
        },
      );
      const refId = res.data?.data?.data?.reference_id;

      setReferenceId(refId);
      setPurchaseStep("otp");
    } catch (error) {
      console.error("Purchase Error:", error);
      alert(error.reason || "Transaction rejected or failed. Check console.");
      setPurchaseStep("error");
    }
  }

  const handleAadhaarOTPSubmit = async () => {
    if (aadhaarOTP.length !== 6) return alert("Please enter a valid 6-digit OTP.");
    setPurchaseStep("processing");
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_SERVER_URL}/api/aadhar/verify-otp`,
        {
          reference_id: referenceId,
          otp: aadhaarOTP,
        },
      );
      const verified = res.data?.data?.verified;
      if (verified) {
        setPersonName(res.data?.data?.name || "Rakesh Kumar");
      }
      setPurchaseStep("buy");
    } catch (error) {
      console.error(error);
      alert(error.reason || "Transaction rejected or failed. Check console.");
      setPurchaseStep("error");
    }
  }

  // 💡 EXECUTE REAL SMART CONTRACT TRANSACTION
  // 💡 EXECUTE REAL SMART CONTRACT TRANSACTION
  const executePurchase = async () => {
    if (buyerAadhaar.length !== 12) return alert("Please enter a valid 12-digit ID.");

    setPurchaseStep("processing");

    try {
      if (!window.ethereum) throw new Error("MetaMask is required to send transactions.");

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // 🛠️ FIX 1: Connect to the specific LandRegistry contract, not the Factory
      const landContract = new ethers.Contract(
        selectedAsset.registryWallet, // The address of the specific property
        childContract.abi,            // The ABI of the child contract
        signer
      );

      const buyerHashedId = keccak256(toUtf8Bytes(buyerAadhaar));
      const valueInWei = ethers.parseEther(selectedAsset.price);

      // 🛠️ FIX 2: Pass the correct arguments matching your Solidity function:
      // buyLand(string memory _newFullName, bytes32 _newAadhaarHash)

      // Note: You will need to add an input field in your UI to capture the buyer's name, 
      // or replace "New Owner Name" with a state variable like `buyerName`.
      const tx = await landContract.buyLand(
        personName, // Update this to dynamically pass the buyer's real name
        buyerHashedId,
        { value: valueInWei }
      );

      await tx.wait();

      setPurchaseStep("success");

    } catch (error) {
      console.error("Purchase Error:", error);
      alert(error.reason || "Transaction rejected or failed. Check console.");
      setPurchaseStep("error");
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F0F0] text-[#121212] font-['Outfit'] flex flex-col relative">
      <Navbar />

      <main className="grow p-6 md:p-12 lg:p-20">
        <div className="max-w-7xl mx-auto">
          {/* Header Section */}
          <div className="mb-12 border-b-8 border-black pb-8 flex flex-col md:flex-row justify-between items-end gap-6">
            <div>
              <div className="inline-block bg-[#D02020] text-white px-4 py-1 font-black uppercase tracking-[0.2em] text-xs mb-4 shadow-[3px_3px_0px_0px_black]">
                Fractional Land Market
              </div>
              <h1 className="text-6xl md:text-8xl font-black uppercase tracking-tighter leading-none">
                Trade <span className="text-[#1040C0]">Land.</span>
              </h1>
            </div>
            <div className="max-w-xs text-right">
              <p className="font-bold uppercase text-sm text-gray-500 leading-tight mb-2">
                Secure Indian Real Estate on a Decentralized Ledger.
              </p>
              <span className="bg-[#F0C020] px-3 py-1 border-2 border-black font-black text-xs uppercase shadow-[3px_3px_0px_0px_black]">
                Currency: ETH (Ξ)
              </span>
            </div>
          </div>

          {/* TABLE CONTAINER */}
          <div className="bg-white border-4 border-black shadow-[12px_12px_0px_0px_black] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#121212] text-white uppercase tracking-[0.2em] text-xs">
                  <th className="p-6 border-r border-white/20">Property Asset</th>
                  <th className="p-6 border-r border-white/20">Ownership</th>
                  <th className="p-6 border-r border-white/20 text-center">Valuation</th>
                  <th className="p-6 text-center">Transaction</th>
                </tr>
              </thead>
              <tbody className="divide-y-4 divide-black">
                {isLoading ? (
                  <tr>
                    <td colSpan="4" className="p-12 text-center font-black uppercase animate-pulse">
                      Syncing Decentralized Ledger...
                    </td>
                  </tr>
                ) : marketplaceAssets.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="p-12 text-center font-black uppercase text-[#D02020]">
                      No properties found on the network.
                    </td>
                  </tr>
                ) : (
                  marketplaceAssets.map((item, i) => (
                    <tr key={i} className="hover:bg-[#F0C020]/5 transition-colors group">
                      <td className="p-6 border-r-4 border-black">
                        <div className="flex items-center gap-5">
                          {/* <div className="w-24 h-24 border-4 border-black shrink-0 overflow-hidden bg-gray-100 rotate-2 group-hover:rotate-0 transition-transform">
                            <img src={item.image} alt="land" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                          </div> */}
                          <div>
                            <p className="font-black text-xs uppercase leading-none mb-2 wrap-break-word max-w-50">
                              {item.plotNoString}
                            </p>
                            <div className="flex items-center gap-1 text-xs font-black text-[#1040C0] uppercase tracking-tighter">
                              <MapPin className="w-3 h-3" />
                              {item.location}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-6 border-r-4 border-black">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-[#121212] border-2 border-white rounded-none flex items-center justify-center text-white">
                              <User className="w-4 h-4" />
                            </div>
                            <span className="font-black uppercase text-sm tracking-tight">{item.ownerName}</span>
                          </div>
                          <div className="inline-block bg-[#F0C020]/20 border-2 border-black px-3 py-1 text-[10px] font-black uppercase">
                            Area: {item.area}
                          </div>
                        </div>
                      </td>
                      <td className="p-6 border-r-4 border-black text-center">
                        <div className="flex flex-col items-center">
                          <div className="flex items-center text-3xl font-black tracking-tighter">
                            {item.price} ETH
                          </div>
                        </div>
                      </td>
                      <td className="p-6 text-center">
                        {item.isOwnedByMe ? (
                          /* 
                            Using standard CSS styling here for the ownership badge 
                            to ensure it stands out from the rest of the layout.
                          */
                          <div style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            backgroundColor: "#20B040",
                            color: "white",
                            padding: "12px 24px",
                            border: "4px solid black",
                            fontWeight: "900",
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                            boxShadow: "6px 6px 0px 0px #121212"
                          }}>
                            <CheckCircle2 style={{ width: "20px", height: "20px" }} />
                            Asset Secured
                          </div>
                        ) : (
                          <button
                            onClick={() => handleBuyClick(item)}
                            className="bg-[#1040C0] text-white border-4 border-black px-8 py-4 font-black uppercase tracking-widest text-sm shadow-[6px_6px_0px_0px_#D02020] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all flex items-center gap-2 mx-auto active:bg-[#121212]"
                          >
                            <ShoppingCart className="w-4 h-4" />
                            Acquire Asset
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <Footer />

      {/* 🛑 DYNAMIC PURCHASE MODAL OVERLAY 🛑 */}
      {isModalOpen && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-white border-8 border-black w-full max-w-5xl shadow-[16px_16px_0px_0px_#F0C020] flex flex-col md:flex-row relative animate-in fade-in zoom-in duration-300">

            {/* Close Button - Hide during processing/success */}
            {purchaseStep !== "processing" && purchaseStep !== "success" && (
              <button
                onClick={() => setIsModalOpen(false)}
                className="absolute -top-5 -right-5 bg-[#D02020] text-white border-4 border-black p-2 hover:bg-[#121212] transition-colors z-10"
              >
                <X className="w-6 h-6" />
              </button>
            )}

            {/* Left Side: Leaflet Map (Hidden on Success screen for emphasis) */}
            {purchaseStep !== "success" && (
              <div className="h-64 md:h-auto md:w-1/2 border-b-8 md:border-b-0 md:border-r-8 border-black relative z-0">
                <MapContainer
                  center={[20.5937, 78.9629]}
                  zoom={5}
                  zoomControl={false}
                  scrollWheelZoom={false}
                  style={{ height: "100%", width: "100%", minHeight: "350px" }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  <ModalMapBounds coordinates={selectedAsset.rawCoordinates} />
                  <Polygon
                    positions={selectedAsset.rawCoordinates}
                    pathOptions={{ color: '#121212', weight: 4, fillColor: '#D02020', fillOpacity: 0.6 }}
                  />
                </MapContainer>
              </div>
            )}

            {/* Right Side: Dynamic Content Area */}
            <div className={`p-8 ${purchaseStep === "success" ? "w-full text-center" : "md:w-1/2"} flex flex-col justify-between bg-[#FFFFF4]`}>

              {/* STEP 1: REVIEW */}
              {purchaseStep === "review" && (
                <>
                  <div>
                    <h3 className="text-4xl font-black uppercase mb-4 leading-none border-b-4 border-black pb-4">
                      Review <br /><span className="text-[#1040C0]">Asset Data</span>
                    </h3>
                    <div className="space-y-4 mb-8">
                      <div>
                        <p className="text-[10px] font-black uppercase text-gray-500 mb-1">Current Owner</p>
                        <p className="font-bold text-xl uppercase truncate">{selectedAsset.ownerName}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase text-gray-500 mb-1">Total Valuation</p>
                        <p className="text-5xl font-black">{selectedAsset.price} <span className="text-xl">ETH</span></p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setPurchaseStep("aadhaar")}
                    className="w-full bg-[#121212] text-white border-4 border-black p-5 font-black uppercase text-xl hover:bg-[#F0C020] hover:text-black transition-colors"
                  >
                    Confirm Purchase
                  </button>
                </>
              )}

              {/* STEP 2: ENTER AADHAAR */}
              {purchaseStep === "aadhaar" && (
                <>
                  <div>
                    <h3 className="text-4xl font-black uppercase mb-4 leading-none border-b-4 border-black pb-4">
                      Verify <br /><span className="text-[#D02020]">Identity</span>
                    </h3>
                    <p className="text-sm font-bold text-gray-500 uppercase mb-6">
                      Enter your 12-digit ID to permanently link this land deed to your identity hash.
                    </p>
                    <input
                      type="text"
                      maxLength={12}
                      placeholder="Enter 12-Digit Number"
                      value={buyerAadhaar}
                      onChange={(e) => setBuyerAadhaar(e.target.value.replace(/\D/g, ""))}
                      className="w-full p-4 border-4 border-black bg-white text-2xl font-black text-center focus:outline-none focus:bg-[#F0C020]/10 mb-8"
                    />
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setPurchaseStep("review")}
                      className="w-1/3 bg-white text-black border-4 border-black p-4 font-black uppercase text-sm hover:bg-gray-100 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleAadhaarSubmit}
                      className="w-2/3 bg-[#1040C0] text-white border-4 border-black p-4 font-black uppercase text-xl hover:bg-[#121212] transition-colors"
                    >
                      Send OTP
                    </button>
                  </div>
                </>
              )}

              {/* STEP 2: ENTER OTP */}
              {purchaseStep === "otp" && (
                <>
                  <div>
                    <h3 className="text-4xl font-black uppercase mb-4 leading-none border-b-4 border-black pb-4">
                      Verify <br /><span className="text-[#D02020]">Aadhaar OTP</span>
                    </h3>
                    <p className="text-sm font-bold text-gray-500 uppercase mb-6">
                      Enter your 6-digit OTP to permanently link this land deed to your identity hash.
                    </p>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="Enter 6-Digit OTP"
                      value={aadhaarOTP}
                      onChange={(e) => setAadhaarOTP(e.target.value.replace(/\D/g, ""))}
                      className="w-full p-4 border-4 border-black bg-white text-2xl font-black text-center focus:outline-none focus:bg-[#F0C020]/10 mb-8"
                    />
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={() => setPurchaseStep("review")}
                      className="w-1/3 bg-white text-black border-4 border-black p-4 font-black uppercase text-sm hover:bg-gray-100 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={handleAadhaarOTPSubmit}
                      className="w-2/3 bg-[#1040C0] text-white border-4 border-black p-4 font-black uppercase text-xl hover:bg-[#121212] transition-colors"
                    >
                      Verify OTP
                    </button>
                  </div>
                </>
              )}

              {/* STEP 2: ENTER OTP */}
              {purchaseStep === "buy" && (
                <>
                  <div className="text-center py-10 animate-in zoom-in-95 duration-500">
                  <div className="w-24 h-24 bg-[#1040C0] border-4 border-black rounded-full flex items-center justify-center mx-auto mb-8 shadow-[8px_8px_0px_0px_black]">
                    <CheckCircle2 className="w-12 h-12 text-white stroke-3" />
                  </div>
                  <h3 className="text-4xl font-black uppercase tracking-tighter leading-none mb-4">
                    Identity <br /> Confirmed
                  </h3>
                  <p className="text-sm font-bold text-gray-600 mb-10 tracking-tight">
                    Your credentials have been matched successfully with the
                    UIDAI registry.
                  </p>
                  
                    <button onClick={executePurchase} className="w-full py-4 bg-black text-white border-4 border-black font-black uppercase tracking-[0.2em] shadow-[6px_6px_0px_0px_#1040C0] hover:-translate-y-1 active:translate-y-0 transition-all">
                      Pay {selectedAsset.price} ETH
                    </button>
                  
                </div>
                </>
              )}

              {/* STEP 3: PROCESSING */}
              {purchaseStep === "processing" && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-16 h-16 border-8 border-black border-t-[#1040C0] rounded-none animate-spin mb-8" />
                  <h3 className="text-2xl font-black uppercase animate-pulse">Awaiting MetaMask...</h3>
                  <p className="text-sm font-bold text-gray-500 uppercase mt-4">
                    Please approve the transaction in your wallet.<br />Do not close this window.
                  </p>
                </div>
              )}

              {/* STEP 4: SUCCESS */}
              {purchaseStep === "success" && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12 animate-in slide-in-from-bottom-4">
                  <CheckCircle2 className="w-32 h-32 text-[#20B040] mb-6 drop-shadow-[8px_8px_0px_rgba(0,0,0,1)]" />
                  <h2 className="text-6xl font-black uppercase tracking-tighter mb-4 text-[#20B040]">
                    Asset Acquired!
                  </h2>
                  <p className="text-xl font-bold uppercase mb-8 border-4 border-black p-4 bg-white inline-block">
                    Property <span className="text-[#1040C0]">{selectedAsset.id.substring(0, 8)}...</span> is now recorded on the ledger.
                  </p>
                  <button
                    onClick={() => {
                      setIsModalOpen(false);
                      window.location.reload(); // Refresh to update table ownership
                    }}
                    className="bg-[#121212] text-white border-4 border-black px-12 py-5 font-black uppercase tracking-widest text-xl shadow-[8px_8px_0px_0px_#F0C020] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all"
                  >
                    Return to Marketplace
                  </button>
                </div>
              )}

              {purchaseStep === "error" && (
                <div className="text-center py-10 animate-in shake">
                  <div className="w-24 h-24 bg-[#D02020] border-4 border-black flex items-center justify-center mx-auto mb-8 shadow-[8px_8px_0px_0px_black] rotate-3">
                    <XCircle className="w-12 h-12 text-white stroke-3" />
                  </div>
                  <h3 className="text-4xl font-black uppercase tracking-tighter leading-none mb-4">
                    Verification <br /> Failed
                  </h3>
                  <p className="text-sm font-bold text-gray-600 mb-10">
                    The information provided does not match our security
                    parameters.
                  </p>
                  <button
                    onClick={() => setPurchaseStep("review")}
                    className="w-full py-4 bg-[#F0C020] border-4 border-black font-black uppercase tracking-[0.2em] shadow-[6px_6px_0px_0px_black] active:translate-y-1 transition-all"
                  >
                    Restart
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SliceBuy;