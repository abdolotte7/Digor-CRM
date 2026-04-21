import { useState, useEffect } from 'react';

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const sceneKeys = Object.keys(durations);
    
    if (typeof window !== 'undefined' && (window as any).startRecording) {
      (window as any).startRecording();
    }
    
    let hasLoggedStop = false;

    const playScene = (index: number) => {
      setCurrentScene(index);
      const key = sceneKeys[index];
      const duration = durations[key];
      
      timeout = setTimeout(() => {
        if (index + 1 < sceneKeys.length) {
          playScene(index + 1);
        } else {
          if (!hasLoggedStop && typeof window !== 'undefined' && (window as any).stopRecording) {
            (window as any).stopRecording();
            hasLoggedStop = true;
          }
          playScene(0); // loop
        }
      }, duration);
    };
    
    playScene(0);
    
    return () => clearTimeout(timeout);
  }, [durations]);

  return { currentScene };
}