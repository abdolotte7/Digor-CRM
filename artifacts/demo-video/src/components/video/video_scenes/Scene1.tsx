import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1500),
      setTimeout(() => setPhase(3), 3000),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-20"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="text-center max-w-[80vw] z-10">
        <motion.p 
          className="text-[1.5vw] text-accent font-semibold tracking-widest uppercase mb-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          The Problem
        </motion.p>
        
        <h1 className="text-[4.5vw] font-display font-bold leading-tight">
          <motion.span 
            className="block text-white/50"
            initial={{ opacity: 0, y: 40 }}
            animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            Real estate wholesalers use
          </motion.span>
          <motion.span 
            className="block text-primary mt-2"
            initial={{ opacity: 0, x: -40 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          >
            6+ disconnected tools.
          </motion.span>
        </h1>
      </div>
      
      {/* Floating abstract UI elements representing disconnected tools */}
      <motion.div 
        className="absolute top-[20%] left-[20%] w-[10vw] h-[6vw] border border-white/10 rounded bg-white/5 backdrop-blur-md"
        initial={{ opacity: 0, scale: 0 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1, y: [0, -10, 0] } : { opacity: 0, scale: 0 }}
        transition={{ duration: 0.5, y: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }}
      />
      <motion.div 
        className="absolute bottom-[20%] right-[20%] w-[8vw] h-[8vw] rounded-full border border-primary/30 bg-primary/5 backdrop-blur-md"
        initial={{ opacity: 0, scale: 0 }}
        animate={phase >= 2 ? { opacity: 1, scale: 1, y: [0, 15, 0] } : { opacity: 0, scale: 0 }}
        transition={{ duration: 0.5, y: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }}
      />
      <motion.div 
        className="absolute top-[15%] right-[25%] w-[6vw] h-[12vw] rounded border border-accent/20 bg-accent/5 backdrop-blur-md"
        initial={{ opacity: 0, scale: 0 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1, y: [0, -20, 0] } : { opacity: 0, scale: 0 }}
        transition={{ duration: 0.5, y: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
      />
    </motion.div>
  );
}