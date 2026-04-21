import { useState, useEffect } from "react";
import { Menu, X, Zap, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscribe } from "@/App";
import { useTheme } from "@/hooks/use-theme";

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { openSubscribe } = useSubscribe();
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Services", href: "#services" },
    { name: "Methodology", href: "#methodology" },
    { name: "Case Studies", href: "#case-studies" },
    { name: "Team", href: "#team" },
    { name: "About", href: "#about" },
  ];

  const scrollTo = (href: string) => {
    setMobileMenuOpen(false);
    const element = document.querySelector(href);
    if (element) element.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled ? "bg-background/80 backdrop-blur-md border-b border-border shadow-lg shadow-black/20 py-4" : "bg-transparent py-6"}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <div className="flex items-center cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <span className="font-display text-2xl font-bold tracking-wider text-foreground group-hover:text-primary transition-colors">
            DIGOR<span className="text-primary">.</span>
          </span>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center space-x-6">
          {navLinks.map((link) => (
            <button key={link.name} onClick={() => scrollTo(link.href)}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {link.name}
            </button>
          ))}
          <a href="/mission-vision-values"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
            Mission, Vision &amp; Values
          </a>
          <a href="/demo"
            className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors whitespace-nowrap">
            Watch Demo
          </a>
          <Button
            onClick={openSubscribe}
            variant="outline"
            className="border-primary/50 text-primary hover:bg-primary/10 rounded-full px-5 font-semibold text-sm flex items-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" /> Subscribe
          </Button>
          <a href="https://digorva.com/crm/" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="border-border text-foreground hover:bg-secondary rounded-full px-5 font-semibold text-sm">
              Digor CRM
            </Button>
          </a>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="p-2 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <Button onClick={() => scrollTo("#contact")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-6 font-semibold">
            Consultation
          </Button>
        </div>

        <div className="md:hidden flex items-center gap-2">
          {/* Theme toggle (mobile) */}
          <button
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="p-2 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-foreground p-2">
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-card border-b border-border shadow-xl">
          <div className="flex flex-col px-4 py-6 space-y-4">
            {navLinks.map((link) => (
              <button key={link.name} onClick={() => scrollTo(link.href)}
                className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
                {link.name}
              </button>
            ))}
            <a href="/mission-vision-values" onClick={() => setMobileMenuOpen(false)}
              className="text-left text-lg font-medium text-muted-foreground hover:text-foreground py-2 border-b border-border/50">
              Mission, Vision &amp; Values
            </a>
            <a href="/demo" onClick={() => setMobileMenuOpen(false)}
              className="text-left text-lg font-semibold text-primary hover:text-primary/80 py-2 border-b border-border/50">
              Watch Demo
            </a>
            <Button onClick={() => { setMobileMenuOpen(false); openSubscribe(); }}
              variant="outline"
              className="w-full border-primary/50 text-primary hover:bg-primary/10 flex items-center justify-center gap-2">
              <Zap className="w-4 h-4" /> Subscribe — $1,500/mo
            </Button>
            <a href="https://digorva.com/crm/" target="_blank" rel="noopener noreferrer" className="w-full">
              <Button variant="outline" className="w-full border-border text-foreground hover:bg-secondary">
                Digor CRM
              </Button>
            </a>
            <Button onClick={() => scrollTo("#contact")} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Schedule a Consultation
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}
