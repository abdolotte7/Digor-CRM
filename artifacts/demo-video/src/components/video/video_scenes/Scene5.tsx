import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 600),
      setTimeout(() => setPhase(2), 1500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-black z-30"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <p className="text-[1.5vw] text-white/50 mb-4 tracking-widest uppercase">Built by investors. For investors.</p>
        <h1 className="text-[8vw] font-display font-black text-white leading-none tracking-tighter">
          DIGOR
        </h1>
        <div className="w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent mt-4" />
      </motion.div>
      
      <motion.p
        className="absolute bottom-[10vh] text-[1vw] text-white/30"
        initial={{ opacity: 0 }}
        animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 1 }}
      >
        digor.com
      </motion.p>
    </motion.div>
  );
}