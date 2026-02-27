"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type FaceLandmarkerType = any;
type FilesetResolverType = any;

type AppState = "landing" | "camera" | "analyzing" | "result";

interface AnalysisResult {
  baselineScore: number;
  currentScore: number;
  deltaPercent: number;
  improved: boolean;
  isFirstTime: boolean;
}

const LOCAL_STORAGE_KEY = "sleepglow_baseline_score";
const HISTORY_STORAGE_KEY = "sleepglow_history_v1";

interface HistoryEntry {
  date: string;
  deltaPercent: number;
  isFirst: boolean;
}

export default function SleepGlowPage() {
  const [appState, setAppState] = useState<AppState>("landing");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const faceLandmarkerRef = useRef<FaceLandmarkerType | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRequestingCamera, setIsRequestingCamera] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false); 

  useEffect(() => {
    let cancelled = false;

    const loadModel = async () => {
      try {
        const visionModule = await import("@mediapipe/tasks-vision");
        const { FilesetResolver, FaceLandmarker } = visionModule as {
          FilesetResolver: FilesetResolverType;
          FaceLandmarker: FaceLandmarkerType;
        };

        const filesetResolver = await (FilesetResolver as any).forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );

        const landmarker = await (FaceLandmarker as any).createFromOptions(
          filesetResolver,
          {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
              delegate: "GPU"
            },
            runningMode: "VIDEO",
            numFaces: 1
          }
        );

        if (!cancelled) {
          faceLandmarkerRef.current = landmarker;
          setModelLoaded(true);
        }
      } catch (err) {
        console.error("加载 MediaPipe 模型失败:", err);
        if (!cancelled) setModelError("AI 模型加载失败，请检查网络后重试。");
      }
    };

    loadModel();

    return () => {
      cancelled = true;
      if (faceLandmarkerRef.current?.close) faceLandmarkerRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw) as HistoryEntry[]);
    } catch {}
  }, []);

  useEffect(() => {
    if (appState !== "camera") {
      setIsVideoReady(false);
      return;
    }
    
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("当前浏览器不支持摄像头，请更换。");
      return;
    }

    let isActive = true;
    let stream: MediaStream | null = null;
    setIsRequestingCamera(true);
    setCameraError(null);
    setIsVideoReady(false); 

    const startCamera = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!isActive) return;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });

        if (!isActive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = stream;
          videoEl.onloadedmetadata = () => {
            if (isActive) {
              videoEl.play()
                .then(() => { if (isActive) setIsVideoReady(true); })
                .catch((e) => console.error("播放被拦截:", e));
            }
          };
        }
      } catch (err) {
        console.error("摄像头访问失败:", err);
        if (isActive) setCameraError("无法访问摄像头，请检查系统权限。");
      } finally {
        if (isActive) setIsRequestingCamera(false);
      }
    };

    startCamera();

    return () => {
      isActive = false;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [appState]);

  const computeUnderEyeBrightness = (
    canvas: HTMLCanvasElement,
    landmarks: Array<{ x: number; y: number; z: number }>
  ): number => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    const width = canvas.width, height = canvas.height;

    let minY = 1, maxY = 0;
    for (const p of landmarks) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const faceHeightNorm = Math.max(0.2, maxY - minY);
    const roiOffsetNorm = faceHeightNorm * 0.06;
    const roiHeightNorm = faceHeightNorm * 0.09;
    const roiWidthNorm = faceHeightNorm * 0.12;

    const LEFT_EYE_UNDER_INDICES = [145, 159, 160, 144];
    const RIGHT_EYE_UNDER_INDICES = [374, 386, 387, 380];

    const sampleRegionBrightness = (indices: number[]): number | null => {
      const points = indices.map((idx) => landmarks[idx]).filter(Boolean);
      if (points.length === 0) return null;

      let minX = 1, maxX = 0, maxYLocal = 0;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxYLocal) maxYLocal = p.y;
      }

      const centerXNorm = (minX + maxX) / 2;
      const centerYNorm = maxYLocal + roiOffsetNorm;
      const roiWidthPx = roiWidthNorm * width;
      const roiHeightPx = roiHeightNorm * height;

      const x = Math.max(0, Math.floor(centerXNorm * width - roiWidthPx / 2));
      const y = Math.max(0, Math.floor(centerYNorm * height - roiHeightPx / 2));
      const w = Math.min(roiWidthPx, width - x);
      const h = Math.min(roiHeightPx, height - y);

      if (w <= 1 || h <= 1) return null;
      const data = ctx.getImageData(x, y, w, h).data;
      let brightnessSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        brightnessSum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      return brightnessSum / (data.length / 4);
    };

    const left = sampleRegionBrightness(LEFT_EYE_UNDER_INDICES);
    const right = sampleRegionBrightness(RIGHT_EYE_UNDER_INDICES);
    if (left !== null && right !== null) return (left + right) / 2;
    return left ?? right ?? 0;
  };

  const calculateDelta = (baseline: number, current: number) => {
    if (baseline <= 0) return { deltaPercent: 0, improved: false };
    const delta = ((current - baseline) / baseline) * 100;
    return { deltaPercent: Math.round(delta * 10) / 10, improved: current > baseline };
  };

  const handleCaptureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current || !faceLandmarkerRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError("画面未完全就绪，请稍等。");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.filter = "none";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setAppState("analyzing");

    setTimeout(async () => {
      try {
        const result = await (faceLandmarkerRef.current as any).detectForVideo(canvas, performance.now());
        const firstFaceLandmarks = result?.faceLandmarks?.[0];

        if (!firstFaceLandmarks) {
          setCameraError("未检测到清晰人脸，请调整光线后重试。");
          setAppState("camera");
          return;
        }

        const currentBrightness = computeUnderEyeBrightness(canvas, firstFaceLandmarks);
        const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        let baseline = stored && !Number.isNaN(Number(stored)) ? Number(stored) : null;
        const todayKey = new Date().toISOString().slice(0, 10);
        let finalResult: AnalysisResult;
        
        let newHistory = history.filter((h) => h.date !== todayKey);

        if (baseline === null) {
          baseline = currentBrightness;
          window.localStorage.setItem(LOCAL_STORAGE_KEY, String(baseline));
          finalResult = { baselineScore: baseline, currentScore: currentBrightness, deltaPercent: 0, improved: false, isFirstTime: true };
          newHistory.push({ date: todayKey, deltaPercent: 0, isFirst: true });
        } else {
          const { deltaPercent, improved } = calculateDelta(baseline, currentBrightness);
          finalResult = { baselineScore: baseline, currentScore: currentBrightness, deltaPercent, improved, isFirstTime: false };
          newHistory.push({ date: todayKey, deltaPercent, isFirst: false });
        }

        try {
          window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(newHistory));
          setHistory(newHistory);
        } catch {}

        setResult(finalResult);
        setAppState("result");
      } catch (err) {
        console.error("分析失败:", err);
        setCameraError("引擎计算异常，请重试。");
        setAppState("camera");
      }
    }, 150);
  };

  const handleSaveCard = () => {
    if (!result) return;
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgGradient = ctx.createLinearGradient(0, 0, 600, 600);
    bgGradient.addColorStop(0, "#f5f5f4");
    bgGradient.addColorStop(1, "#e7e5e4");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, 600, 600);

    for (let i = 0; i < 4; i++) {
      const r = 120 + i * 26;
      const gradient = ctx.createRadialGradient(300, 272, r * 0.2, 300, 272, r);
      gradient.addColorStop(0, `rgba(214, 211, 209, ${0.3 - i * 0.06})`);
      gradient.addColorStop(1, "rgba(245, 245, 244, 0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(300, 272, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#292524";
    ctx.font = "28px system-ui, sans-serif";
    ctx.textAlign = "center";
    const dateText = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
    ctx.fillText(`见微 · 今日元气日签`, 300, 420);
    ctx.fillStyle = "#78716c";
    ctx.fillText(dateText, 300, 460);
    ctx.font = "22px system-ui, sans-serif";
    const desc = result.isFirstTime ? "已记录你的眼周基线光度，明天来看看微小的变化。" : 
                 result.improved ? `眼周通透度比基线提升了 ${result.deltaPercent}%` : 
                 `眼周通透度相较基线变化为 ${result.deltaPercent}%`;
    ctx.fillText(desc, 300, 510);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `SleepGlow_${dateText}.png`;
    link.click();
  };

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#fafaf9] text-stone-800 font-sans">
      <AnimatePresence mode="wait">
        
        {appState === "landing" && (
          <motion.section key="landing" className="relative flex min-h-screen items-center justify-center px-6 py-12" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}>
            <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#e7e5e4] blur-[120px] opacity-70" />
            <div className="pointer-events-none absolute bottom-[-6rem] right-[-4rem] h-[28rem] w-[28rem] rounded-full bg-[#f5f5f4] blur-[130px] opacity-80" />
            <div className="relative w-full max-w-3xl glass-panel rounded-3xl px-10 py-12 shadow-[0_8px_40px_rgba(28,25,23,0.04)] border border-white/80">
              <div className="space-y-10">
                <div className="space-y-5">
                  <p className="text-xs tracking-[0.3em] uppercase text-stone-400">SleepGlow</p>
                  <h1 className="text-4xl md:text-5xl font-light tracking-wide text-stone-800">见微 · <span className="text-stone-600">看见眼周的细小、温柔的变化</span></h1>
                  <p className="text-sm md:text-base leading-relaxed text-stone-500 max-w-xl">每天早上花半分钟，借助本地运行的模型，轻轻记录眼下区域亮度的微小波动。</p>
                </div>
                <div className="rounded-2xl border border-stone-200/60 bg-white/40 px-5 py-4 text-xs text-stone-500 flex flex-col gap-2">
                  <p className="font-medium text-stone-700">隐私承诺 · 纯本地运算</p>
                  <p>· 画面仅存于内存中用于测算，我们只保存极简的亮度波动数字，绝不上传照片。</p>
                </div>
                <div className="flex flex-col gap-4 pt-4 md:flex-row md:items-center md:justify-between">
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} 
                    onClick={() => setAppState("camera")} 
                    className="rounded-full bg-stone-800 px-9 py-3.5 text-sm font-medium text-stone-50 hover:bg-stone-700 shadow-sm transition-all duration-300">
                    开始今日元气扫描
                  </motion.button>
                  <p className="text-[11px] text-stone-400">首屏加载 AI 可能需数秒，请稍候。</p>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {appState === "camera" && (
          <motion.section key="camera" className="relative flex min-h-screen items-center justify-center px-4 py-10" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}>
            <div className="pointer-events-none absolute -left-32 -top-24 h-80 w-80 rounded-full bg-[#f5f5f4] blur-[120px] opacity-70" />
            <div className="pointer-events-none absolute bottom-[-5rem] right-[-3rem] h-96 w-96 rounded-full bg-[#e7e5e4] blur-[120px] opacity-70" />
            <div className="relative w-full max-w-2xl glass-panel rounded-3xl px-6 py-8 md:px-10 md:py-10 shadow-[0_8px_40px_rgba(28,25,23,0.04)] border border-white/80">
              <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between text-xs text-stone-400">
                  <button onClick={() => window.location.reload()} className="hover:text-stone-800 transition-colors">← 返回</button>
                  <p>{modelLoaded ? "AI 模型已就绪" : "AI 模型加载中…"}</p>
                </div>
                <div className="flex flex-col gap-5 md:flex-row md:items-stretch md:gap-8">
                  <div className="relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-white/60 bg-white/30">
                    <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
                    <div className="absolute inset-0 bg-white/20 backdrop-blur-[6px]" />
                    <div className="pointer-events-none absolute inset-0 border border-white/60 rounded-3xl" />
                    <div className="pointer-events-none absolute inset-x-12 top-1/2 h-px bg-gradient-to-r from-transparent via-stone-300/50 to-transparent" />
                  </div>
                  <div className="flex flex-col justify-between gap-5 md:w-64">
                    <div className="space-y-3 text-xs text-stone-500">
                      <p className="font-medium text-stone-800">小提示 · 晨光检查</p>
                      <p className="leading-relaxed">脸部居中，视线略微向前。测算结束即刻销毁画面。</p>
                    </div>
                    {cameraError && <p className="text-xs text-red-800/80 bg-red-50 border border-red-100/50 rounded-2xl px-4 py-3">{cameraError}</p>}
                    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={handleCaptureAndAnalyze}
                      disabled={!modelLoaded || isRequestingCamera || !isVideoReady || !!cameraError}
                      className="rounded-full px-7 py-3.5 text-sm font-medium transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed bg-stone-800 text-stone-50 hover:bg-stone-700 shadow-sm">
                      {isRequestingCamera || !isVideoReady ? "镜头唤醒中..." : !modelLoaded ? "AI 加载中..." : "按下快门 · 记录"}
                    </motion.button>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {appState === "analyzing" && (
          <motion.section key="analyzing" className="relative flex min-h-screen items-center justify-center px-6 py-10" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
            <div className="pointer-events-none absolute -left-32 -top-24 h-80 w-80 rounded-full bg-[#f5f5f4] blur-[120px] opacity-70" />
            <div className="pointer-events-none absolute bottom-[-5rem] right-[-4rem] h-96 w-96 rounded-full bg-[#e7e5e4] blur-[120px] opacity-70" />
            <div className="relative w-full max-w-sm glass-panel rounded-3xl px-8 py-10 shadow-[0_8px_40px_rgba(28,25,23,0.04)] border border-white/80">
              <div className="flex flex-col items-center gap-8">
                <div className="relative h-40 w-40">
                  <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,1),transparent_60%),radial-gradient(circle_at_70%_80%,rgba(231,229,228,0.6),transparent_60%)] blur-2xl" />
                  <div className="absolute inset-[18%] rounded-full border border-white/60 bg-white/40 backdrop-blur-md" />
                  <div className="absolute inset-[30%] rounded-full border border-dashed border-stone-300/50" />
                </div>
                <div className="space-y-3 text-center">
                  <p className="text-sm font-medium text-stone-800">读取眼周微光纹理中…</p>
                  <p className="text-xs text-stone-400">纯本地计算，约 1–2 秒</p>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {appState === "result" && result && (
          <motion.section key="result" className="relative flex min-h-screen items-center justify-center px-6 py-10" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4 }}>
            <div className="pointer-events-none absolute -left-28 -top-24 h-96 w-96 rounded-full bg-[#f5f5f4] blur-[120px] opacity-70" />
            <div className="pointer-events-none absolute bottom-[-5rem] right-[-4rem] h-[28rem] w-[28rem] rounded-full bg-[#e7e5e4] blur-[130px] opacity-80" />
            <div className="relative w-full max-w-2xl glass-panel rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-[0_8px_40px_rgba(28,25,23,0.04)] border border-white/80">
              <div className="flex flex-col gap-8">
                <div className="flex items-center justify-between text-xs text-stone-400">
                  {/* PM 核武器：直接强行重置整个网页，不留任何硬件隐患 */}
                  <button onClick={() => window.location.reload()} className="hover:text-stone-800 transition-colors">← 再测一次</button>
                  <span>SleepGlow · 只看变化</span>
                </div>
                <div className="flex flex-col items-center gap-8 md:flex-row md:items-center md:gap-12">
                  <div className="relative h-40 w-40 md:h-48 md:w-48">
                    <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,1),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(231,229,228,0.7),transparent_55%)] blur-2xl" />
                    <div className="absolute inset-[16%] rounded-full bg-white/50 border border-white/60 backdrop-blur-md" />
                    <div className="absolute inset-[30%] rounded-full border border-dashed border-stone-300/50" />
                    <div className="absolute inset-[38%] flex items-center justify-center">
                      <span className="text-[11px] text-stone-500 tracking-wider">{result.isFirstTime ? "Day 1" : "Δ 变化量"}</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-4 text-left">
                    <p className="text-sm font-medium text-stone-800">
                      {result.isFirstTime ? "捕捉到基线光度" : (result.improved && result.deltaPercent > 0) ? "元气悄悄回升" : (!result.improved && result.deltaPercent < 0) ? "也许昨晚没睡好" : "与基线持平"}
                    </p>
                    {result.isFirstTime ? (
                      <p className="text-xs text-stone-500 leading-relaxed">明天我们只看变化的方向与幅度（Δ）。</p>
                    ) : (
                      <>
                        <p className="text-4xl font-light tracking-wide text-stone-800">{result.deltaPercent > 0 ? "+" : ""}{result.deltaPercent}<span className="text-lg text-stone-400 ml-1">%</span></p>
                        <p className="text-xs text-stone-500 leading-relaxed">{result.improved ? "眼周通透度提升，微光正在被存起来。" : "请相信，休息好的一晚就能让元气回来。"}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-3 pt-2 md:flex-row md:items-center md:justify-between">
                  <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={handleSaveCard} className="rounded-full bg-stone-800 text-stone-50 px-8 py-3.5 text-sm font-medium hover:bg-stone-700 shadow-sm transition-all duration-300">
                    保存今日元气日签
                  </motion.button>
                  <button onClick={() => window.location.reload()} className="text-xs text-stone-400 hover:text-stone-800 transition-colors">返回首页</button>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <canvas ref={canvasRef} className="hidden" />
      {modelError && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-full bg-stone-800 text-stone-50 text-xs shadow-lg">{modelError}</div>}
    </main>
  );
}