import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 3200),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center z-20"
      initial={{ opacity: 0, clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ opacity: 1, clipPath: 'circle(150% at 50% 50%)' }}
      exit={{ opacity: 0, y: '-100vh' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background Code/Tech Texture */}
      <div className="absolute inset-0 opacity-10 overflow-hidden font-mono text-[1vw] text-accent p-10 leading-loose flex flex-wrap">
        {Array.from({ length: 50 }).map((_, i) => (
          <motion.div 
            key={i} 
            className="w-1/4"
            initial={{ opacity: 0 }}
            animate={phase >= 1 ? { opacity: Math.random() * 0.5 + 0.1 } : { opacity: 0 }}
            transition={{ duration: 0.5, delay: Math.random() * 2 }}
          >
            {`import { ${['Database', 'API', 'Model', 'Auth', 'Query', 'Routes'][i % 6]} } from '@core/system';\n`}
          </motion.div>
        ))}
      </div>

      <div className="relative z-10 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          <h2 className="text-[6vw] font-display font-black tracking-tight leading-none uppercase text-transparent"
              style={{ WebkitTextStroke: '2px rgba(255,255,255,0.2)' }}>
            Engineered
          </h2>
          <h2 className="text-[6vw] font-display font-black tracking-tight leading-none text-primary mt-[-1vw]">
            For Scale
          </h2>
        </motion.div>

        <motion.div 
          className="flex justify-center gap-6 mt-[4vh]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ delay: 0.4 }}
        >
          {[
            { label: 'React + Vite', color: 'text-[#61DAFB]' },
            { label: 'PostgreSQL', color: 'text-[#336791]' },
            { label: 'Express 5', color: 'text-white' },
            { label: 'Drizzle ORM', color: 'text-[#C5F74F]' }
          ].map((tech, i) => (
            <motion.div 
              key={tech.label} 
              className="px-6 py-3 rounded-full border border-white/20 bg-black/60 backdrop-blur-md text-[1.2vw] font-semibold"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
              transition={{ delay: 0.6 + (i * 0.1), type: 'spring', stiffness: 300 }}
            >
              <span className={tech.color}>{tech.label}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}