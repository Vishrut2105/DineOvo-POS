export const RESTAURANT_CONFIG = {
  name: 'Cielo Cafe',
  sub: 'Cafe & Restro',
  tagline: 'Cafe & Restro',
  poweredBy: 'DINEOVO',
  phone: '+919909377100',
  whatsapp: '919909377100',
  instagram: 'https://www.instagram.com/cielocafe.vadodara?igsh=MWY4MXVkZzVhODllaw%3D%3D',
  maps: 'https://www.google.com/maps/place/Cielo+Cafe+and+Restro/@22.3075375,73.1251392,17z',
  reviewUrl: 'https://www.google.com/search?hl=en-IN&gl=in&q=6th+floor,+Cielo+Cafe+and+Restro,+Asopalav+One+West,+Sevasi+-+Canal+Rd,+Gokul+Nagar,+Vadodara,+Gujarat+391101&ludocid=10384129321734646119&lsig=AB86z5XCU49cYpqccFbO4D0xlOQz#lrd=0x395fc949abe46b8b:0x901bd699c3b62967,3'
};

export const GEOLOCATION_CONFIG = {
  enabled: false, // Disabled for now as requested
  lat: 22.3075375,
  lng: 73.1251392,
  maxDistanceKm: 0.25, // 250 meters (indoor 6th floor tolerance)
  maxSlopKm: 1.0       // Max accuracy radius allowance
};

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qdatmrgwcsphabwhmxct.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkYXRtcmd3Y3NwaGFid2hteGN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4OTMxMTcsImV4cCI6MjA5NjQ2OTExN30.eJZPZvKlRT77fub8rsRDZZv2tVJ6zE0kzvPqtdxvqfc';

