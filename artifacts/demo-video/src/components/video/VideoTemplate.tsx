import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video/hooks';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 4000, crm: 8000, tools: 8000, tech: 4000, close: 4000 };

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      {/* Persistent background layer */}
      <div className="absolute inset-0 z-0">
        <motion.div className="absolute w-[80vw] h-[80vw] rounded-full opacity-10 blur-3xl"
          style={{ background: 'radial-gradient(circle, #D4AF37, transparent)' }}
          animate={{ x: ['-10%', '30%', '-20%'], y: ['-20%', '10%', '-30%'], scale: [1, 1.2, 0.9] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute w-[60vw] h-[60vw] rounded-full opacity-10 blur-3xl right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #14b8a6, transparent)' }}
          animate={{ x: ['10%', '-20%', '0%'], y: ['10%', '-30%', '20%'] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }} />
        
        {/* Subtle grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '4vw 4vw' }} />
      </div>

      {/* Persistent midground layer */}
      <motion.div
        className="absolute h-[1px] bg-primary z-10"
        animate={{
          left: ['10%', '0%', '50%', '20%', '40%'][currentScene],
          width: ['80%', '100%', '30%', '60%', '20%'][currentScene],
          top: ['20%', '80%', '50%', '30%', '60%'][currentScene],
          opacity: 0.4,
        }}
        transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        className="absolute w-[1px] bg-accent z-10"
        animate={{
          left: ['80%', '20%', '80%', '10%', '50%'][currentScene],
          height: ['50%', '80%', '30%', '100%', '60%'][currentScene],
          top: ['10%', '10%', '35%', '0%', '20%'][currentScene],
          opacity: 0.3,
        }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Scene Content */}
      <AnimatePresence mode="popLayout">
        {currentScene === 0 && <Scene1 key="open" />}
        {currentScene === 1 && <Scene2 key="crm" />}
        {currentScene === 2 && <Scene3 key="tools" />}
        {currentScene === 3 && <Scene4 key="tech" />}
        {currentScene === 4 && <Scene5 key="close" />}
      </AnimatePresence>
    </div>
  );
}