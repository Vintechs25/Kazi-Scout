import React from 'react';
import { Link } from 'wouter';
import { Compass, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100dvh', background: 'hsl(var(--background))', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: '#ffffff', borderRadius: 12, padding: '10px 18px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', marginBottom: 24 }}>
          <img src="/kaziscout-logo.png" alt="KaziScout" style={{ height: 40, width: 'auto', objectFit: 'contain', display: 'block' }} />
        </div>

        <div className="eyebrow" style={{ marginBottom: 8 }}>404 · Opportunity Not Found</div>
        <h1 style={{ font: '700 32px Manrope', letterSpacing: '-0.04em', margin: '0 0 12px', color: 'hsl(var(--foreground))' }}>
          Lost in the Field?
        </h1>
        <p style={{ fontSize: 13, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, margin: '0 auto 24px', maxWidth: 360 }}>
          The page or opportunity record you requested could not be found. Head back to your workspace to continue scouting verified jobs.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Link href="/dashboard" className="btn btn-primary" style={{ padding: '10px 20px', textDecoration: 'none' }}>
            <Home size={15} /> Return to KaziScout Dashboard
          </Link>
        </div>

        <div style={{ marginTop: 32, fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
          Find the right work. Apply with confidence.
        </div>
      </div>
    </div>
  );
}
