"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSetupStatus } from "@/hooks/useSetupStatus";

function playSplashSounds() {
  try {
    const ctx = new AudioContext();

    // Whoosh: filtered noise sweep (0s to 1.5s)
    const whooshDuration = 1.8;
    const bufferSize = ctx.sampleRate * whooshDuration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * 0.3;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.Q.value = 2;
    whooshFilter.frequency.setValueAtTime(200, ctx.currentTime);
    whooshFilter.frequency.exponentialRampToValueAtTime(2000, ctx.currentTime + 0.8);
    whooshFilter.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + whooshDuration);

    const whooshGain = ctx.createGainNode();
    whooshGain.gain.setValueAtTime(0, ctx.currentTime);
    whooshGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.3);
    whooshGain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 1.0);
    whooshGain.gain.linearRampToValueAtTime(0, ctx.currentTime + whooshDuration);

    noiseSource.connect(whooshFilter);
    whooshFilter.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    noiseSource.start(ctx.currentTime + 0.1);
    noiseSource.stop(ctx.currentTime + whooshDuration + 0.1);

    // Landing chime: two soft tones at 2.8s (when logo settles)
    const chimeTime = ctx.currentTime + 2.8;

    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const chimeGain = ctx.createGainNode();
      chimeGain.gain.setValueAtTime(0, chimeTime + i * 0.12);
      chimeGain.gain.linearRampToValueAtTime(0.1, chimeTime + i * 0.12 + 0.05);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, chimeTime + i * 0.12 + 0.8);

      osc.connect(chimeGain);
      chimeGain.connect(ctx.destination);
      osc.start(chimeTime + i * 0.12);
      osc.stop(chimeTime + i * 0.12 + 0.8);
    });

    // Clean up after all sounds finish
    setTimeout(() => ctx.close(), 5000);
  } catch {
    // Audio not available, skip silently
  }
}

export default function Home() {
  const router = useRouter();
  const { status, loading } = useSetupStatus();
  const [animationDone, setAnimationDone] = useState(false);
  const [ready, setReady] = useState(false);

  // Auto-redirect returning users straight to dashboard
  useEffect(() => {
    if (!loading) {
      const seen = localStorage.getItem("postpilot_seen_splash");
      if (seen) {
        router.replace("/dashboard");
      } else {
        setReady(true);
      }
    }
  }, [loading, router]);

  // Mark animation done + play sounds
  useEffect(() => {
    const timer = setTimeout(() => setAnimationDone(true), 3200);

    // Play whoosh on flight start, chime on landing
    if (ready) {
      playSplashSounds();
    }

    return () => clearTimeout(timer);
  }, [ready]);

  function handleStart() {
    localStorage.setItem("postpilot_seen_splash", "true");
    if (status?.setup_complete) {
      router.push("/dashboard");
    } else {
      router.push("/setup");
    }
  }

  function handleSkip() {
    localStorage.setItem("postpilot_seen_splash", "true");
    router.push("/dashboard");
  }

  // Loading or redirecting
  if (loading || !ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-950 to-indigo-950">
        <div className="animate-spin w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-950 via-indigo-950 to-violet-950 animate-gradient overflow-hidden relative">
      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Landing glow */}
      <div className="absolute w-72 h-72 rounded-full bg-indigo-500/20 blur-[120px] animate-landing-glow" />

      {/* Trail ghosts (behind main logo, same flight path, staggered delays) */}
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={`absolute z-[${5 - i}] animate-trail-${i} pointer-events-none`}>
          <div
            className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center"
            style={{ opacity: 0.4 - i * 0.07, filter: `blur(${i * 2}px)`, transform: `scale(${1 - i * 0.08})` }}
          >
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </div>
        </div>
      ))}

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Main logo (flies in last, sharpest) */}
        <div className="animate-logo-flight mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-indigo-500/30">
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13" />
              <path d="M22 2L15 22L11 13L2 9L22 2Z" />
            </svg>
          </div>
        </div>

        <h1 className="animate-title-reveal text-4xl font-bold text-white tracking-tight">
          PostPilot
        </h1>

        <p className="animate-tagline text-sm text-indigo-300/70 mt-3 text-center max-w-xs">
          AI-powered LinkedIn content engine.<br />
          Source trends. Generate drafts. Publish on autopilot.
        </p>

        <div className="animate-button-rise flex flex-col items-center gap-3 mt-10">
          <button
            onClick={handleStart}
            className="group relative rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-[0.98]"
          >
            <span className="flex items-center gap-2">
              {status?.setup_complete ? "Go to Dashboard" : "Get Started"}
              <svg className="w-4 h-4 group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
          </button>

          {!status?.setup_complete && (
            <button
              onClick={handleSkip}
              className="text-xs text-indigo-400/50 hover:text-indigo-300/70 flex items-center gap-1"
            >
              Skip setup, explore first
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="absolute bottom-6 text-[10px] text-indigo-500/30 tracking-wider">
        v1.0
      </div>
    </div>
  );
}
