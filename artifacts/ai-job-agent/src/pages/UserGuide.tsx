import React, { useState } from 'react';
import { Link } from 'wouter';
import {
  BookOpen,
  Sparkles,
  Layers,
  Target,
  Search,
  Mail,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  Phone,
  HelpCircle,
  Briefcase,
  Play,
  FileText,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  MapPin,
  LockKeyhole
} from 'lucide-react';
import { SUPPORT_PHONE, SUPPORT_EMAIL, WHATSAPP_LINK } from '../components/OnboardingModal';

export function UserGuide() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (idx: number) => {
    setOpenFaq(openFaq === idx ? null : idx);
  };

  const triggerTour = () => {
    window.dispatchEvent(new CustomEvent('open-kaziscout-guide'));
  };

  const faqs = [
    {
      q: "Will KaziScout send job applications automatically without my approval?",
      a: "No! KaziScout is strictly designed with an application review gate. When a job is matched or tracked, it enters the 'Review' stage. Tailored cover letters and application emails are generated for your inspection, and nothing is dispatched until you explicitly click 'Send Application'."
    },
    {
      q: "Which careers and professions does KaziScout support?",
      a: "KaziScout is universally engineered for all professional fields in Kenya and globally: Healthcare (Doctors, Surgeons, Nurses, Pharmacists), Law & Legal Practice, Accounting & Finance, Engineering (Civil, Mechanical, Electrical), Education & Academic Research, Technology & IT, Marketing, and Operations/Administration."
    },
    {
      q: "How does the 47 Counties crawler work?",
      a: "KaziScout monitors official county government vacancy portals, County Public Service Boards (CPSB), the Public Service Commission (PSC), national statutory bodies, and verified private boards across Kenya, matching them with your selected county preferences."
    },
    {
      q: "Why do I need Gmail Auth / App Password for Auto-Apply?",
      a: "To ensure application emails come directly from your personal, verified email address (e.g. yourname@gmail.com) rather than an anonymous third-party sender. Employers recognize your genuine sender address, boosting response rates."
    },
    {
      q: "What if I get stuck configuring Gmail or OAuth?",
      a: "You don't have to do it alone! Reach out to our technical support team directly on WhatsApp (+254 719 767 590) or email (INFO@VINTECHSYSTEMS.COM). We will assist you with free white-glove setup in under 5 minutes."
    },
    {
      q: "How do I update or change my target roles?",
      a: "You can update your target roles at any time under 'Candidate Profile' or 'Role Management'. Updating your roles immediately cleans and synchronizes the Discovery search queue."
    }
  ];

  return (
    <main className="page-wrap">
      {/* Header */}
      <header className="page-head">
        <div>
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <BookOpen size={14} style={{ color: '#10b981' }} /> KaziScout Documentation Desk
          </div>
          <h1 className="page-title">User Manual & Getting Started Guide</h1>
          <p className="page-sub">
            Everything you need to know about setting up your candidate profile, discovering verified Kenyan & global jobs, and configuring email auto-apply.
          </p>
        </div>
        <div className="head-actions">
          <button onClick={triggerTour} className="btn btn-primary">
            <Play size={14}/> Replay Interactive Tour
          </button>
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            style={{ color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)' }}
          >
            <MessageCircle size={14}/> WhatsApp Support
          </a>
        </div>
      </header>

      {/* Developer Support Callout Card */}
      <section className="panel" style={{
        marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.04) 100%)',
        border: '1px solid rgba(16, 185, 129, 0.4)',
        boxShadow: '0 4px 20px rgba(16, 185, 129, 0.08)'
      }}>
        <div className="panel-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
              <Phone size={18}/> Need Assistance with Gmail Auto-Apply Setup?
            </div>
            <div style={{ fontSize: 13, color: 'hsl(var(--foreground))', lineHeight: 1.5 }}>
              Connecting Google OAuth or Gmail SMTP can sometimes feel technical. Our engineering team at <b>Vintech Systems & Consulting</b> provides <b>free white-glove setup assistance</b>. Send us a message on WhatsApp or Email, and we will configure it for you directly.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
              style={{ background: '#25D366', borderColor: '#25D366', color: '#ffffff', textDecoration: 'none', padding: '10px 18px', fontWeight: 700 }}
            >
              <MessageCircle size={16}/> WhatsApp: +254 719 767 590
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=KaziScout%20Gmail%20Auto-Apply%20Setup%20Assistance`}
              className="btn btn-ghost"
              style={{ textDecoration: 'none', padding: '10px 16px', fontWeight: 600 }}
            >
              <Mail size={16}/> {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </section>

      {/* 5-Step System Architecture Flow */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} color="#10b981"/> Complete KaziScout Workflow (From CV to Interview)
            </div>
            <div className="field-hint" style={{ marginTop: 4 }}>
              5 simple steps from initial profile setup to tailored application dispatch
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {/* Step 1 */}
            <div style={{ padding: 16, borderRadius: 10, background: 'hsl(var(--secondary) / 0.15)', border: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
                  1
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Document Vault (CV Upload)</div>
              </div>
              <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, margin: 0 }}>
                Upload your resume (PDF or DOCX). The universal coordinate-aware parser extracts education, degrees, licenses, skills, and target career roles across all disciplines.
              </p>
              <div style={{ marginTop: 12 }}>
                <Link href="/cvs" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 11 }}>
                  Go to Document Vault &rarr;
                </Link>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{ padding: 16, borderRadius: 10, background: 'hsl(var(--secondary) / 0.15)', border: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#3b82f6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
                  2
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Candidate Profile Calibration</div>
              </div>
              <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, margin: 0 }}>
                Verify your extracted target roles, preferred counties in Kenya, global remote availability, work modes (On-site/Hybrid/Remote), and minimum salary requirements.
              </p>
              <div style={{ marginTop: 12 }}>
                <Link href="/profile" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 11 }}>
                  Calibrate Profile &rarr;
                </Link>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ padding: 16, borderRadius: 10, background: 'hsl(var(--secondary) / 0.15)', border: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#8b5cf6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
                  3
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Targeted Job Discovery</div>
              </div>
              <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, margin: 0 }}>
                KaziScout's crawler runs across 86+ verified feeds. Our verification gate rejects spam and outdated posts lacking transparent application details.
              </p>
              <div style={{ marginTop: 12 }}>
                <Link href="/discovery" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 11 }}>
                  Launch Discovery &rarr;
                </Link>
              </div>
            </div>

            {/* Step 4 */}
            <div style={{ padding: 16, borderRadius: 10, background: 'hsl(var(--secondary) / 0.15)', border: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f59e0b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
                  4
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>AI Match & Cover Letter Studio</div>
              </div>
              <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, margin: 0 }}>
                Every ingested vacancy is scored against your resume. Click any job to inspect requirements and generate custom, ATS-optimized cover letters and pitches.
              </p>
              <div style={{ marginTop: 12 }}>
                <Link href="/jobs" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 11 }}>
                  View Job Records &rarr;
                </Link>
              </div>
            </div>

            {/* Step 5 */}
            <div style={{ padding: 16, borderRadius: 10, background: 'hsl(var(--secondary) / 0.15)', border: '1px solid hsl(var(--border))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: '#ec4899', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13 }}>
                  5
                </div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Gmail Auto-Apply & Dispatch</div>
              </div>
              <p style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6, margin: 0 }}>
                Connect your Gmail to send applications from your genuine account address. Track sent emails, interview invitations, and status updates directly in your workspace.
              </p>
              <div style={{ marginTop: 12 }}>
                <Link href="/settings" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none', fontSize: 11 }}>
                  Configure Mailbox &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Gmail Setup Detailed Instructions */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={16} color="#10b981"/> Gmail Auth & Auto-Apply Setup Instructions
            </div>
            <div className="field-hint" style={{ marginTop: 4 }}>
              Two ways to get your mailbox connected: Self-Serve vs Assisted Support
            </div>
          </div>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          {/* Method A: White Glove */}
          <div style={{ padding: 18, borderRadius: 10, background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <span className="badge badge-green" style={{ marginBottom: 10 }}>Recommended for Most Users</span>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '8px 0' }}>Method A: Assisted Developer Setup</h3>
            <p style={{ fontSize: 12, color: 'hsl(var(--foreground))', lineHeight: 1.6 }}>
              Avoid Google Cloud Console and complex OAuth screens. Our support team can set up your credentials or walk you through via WhatsApp in 5 minutes.
            </p>
            <ol style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, margin: '12px 0' }}>
              <li>Click the WhatsApp button below.</li>
              <li>Provide your KaziScout registered email address.</li>
              <li>Our engineer will verify your mailbox connection live.</li>
            </ol>
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              style={{ background: '#25D366', borderColor: '#25D366', textDecoration: 'none' }}
            >
              <MessageCircle size={14}/> Connect on WhatsApp (+254 719 767 590)
            </a>
          </div>

          {/* Method B: Self Serve */}
          <div style={{ padding: 18, borderRadius: 10, background: 'hsl(var(--secondary) / 0.15)', border: '1px solid hsl(var(--border))' }}>
            <span className="badge" style={{ marginBottom: 10 }}>Self-Serve Configuration</span>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: '8px 0' }}>Method B: Google Cloud OAuth</h3>
            <p style={{ fontSize: 12, color: 'hsl(var(--foreground))', lineHeight: 1.6 }}>
              If you have experience with Google Cloud Console:
            </p>
            <ol style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, margin: '12px 0' }}>
              <li>Visit <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" style={{ color: '#10b981' }}>Google Cloud Console</a>.</li>
              <li>Create a Project and enable the <b>Gmail API</b>.</li>
              <li>Create an <b>OAuth 2.0 Web Application Client ID</b>.</li>
              <li>Add the KaziScout authorized redirect URI from <Link href="/settings" style={{ color: '#10b981' }}>Agent & Settings</Link>.</li>
              <li>Paste Client ID & Client Secret into KaziScout settings.</li>
            </ol>
            <Link href="/settings" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
              <SlidersHorizontal size={14}/> Open Settings Page
            </Link>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HelpCircle size={16} color="#10b981"/> Frequently Asked Questions
            </div>
            <div className="field-hint" style={{ marginTop: 4 }}>
              Common questions about accuracy, privacy, and automation
            </div>
          </div>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {faqs.map((item, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                style={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: isOpen ? 'hsl(var(--secondary) / 0.2)' : 'transparent',
                  overflow: 'hidden',
                  transition: 'all 0.15s ease'
                }}
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontWeight: 600,
                    fontSize: 13,
                    color: 'hsl(var(--foreground))'
                  }}
                >
                  <span>{item.q}</span>
                  {isOpen ? <ChevronUp size={16} color="#10b981"/> : <ChevronDown size={16} color="hsl(var(--muted-foreground))"/>}
                </button>
                {isOpen && (
                  <div style={{ padding: '0 16px 14px 16px', fontSize: 12, color: 'hsl(var(--muted-foreground))', lineHeight: 1.6 }}>
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer Branding */}
      <footer style={{ textAlign: 'center', padding: '24px 0', color: 'hsl(var(--muted-foreground))', fontSize: 12 }}>
        KaziScout PRO · Engineered & Maintained by <a href="https://vintechsystems.store" target="_blank" rel="noopener noreferrer" style={{ color: '#10b981', fontWeight: 600 }}>Vintech Systems & Consulting</a>
        <br/>
        Direct Technical Support: <a href="tel:+254719767590" style={{ color: 'inherit' }}>+254 719 767 590</a> · <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'inherit' }}>{SUPPORT_EMAIL}</a>
      </footer>
    </main>
  );
}
