import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import {
  Sparkles,
  Layers,
  Target,
  Search,
  Mail,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X,
  MessageCircle,
  Phone,
  ExternalLink,
  ShieldCheck,
  Briefcase,
  HelpCircle,
  BookOpen
} from 'lucide-react';

interface OnboardingModalProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export const SUPPORT_PHONE = "+254719767590";
export const SUPPORT_EMAIL = "INFO@VINTECHSYSTEMS.COM";
export const WHATSAPP_LINK = "https://wa.me/254719767590?text=Hello%20Vintech%20Systems%2C%20I%20am%20using%20KaziScout%20and%20would%20like%20assistance%20setting%20up%20Gmail%20Auto-Apply%20for%20my%20account.";

export function OnboardingModal({ forceOpen, onClose }: OnboardingModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
      setStep(0);
      return;
    }

    // Check if new registration flag or first-time visit
    const shouldShow = localStorage.getItem('kaziscout_show_onboarding') === 'true' ||
                       !localStorage.getItem('kaziscout_onboarding_completed');
    if (shouldShow) {
      setIsOpen(true);
      setStep(0);
    }

    // Listen for custom open event
    const handleOpen = () => {
      setIsOpen(true);
      setStep(0);
    };
    window.addEventListener('open-kaziscout-guide', handleOpen);
    return () => window.removeEventListener('open-kaziscout-guide', handleOpen);
  }, [forceOpen]);

  const handleDismiss = () => {
    localStorage.setItem('kaziscout_onboarding_completed', 'true');
    localStorage.removeItem('kaziscout_show_onboarding');
    setIsOpen(false);
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  const steps = [
    {
      title: "Welcome to KaziScout",
      subtitle: "Universal precision career discovery & application automation",
      icon: Sparkles,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--foreground))' }}>
            KaziScout is built for ambitious Kenyan and global professionals across <b>Medicine, Law, Engineering, Finance, Education, Technology, and Operations</b>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div className="panel" style={{ padding: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--secondary) / 0.15)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#10b981' }}>
                <Search size={14}/> 86+ Verified Feeds
              </div>
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                47 Kenyan county portals, PSC, verified private boards, and worldwide remote hubs.
              </div>
            </div>
            <div className="panel" style={{ padding: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--secondary) / 0.15)' }}>
              <div style={{ fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: '#3b82f6' }}>
                <ShieldCheck size={14}/> 100% Review Gate
              </div>
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', marginTop: 4 }}>
                No applications are sent blindly. You maintain total review and control.
              </div>
            </div>
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', fontSize: 12 }}>
            💡 <b>Next up:</b> A 60-second walkthrough showing you how to set up your CV, run discoveries, and get free developer support for Gmail auto-apply.
          </div>
        </div>
      ),
    },
    {
      title: "Step 1: Upload Your CV",
      subtitle: "The Document Vault extracts your skills and target roles automatically",
      icon: Layers,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--foreground))' }}>
            Head to the <b>Document Vault</b> and upload your latest resume in PDF or Word format. KaziScout analyzes your experience across all professional disciplines.
          </p>
          <ul style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li><b>Fact Extraction:</b> Detects your verified education, certifications, and career skills.</li>
            <li><b>Role Calibration:</b> Auto-populates your primary target roles (e.g. <i>Medical Officer, Civil Engineer, Financial Analyst, Legal Counsel</i>).</li>
            <li><b>Private & Local:</b> Your document stays strictly within your workspace.</li>
          </ul>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Link href="/cvs" onClick={handleDismiss} className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              <Layers size={13}/> Open Document Vault
            </Link>
          </div>
        </div>
      ),
    },
    {
      title: "Step 2: Review Your Candidate Profile",
      subtitle: "Set your target roles, salary, and location filters",
      icon: Target,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--foreground))' }}>
            Your <b>Candidate Profile</b> serves as the source of truth for all job matching. You can customize:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <div style={{ padding: 10, borderRadius: 8, background: 'hsl(var(--muted))', fontSize: 12 }}>
              <b>🎯 Target Roles:</b> Specify your exact titles to search.
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: 'hsl(var(--muted))', fontSize: 12 }}>
              <b>📍 Counties & Remote:</b> Target Nairobi, Mombasa, Kisumu, or global remote.
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: 'hsl(var(--muted))', fontSize: 12 }}>
              <b>💼 Work Modes:</b> Choose On-site, Hybrid, or 100% Remote.
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: 'hsl(var(--muted))', fontSize: 12 }}>
              <b>💰 Minimum Salary:</b> Filter out positions below your threshold.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <Link href="/profile" onClick={handleDismiss} className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              <Target size={13}/> Review Candidate Profile
            </Link>
          </div>
        </div>
      ),
    },
    {
      title: "Step 3: Run Targeted Discovery",
      subtitle: "Scan live job feeds matching your verified profile",
      icon: Search,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--foreground))' }}>
            On the <b>Enhanced Discovery</b> desk, KaziScout crawls verified job sources strictly for your approved target roles.
          </p>
          <div style={{ padding: '12px 14px', borderRadius: 8, background: 'hsl(var(--secondary) / 0.2)', border: '1px solid hsl(var(--border))' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'hsl(var(--foreground))', marginBottom: 6 }}>
              How Discovery Works:
            </div>
            <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', lineHeight: 1.5 }}>
              1. <b>Crawl Engine:</b> Pulls real-time postings from Kenyan public boards, JobWeb Kenya, BrighterMonday, and global remote aggregators.<br/>
              2. <b>Verification Gate:</b> Rejects expired or fraudulent posts lacking application details.<br/>
              3. <b>ATS Scoring:</b> Ranks jobs by how well your profile and CV match the vacancy.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Link href="/discovery" onClick={handleDismiss} className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              <Search size={13}/> Go to Discovery Desk
            </Link>
          </div>
        </div>
      ),
    },
    {
      title: "Step 4: Gmail Auto-Apply & Developer Support",
      subtitle: "Need help connecting your Gmail? Our technical team is ready to assist!",
      icon: Mail,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'hsl(var(--foreground))' }}>
            To send tailored applications directly from your email address, KaziScout connects to Gmail. Because Google authentication can sometimes be technical, <b>we offer free white-glove setup assistance</b>!
          </p>

          <div style={{ padding: 14, borderRadius: 10, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Phone size={15}/> Contact Developer / Technical Support
            </div>
            <div style={{ fontSize: 12, color: 'hsl(var(--foreground))', marginBottom: 12, lineHeight: 1.5 }}>
              Click below to message our developer directly on WhatsApp or Email. We will guide you through or configure your Gmail credentials for you in 5 minutes:
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a
                href={WHATSAPP_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{ background: '#25D366', borderColor: '#25D366', color: '#ffffff', textDecoration: 'none' }}
              >
                <MessageCircle size={14}/> WhatsApp Developer: +254 719 767 590
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=KaziScout%20Gmail%20Auto-Apply%20Setup%20Assistance`}
                className="btn btn-ghost btn-sm"
                style={{ textDecoration: 'none' }}
              >
                <Mail size={14}/> Email: {SUPPORT_EMAIL}
              </a>
            </div>
          </div>

          <div style={{ padding: 10, borderRadius: 8, background: 'hsl(var(--muted))', fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
            <b>Prefer to do it yourself?</b> Navigate to <b>Agent & Settings &rarr; Gmail OAuth</b> and enter your credentials. You can also view the full step-by-step instructions in the <Link href="/guide" onClick={handleDismiss} style={{ color: '#10b981', textDecoration: 'underline' }}>User Manual</Link>.
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step];
  const StepIcon = currentStep.icon;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    }}>
      <div className="panel" style={{
        maxWidth: 580,
        width: '100%',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        border: '1px solid hsl(var(--border))',
        background: 'hsl(var(--card))',
        borderRadius: 14,
        overflow: 'hidden',
        animation: 'fadeIn 0.2s ease-out'
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          background: 'hsl(var(--secondary) / 0.3)',
          borderBottom: '1px solid hsl(var(--border))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: '#10b981',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <StepIcon size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'hsl(var(--foreground))' }}>
                {currentStep.title}
              </div>
              <div style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
                {currentStep.subtitle}
              </div>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 6,
            }}
            title="Close guide"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '20px 22px' }}>
          {currentStep.content}
        </div>

        {/* Modal Footer with Progress Dots & Actions */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid hsl(var(--border))',
          background: 'hsl(var(--secondary) / 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                style={{
                  width: i === step ? 22 : 8,
                  height: 8,
                  borderRadius: 4,
                  background: i === step ? '#10b981' : 'hsl(var(--border))',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  padding: 0,
                }}
                title={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          {/* Nav buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setStep(s => Math.max(0, s - 1))}
              >
                <ChevronLeft size={14}/> Back
              </button>
            )}

            {step < steps.length - 1 ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setStep(s => Math.min(steps.length - 1, s + 1))}
              >
                Next Step <ChevronRight size={14}/>
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleDismiss}
              >
                <CheckCircle2 size={14}/> Got it, let's start!
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
