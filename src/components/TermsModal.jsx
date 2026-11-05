import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';

export default function TermsModal({ onAccept }) {
  const [accepted, setAccepted] = useState(false);

  const handleContinue = () => {
    if (accepted) {
      localStorage.setItem('dineovo_terms_accepted', 'true');
      onAccept();
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }} 
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="bg-brand-card border border-brand-glass-border rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-brand-glass-border bg-brand-secondary/20 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-brand-primary/20 flex items-center justify-center text-brand-primary">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-brand-text">Legal Terms & Privacy Policy</h2>
            <p className="text-sm text-brand-text/60 font-medium">Please review before using DineOvo</p>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 text-sm text-brand-text/80 space-y-4 custom-scrollbar">
          <p>
            Welcome to <strong>DineOvo POS</strong>. By accessing and using this software, you agree to comply with and be bound by the following Terms & Conditions and Privacy Policy, in accordance with the Information Technology Act, 2000 and SPDI Rules.
          </p>
          
          <h3 className="font-bold text-brand-text mt-4">1. Data Storage & Privacy</h3>
          <p>
            DineOvo uses local storage on your device for caching, faster loads, and offline capabilities. Cloud backups of your Point-of-Sale (POS) data (orders, inventory, customer details) are securely synchronized to our servers. We do not sell your restaurant's proprietary data to third parties.
          </p>

          <h3 className="font-bold text-brand-text mt-4">2. Compliance & Responsibility</h3>
          <p>
            As a merchant, you are responsible for maintaining the privacy of your own customers' data (such as phone numbers and names) collected via DineOvo. You must ensure you have their consent to process and store their information for billing purposes under applicable Indian data protection guidelines.
          </p>

          <h3 className="font-bold text-brand-text mt-4">3. Software Liability</h3>
          <p>
            DineOvo is provided "as is" without warranty of any kind. We are not liable for direct, indirect, or consequential damages resulting from the use or inability to use the POS system, including but not limited to loss of data, revenue, or business interruption.
          </p>
        </div>

        <div className="p-6 border-t border-brand-glass-border bg-brand-secondary/10">
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative flex items-center justify-center mt-0.5">
              <input 
                type="checkbox" 
                className="sr-only"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${accepted ? 'bg-brand-primary border-brand-primary' : 'border-brand-glass-border group-hover:border-brand-primary/50'}`}>
                {accepted && <ShieldCheck size={14} className="text-white" />}
              </div>
            </div>
            <span className="text-sm text-brand-text/70 select-none">
              I have read and agree to the Terms and Conditions and the Privacy Policy. I consent to the processing of data as described above.
            </span>
          </label>

          <button 
            onClick={handleContinue}
            disabled={!accepted}
            className={`w-full mt-6 py-3.5 rounded-xl font-bold transition-all shadow-md ${accepted ? 'bg-brand-primary text-white hover:bg-blue-600' : 'bg-brand-secondary/50 text-brand-text/30 cursor-not-allowed'}`}
          >
            Accept & Continue
          </button>
        </div>
      </motion.div>
    </div>
  );
}
