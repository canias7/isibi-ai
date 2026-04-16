import { useState, useEffect, useCallback, useRef } from "react";

interface TourStep {
  selector: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: "[data-tour='chat-input']",
    title: "Chat Input",
    description: "Describe what you want to build here. Try 'Build me a CRM for real estate'",
  },
  {
    selector: "[data-tour='template-cards']",
    title: "Templates",
    description: "Or pick a template to get started instantly",
  },
  {
    selector: "[data-tour='model-selector']",
    title: "Model Selector",
    description: "Choose your AI model. Anias 1.0 builds software.",
  },
  {
    selector: "[data-tour='sidebar-nav']",
    title: "Sidebar",
    description: "Your projects appear here. Click to switch between them.",
  },
  {
    selector: "[data-tour='profile-menu']",
    title: "Profile Menu",
    description: "Manage your account, billing, and settings here.",
  },
];

interface TourOverlayProps {
  onComplete: () => void;
}

export function TourOverlay({ onComplete }: TourOverlayProps) {
  const [step, setStep] = useState(-1); // -1 = welcome modal
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updateTargetRect = useCallback(() => {
    if (step < 0 || step >= TOUR_STEPS.length) return;
    const el = document.querySelector(TOUR_STEPS[step].selector);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    }
  }, [step]);

  useEffect(() => {
    updateTargetRect();
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect, true);
    return () => {
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect, true);
    };
  }, [updateTargetRect]);

  const handleSkip = () => {
    localStorage.setItem("onboarding_completed", "true");
    onComplete();
  };

  const handleNext = () => {
    if (step >= TOUR_STEPS.length - 1) {
      localStorage.setItem("onboarding_completed", "true");
      onComplete();
    } else {
      setStep(step + 1);
    }
  };

  const handleStartTour = () => {
    setStep(0);
  };

  // Welcome modal
  if (step === -1) {
    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.5)" }}
      >
        <div
          className="w-[400px] max-w-[90vw] rounded-2xl bg-white p-8 shadow-2xl text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-black">
            <span className="text-xl font-bold text-white">i</span>
          </div>
          <h2 className="text-xl font-bold text-black">Welcome to isibi.ai!</h2>
          <p className="mt-2 text-sm text-gray-500">
            Let me show you around. It only takes a moment.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={handleSkip}
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Skip
            </button>
            <button
              onClick={handleStartTour}
              className="flex-1 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              Start Tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Tour step with spotlight
  const currentStep = TOUR_STEPS[step];
  const isLastStep = step === TOUR_STEPS.length - 1;
  const padding = 8;

  // Calculate tooltip position
  let tooltipStyle: React.CSSProperties = {};
  if (targetRect) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const tooltipWidth = 320;
    const tooltipHeight = 140;

    // Default: below the target
    let top = targetRect.bottom + padding + 8;
    let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;

    // If tooltip goes below viewport, put it above
    if (top + tooltipHeight > viewportHeight - 20) {
      top = targetRect.top - tooltipHeight - padding - 8;
    }

    // Keep within horizontal bounds
    if (left < 16) left = 16;
    if (left + tooltipWidth > viewportWidth - 16) left = viewportWidth - tooltipWidth - 16;

    tooltipStyle = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${tooltipWidth}px`,
    };
  }

  return (
    <div className="fixed inset-0 z-[200]" style={{ pointerEvents: "none" }}>
      {/* Dark overlay with cutout */}
      <svg
        className="fixed inset-0"
        width="100%"
        height="100%"
        style={{ pointerEvents: "auto" }}
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - padding}
                y={targetRect.top - padding}
                width={targetRect.width + padding * 2}
                height={targetRect.height + padding * 2}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Spotlight border ring */}
      {targetRect && (
        <div
          className="fixed rounded-xl border-2 border-pink-500 transition-all duration-300"
          style={{
            top: targetRect.top - padding,
            left: targetRect.left - padding,
            width: targetRect.width + padding * 2,
            height: targetRect.height + padding * 2,
            boxShadow: "0 0 0 4px rgba(236,72,153,0.2)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Tooltip */}
      {targetRect && (
        <div
          ref={tooltipRef}
          className="rounded-xl bg-white p-4 shadow-2xl border border-gray-200"
          style={{ ...tooltipStyle, pointerEvents: "auto" }}
        >
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-pink-600">
              Step {step + 1} of {TOUR_STEPS.length}
            </p>
            <div className="flex gap-1">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full transition ${
                    i === step ? "bg-pink-500" : i < step ? "bg-pink-300" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
          </div>
          <h3 className="text-sm font-bold text-black">{currentStep.title}</h3>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed">
            {currentStep.description}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSkip}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-50"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="flex-1 rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-800"
            >
              {isLastStep ? "Get Started!" : "Next"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
