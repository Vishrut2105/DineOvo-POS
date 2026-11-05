import React from 'react';
import { RESTAURANT_CONFIG } from '../../lib/config';
import {
  Star,
  ExternalLink,
  Phone,
  MessageCircle,
  MapPin,
  Heart,
  ShieldAlert,
  Info
} from 'lucide-react';

export default function ReviewsTab() {
  const policies = [
    'Outside food & beverages are strictly not permitted · Add-ons & extras charged additionally',
    'Cake cutting is welcomed · Tables idle for over 20 mins without an order attract a ₹250 sitting charge',
    'Damage to crockery or property will attract equivalent charges'
  ];

  return (
    <div style={{ paddingBottom: '24px' }}>
      {/* Hero Welcome Card */}
      <div
        className="tactile-card"
        style={{
          padding: '24px 20px',
          marginBottom: '16px',
          textAlign: 'center',
          background: 'linear-gradient(145deg, #FFFFFF 0%, var(--cream-surface) 100%)'
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'var(--ember-soft)',
            color: 'var(--ember)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px'
          }}
        >
          <Heart size={26} fill="var(--ember)" />
        </div>
        <h2
          className="font-serif"
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--ink)',
            marginBottom: '6px'
          }}
        >
          Connect With Us
        </h2>
        <p style={{ fontSize: '13px', color: 'var(--ink3)', lineHeight: 1.5, maxWidth: '320px', margin: '0 auto' }}>
          Thank you for visiting {RESTAURANT_CONFIG.name}. We love connecting with our community, sharing good vibes, and hearing your thoughts.
        </p>
      </div>

      {/* Google Review Card (Highlight) */}
      <div
        className="tactile-card"
        style={{
          padding: '22px 18px',
          marginBottom: '16px',
          textAlign: 'center',
          border: '1.5px solid rgba(224, 90, 43, 0.25)',
          background: 'linear-gradient(180deg, #FFFFFF 0%, rgba(254, 246, 240, 0.8) 100%)'
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 12px',
            borderRadius: '20px',
            background: 'rgba(255, 184, 0, 0.15)',
            color: '#B87A00',
            fontSize: '11.5px',
            fontWeight: 700,
            marginBottom: '10px'
          }}
        >
          <Star size={13} fill="#FFB800" color="#FFB800" />
          <span>4.9 / 5.0 on Google</span>
        </div>

        <h3
          className="font-serif"
          style={{
            fontSize: '21px',
            fontWeight: 700,
            color: 'var(--ink)',
            marginBottom: '6px'
          }}
        >
          Love Your Experience?
        </h3>
        <p style={{ fontSize: '12.5px', color: 'var(--ink2)', lineHeight: 1.45, marginBottom: '16px' }}>
          Your 5-star review on Google helps other coffee lovers and foodies discover our haven. It takes just 30 seconds!
        </p>

        {/* 5 Stars Visual */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '18px' }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} size={28} fill="#FFB800" color="#FFB800" />
          ))}
        </div>

        <a
          href={RESTAURANT_CONFIG.reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="action-btn-primary"
          style={{
            width: '100%',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '13px',
            fontSize: '14px',
            boxShadow: '0 4px 14px rgba(224, 90, 43, 0.3)'
          }}
        >
          <span>Write a Google Review</span>
          <ExternalLink size={16} />
        </a>
      </div>

      {/* Social & Contact Channels Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
        {/* Instagram */}
        <a
          href={RESTAURANT_CONFIG.instagram}
          target="_blank"
          rel="noopener noreferrer"
          className="tactile-card"
          style={{
            padding: '16px 14px',
            textDecoration: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '8px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(45deg, #F58529, #DD2A7B, #8134AF)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Instagram</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink3)' }}>@cielocafe.vadodara</div>
          </div>
        </a>

        {/* WhatsApp Chat */}
        <a
          href={`https://wa.me/${RESTAURANT_CONFIG.whatsapp}?text=${encodeURIComponent('Hi Cielo Cafe team! I am dining at your cafe.')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="tactile-card"
          style={{
            padding: '16px 14px',
            textDecoration: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '8px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: '#25D366',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <MessageCircle size={22} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>WhatsApp</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink3)' }}>+91 99093 77100</div>
          </div>
        </a>

        {/* Call Us */}
        <a
          href={`tel:${RESTAURANT_CONFIG.phone}`}
          className="tactile-card"
          style={{
            padding: '16px 14px',
            textDecoration: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '8px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'var(--ink)',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Phone size={20} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Call Front Desk</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink3)' }}>+91 99093 77100</div>
          </div>
        </a>

        {/* Google Maps / Directions */}
        <a
          href={RESTAURANT_CONFIG.maps}
          target="_blank"
          rel="noopener noreferrer"
          className="tactile-card"
          style={{
            padding: '16px 14px',
            textDecoration: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '8px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: '#4285F4',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <MapPin size={20} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)' }}>Directions</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink3)' }}>Open Google Maps</div>
          </div>
        </a>
      </div>

      {/* Embedded Google Map */}
      <div
        className="tactile-card"
        style={{
          padding: '16px 14px',
          marginBottom: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <MapPin size={18} color="var(--ember)" />
          <div>
            <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>
              Visit Cielo Cafe &amp; Restro
            </h4>
            <p style={{ fontSize: '11px', color: 'var(--ink3)' }}>
              6th floor, Asopalav One West, Sevasi - Canal Rd, Gokul Nagar, Vadodara
            </p>
          </div>
        </div>

        <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--tborder)' }}>
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.5436758213236!2d73.12513919999999!3d22.307537500000002!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x395fc949abe46b8b%3A0x901bd699c3b62967!2sCielo%20Cafe%20and%20Restro!5e1!3m2!1sen!2sin!4v1791977535949!5m2!1sen!2sin"
            width="100%"
            height="210"
            style={{ border: 0, display: 'block', width: '100%' }}
            allowFullScreen=""
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            title="Cielo Cafe Location Map"
          />
        </div>
      </div>

      {/* Cafe Policies Card */}
      <div
        className="tactile-card"
        style={{
          padding: '18px 16px',
          background: 'linear-gradient(180deg, #FFFFFF 0%, var(--cream-surface) 100%)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <ShieldAlert size={18} color="var(--rose)" />
          <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.2px' }}>
            House Policies &amp; Guidelines
          </h4>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {policies.map((p, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 12px',
                borderRadius: '10px',
                background: '#FFFFFF',
                border: '1px solid rgba(139, 94, 52, 0.1)',
                fontSize: '11.5px',
                color: 'var(--ink2)',
                lineHeight: 1.45
              }}
            >
              <Info size={14} color="var(--ember)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{p}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
