'use client';

import { useEffect, useState } from 'react';

interface CountdownProps {
  onComplete: () => void;
}

type CountdownStep = '3' | '2' | '1' | 'TOP!' | null;

const STEPS: CountdownStep[] = ['3', '2', '1', 'TOP!'];
const STEP_DURATION_MS = 1000; // 1 second per step

export default function Countdown({ onComplete }: CountdownProps) {
  const [currentStep, setCurrentStep] = useState<CountdownStep>('3');
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    let stepIndex = 0;

    const advanceStep = () => {
      stepIndex++;
      if (stepIndex < STEPS.length) {
        // Trigger re-animation by toggling
        setAnimating(false);
        // Small delay to reset animation
        setTimeout(() => {
          setCurrentStep(STEPS[stepIndex]);
          setAnimating(true);
        }, 50);
      } else {
        // Countdown complete
        setCurrentStep(null);
        onComplete();
      }
    };

    const timer = setInterval(advanceStep, STEP_DURATION_MS);

    return () => clearInterval(timer);
  }, [onComplete]);

  if (!currentStep) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        key={currentStep}
        className={`countdown-text ${animating ? 'countdown-animate' : ''}`}
      >
        {currentStep}
      </div>

      <style jsx>{`
        .countdown-text {
          font-size: 12rem;
          font-weight: bold;
          color: white;
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.5),
                       0 0 80px rgba(255, 255, 255, 0.3);
          opacity: 0;
          transform: scale(1.5);
        }

        .countdown-animate {
          animation: countdownPop 1s ease-out forwards;
        }

        @keyframes countdownPop {
          0% {
            opacity: 0;
            transform: scale(1.5);
          }
          20% {
            opacity: 1;
            transform: scale(1);
          }
          70% {
            opacity: 1;
            transform: scale(1);
          }
          100% {
            opacity: 0;
            transform: scale(0.8);
          }
        }
      `}</style>
    </div>
  );
}
