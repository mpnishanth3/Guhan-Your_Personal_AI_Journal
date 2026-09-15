'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

interface ColorRGB {
  r: number;
  g: number;
  b: number;
}

const PALETTE: ColorRGB[] = [
  { r: 99, g: 102, b: 241 },   // Vibrant Indigo
  { r: 168, g: 85, b: 247 },  // Violet
  { r: 251, g: 191, b: 36 },   // Warm Pale Gold
  { r: 129, g: 140, b: 248 },  // Electric Indigo
  { r: 192, g: 132, b: 252 },  // Glowing Amethyst
  { r: 253, g: 224, b: 71 },   // Shimmering Gold
];

class BokehParticle {
  x: number;
  y: number;
  radius: number;
  speedY: number;
  swaySpeed: number;
  swayAmplitude: number;
  swayOffset: number;
  color: ColorRGB;
  baseOpacity: number;
  pulseSpeed: number;
  pulseOffset: number;
  isDust: boolean;

  constructor(width: number, height: number, spawnAnywhere = false) {
    this.x = Math.random() * width;
    this.y = spawnAnywhere ? Math.random() * height : height + Math.random() * 40;

    const roll = Math.random();
    if (roll < 0.3) {
      // Large atmospheric bokeh orb
      this.radius = Math.random() * 45 + 30; // 30 - 75px
      this.speedY = Math.random() * 0.3 + 0.15;
      this.baseOpacity = Math.random() * 0.16 + 0.12; // 0.12 - 0.28
      this.swayAmplitude = Math.random() * 1.0 + 0.4;
      this.isDust = false;
    } else if (roll < 0.7) {
      // Medium glowing bokeh circle
      this.radius = Math.random() * 18 + 8; // 8 - 26px
      this.speedY = Math.random() * 0.5 + 0.25;
      this.baseOpacity = Math.random() * 0.25 + 0.18; // 0.18 - 0.43
      this.swayAmplitude = Math.random() * 1.5 + 0.6;
      this.isDust = false;
    } else {
      // Shimmering antigravity dust speck
      this.radius = Math.random() * 2.5 + 1.2; // 1.2 - 3.7px
      this.speedY = Math.random() * 0.7 + 0.35;
      this.baseOpacity = Math.random() * 0.4 + 0.45; // 0.45 - 0.85
      this.swayAmplitude = Math.random() * 2.0 + 0.8;
      this.isDust = true;
    }

    this.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    this.swaySpeed = Math.random() * 0.008 + 0.004;
    this.swayOffset = Math.random() * Math.PI * 2;
    this.pulseSpeed = Math.random() * 0.02 + 0.01;
    this.pulseOffset = Math.random() * Math.PI * 2;
  }

  update(width: number, height: number, time: number) {
    this.y -= this.speedY;
    this.x += Math.sin(time * this.swaySpeed + this.swayOffset) * this.swayAmplitude;

    // Reset when reaching above the screen
    if (this.y < -this.radius * 2) {
      this.y = height + this.radius * 2;
      this.x = Math.random() * width;
    }

    // Wrap horizontal boundaries
    if (this.x < -this.radius * 2) {
      this.x = width + this.radius * 2;
    } else if (this.x > width + this.radius * 2) {
      this.x = -this.radius * 2;
    }
  }

  draw(ctx: CanvasRenderingContext2D, time: number) {
    const pulse = Math.sin(time * this.pulseSpeed + this.pulseOffset);
    const opacity = Math.max(0.02, Math.min(1, this.baseOpacity * (1 + 0.3 * pulse)));

    if (this.isDust) {
      // Luminous star/dust speck with glowing halo
      const grad = ctx.createRadialGradient(
        this.x, this.y, 0,
        this.x, this.y, this.radius * 3
      );
      grad.addColorStop(0, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${opacity})`);
      grad.addColorStop(0.35, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${opacity * 0.6})`);
      grad.addColorStop(1, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, 0)`);

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * 3, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      // Soft glowing out-of-focus optical bokeh orb
      const grad = ctx.createRadialGradient(
        this.x, this.y, 0,
        this.x, this.y, this.radius
      );
      grad.addColorStop(0, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${opacity})`);
      grad.addColorStop(0.4, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${opacity * 0.7})`);
      grad.addColorStop(0.8, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${opacity * 0.2})`);
      grad.addColorStop(1, `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, 0)`);

      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
}

export function AntigravityBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pathname = usePathname();
  const isStaticPage = pathname === '/journal';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles: BokehParticle[] = [];
    let animationFrameId: number;
    let time = 0;

    const setupCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = window.innerWidth;
      const height = window.innerHeight;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Balanced count for stunning bokeh without visual clutter
      const count = Math.min(Math.max(Math.floor((width * height) / 16000), 45), 85);
      particles = [];
      for (let i = 0; i < count; i++) {
        particles.push(new BokehParticle(width, height, true));
      }
    };

    setupCanvas();

    const render = () => {
      time += 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Reset transform before clear
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deep obsidian black base
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);

      // Atmospheric radial glow for subtle cinematic depth
      const ambientGlow = ctx.createRadialGradient(
        width * 0.5, height * 0.4, 80,
        width * 0.5, height * 0.5, Math.max(width, height) * 0.8
      );
      ambientGlow.addColorStop(0, 'rgba(49, 46, 129, 0.28)'); // deep indigo
      ambientGlow.addColorStop(0.5, 'rgba(30, 27, 75, 0.16)');
      ambientGlow.addColorStop(1, 'rgba(5, 5, 5, 0)');
      ctx.fillStyle = ambientGlow;
      ctx.fillRect(0, 0, width, height);

      if (!isStaticPage) {
        ctx.globalCompositeOperation = 'screen';

        for (let i = 0; i < particles.length; i++) {
          particles[i].update(width, height, time);
          particles[i].draw(ctx, time);
        }

        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    const handleResize = () => {
      setupCanvas();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isStaticPage]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
      }}
    />
  );
}
