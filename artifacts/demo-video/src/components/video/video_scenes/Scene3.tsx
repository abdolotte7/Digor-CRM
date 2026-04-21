import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3500),
      setTimeout(() => setPhase(4), 5500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-20"
      initial={{ opacity: 0, scale: 0.5, rotateX: -20 }}
      animate={{ opacity: 1, scale: 1, rotateX: 0 }}
      exit={{ opacity: 0, scale: 1.5, filter: 'blur(20px)' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.div 
        className="text-center mb-[4vh] relative z-20"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <h2 className="text-[3vw] font-display font-bold text-white drop-shadow-md">Digor Tools</h2>
        <p className="text-[1.2vw] text-accent mt-2 uppercase tracking-wider">Standalone Intelligence</p>
      </motion.div>

      <div className="relative w-[90vw] h-[65vh] flex items-center justify-center">
        {/* Tool 1: ARV Calculator */}
        <motion.div
          className="absolute w-[45vw]"
          initial={{ opacity: 0, x: -100, rotateY: 20 }}
          animate={phase >= 1 ? { 
            opacity: phase >= 2 ? 0.4 : 1, 
            x: phase >= 2 ? '-20vw' : 0, 
            scale: phase >= 2 ? 0.8 : 1,
            rotateY: phase >= 2 ? 10 : 0,
            zIndex: phase === 1 ? 30 : 10
          } : { opacity: 0, x: -100, rotateY: 20 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        >
          <img src={`${import.meta.env.BASE_URL}tools-arv-v1.png`} className="w-full rounded-xl shadow-2xl border border-white/20" />
        </motion.div>

        {/* Tool 2: Property Lookup */}
        <motion.div
          className="absolute w-[45vw]"
          initial={{ opacity: 0, y: 100, scale: 0.8 }}
          animate={phase >= 2 ? { 
            opacity: phase >= 3 ? 0.4 : 1, 
            y: phase >= 3 ? '-10vh' : 0, 
            x: phase >= 3 ? '20vw' : 0,
            scale: phase >= 3 ? 0.8 : 1,
            zIndex: phase === 2 ? 30 : 15
          } : { opacity: 0, y: 100, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        >
          <img src={`${import.meta.env.BASE_URL}tools-property-lookup.png`} className="w-full rounded-xl shadow-2xl border border-primary/30" />
        </motion.div>

        {/* Tool 3: Lead Scraper */}
        <motion.div
          className="absolute w-[50vw]"
          initial={{ opacity: 0, scale: 0.8, y: 50 }}
          animate={phase >= 3 ? { opacity: 1, scale: 1, y: 0, zIndex: 30 } : { opacity: 0, scale: 0.8, y: 50 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        >
          <img src={`${import.meta.env.BASE_URL}tools-lead-scraper.png`} className="w-full rounded-xl shadow-[0_0_60px_rgba(0,0,0,0.9)] border border-accent/40" />
        </motion.div>
      </div>
    </motion.div>
  );
}