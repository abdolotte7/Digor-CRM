import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1000),
      setTimeout(() => setPhase(3), 2500),
      setTimeout(() => setPhase(4), 4000),
      setTimeout(() => setPhase(5), 5500),
      setTimeout(() => setPhase(6), 7500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[6vw] z-20"
      initial={{ opacity: 0, x: '100vw' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '-100vw', filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="w-[35%] flex flex-col justify-center relative z-20">
        <motion.p 
          className="text-[1.2vw] text-accent font-semibold tracking-widest uppercase mb-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          Digor CRM
        </motion.p>
        <h2 className="text-[3.5vw] font-display font-bold leading-tight mb-8 text-white drop-shadow-lg">
          One platform.
          <br />
          <span className="text-primary">Infinite scale.</span>
        </h2>
        
        <div className="space-y-6">
          {[
            { title: 'Lead Pipeline', p: 2 },
            { title: 'AI Deal Scorer', p: 3 },
            { title: 'Comps & ARV', p: 4 },
            { title: 'Auto Offer Letters', p: 5 }
          ].map((feature, i) => (
            <motion.div 
              key={feature.title}
              className={`flex items-center gap-4 text-[1.4vw] font-medium transition-colors duration-500 ${phase === feature.p ? 'text-white' : 'text-white/40'}`}
              initial={{ opacity: 0, x: -20 }}
              animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
            >
              <motion.div 
                className={`w-3 h-3 rounded-full ${phase === feature.p ? 'bg-primary scale-125' : 'bg-white/20'}`}
                layout
              />
              {feature.title}
            </motion.div>
          ))}
        </div>
      </div>

      <div className="relative w-[60%] h-[80vh] flex items-center justify-center">
        {/* Images layering */}
        
        {/* Pipeline */}
        <motion.img 
          src={`${import.meta.env.BASE_URL}crm-lead-list.png`}
          className="absolute max-w-full max-h-[70vh] rounded-xl shadow-2xl border border-white/10 object-contain"
          initial={{ opacity: 0, scale: 0.8, rotateY: 10, x: 40 }}
          animate={phase >= 2 ? { 
            opacity: phase >= 3 ? 0.3 : 1, 
            scale: phase >= 3 ? 0.9 : 1, 
            rotateY: 0, 
            x: phase >= 3 ? -40 : 0,
            y: phase >= 3 ? -20 : 0
          } : { opacity: 0, scale: 0.8, rotateY: 10, x: 40 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />

        {/* AI Deal Scorer */}
        <motion.img 
          src={`${import.meta.env.BASE_URL}crm-ai-deal-scorer.png`}
          className="absolute max-w-full max-h-[65vh] rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-primary/20 object-contain z-10"
          initial={{ opacity: 0, y: 100, scale: 0.8 }}
          animate={phase >= 3 ? { 
            opacity: phase >= 4 ? 0.3 : 1, 
            y: phase >= 4 ? -20 : 0, 
            scale: phase >= 4 ? 0.9 : 1,
            x: phase >= 4 ? 40 : 0
          } : { opacity: 0, y: 100, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />

        {/* Comps */}
        <motion.img 
          src={`${import.meta.env.BASE_URL}crm-comps-detail.png`}
          className="absolute max-w-full max-h-[65vh] rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/20 object-contain z-20"
          initial={{ opacity: 0, y: 100, scale: 0.8 }}
          animate={phase >= 4 ? { 
            opacity: phase >= 5 ? 0.3 : 1, 
            y: phase >= 5 ? 20 : 0, 
            scale: phase >= 5 ? 0.9 : 1,
            x: phase >= 5 ? -20 : 0
          } : { opacity: 0, y: 100, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />

        {/* Offer Letter */}
        <motion.img 
          src={`${import.meta.env.BASE_URL}crm-offer-letter.png`}
          className="absolute max-w-full max-h-[65vh] rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/20 object-contain z-30"
          initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
          animate={phase >= 5 ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 0, scale: 0.8, rotate: -5 }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />
      </div>
    </motion.div>
  );
}