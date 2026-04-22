import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ChevronDown, Play } from "lucide-react";

const DEMO_URL = "https://heroic-curiosity-production-dc5a.up.railway.app/crm/";

export function Hero() {
  const scrollTo = (href: string) => {
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 overflow-hidden">
      {/* Background Image & Overlay */}
      <div className="absolute inset-0 z-0 bg-background">
        <img 
          src={`${import.meta.env.BASE_URL}images/office-team.jpg`} 
          alt="Professional office team" 
          className="absolute inset-0 w-full h-full object-cover opacity-55"
        />
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-bg.jpg`} 
          alt="Abstract geometric background" 
          className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-overlay"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-6">
            B2B Infrastructure & Managed Operations
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-foreground leading-tight mb-6">
            Scalable Infrastructure for <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/60">
              Real Estate Acquisition
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Digor LLC is a Managed Marketing and Data Infrastructure Agency delivering precision outreach operations, data engineering, and technical CRM infrastructure to real estate investors.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 flex-wrap">
            <Button 
              size="lg"
              asChild
              className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-8 rounded-full font-semibold text-base shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:shadow-[0_0_30px_rgba(212,175,55,0.5)] transition-all"
            >
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
                <Play className="mr-2 h-4 w-4" />
                Live Demo
              </a>
            </Button>
            <Button 
              size="lg"
              variant="outline"
              onClick={() => scrollTo("#services")}
              className="w-full sm:w-auto h-14 px-8 rounded-full font-semibold text-base border-border hover:bg-secondary transition-all"
            >
              Explore Our Services
            </Button>
            <Button 
              size="lg"
              variant="outline"
              onClick={() => scrollTo("#contact")}
              className="w-full sm:w-auto h-14 px-8 rounded-full font-semibold text-base border-border hover:bg-secondary transition-all"
            >
              Schedule a Consultation
            </Button>
          </div>
        </motion.div>
      </div>

      <motion.div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2 cursor-pointer z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        onClick={() => scrollTo("#services")}
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          <ChevronDown className="w-8 h-8 text-muted-foreground hover:text-primary transition-colors" />
        </motion.div>
      </motion.div>
    </section>
  );
}
