// api/checkout.js
// POST /api/checkout - creates Stripe checkout session
// Handles both premium number purchases and standard packages

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Package prices (standard numbers 101+)
const STANDARD_PACKAGES = {
  pioneer:  { price_cents: 900,  label: 'Pioneer — 100 km²',   size: '100 km²'   },
  colonist: { price_cents: 2900, label: 'Colonist — 500 km²',  size: '500 km²'   },
  governor: { price_cents: 9900, label: 'Governor — 2,000 km²', size: '2,000 km²' },
};

// Rate limiting (simple in-memory, use Redis for production)
const rateLimitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 5;
  const requests = rateLimitMap.get(ip) || [];
  const recent = requests.filter(t => now - t < windowMs);
  if (recent.length >= maxRequests) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.SITE_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limit
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const {
      firstName, lastName, displayName, email,
      package: pkg, region, shirtSize,
      citizenNumber // if premium number selected
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !region) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Check if email already registered
    const { data: existing } = await supabase
      .from('citizens')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'This email is already registered as a Mars citizen.' });
    }

    let lineItems = [];
    let metadata = {
      firstName, lastName,
      displayName: displayName || `${firstName} ${lastName[0]}.`,
      email, region, shirtSize: shirtSize || '',
      isPremium: 'false'
    };

    if (citizenNumber && citizenNumber <= 100) {
      // PREMIUM NUMBER PURCHASE
      const { data: premNum, error: premError } = await supabase
        .from('premium_numbers')
        .select('*')
        .eq('number', citizenNumber)
        .eq('available', true)
        .single();

      if (premError || !premNum) {
        return res.status(400).json({ error: `Citizen #${citizenNumber} is no longer available.` });
      }

      // Reserve the number for 15 minutes
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await supabase.from('number_reservations').upsert({
        citizen_number: citizenNumber,
        session_id: `pending_${Date.now()}`,
        expires_at: expiresAt
      });

      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Mars Citizen #${String(citizenNumber).padStart(3,'0')} — ${premNum.tier.toUpperCase()}`,
            description: `Elite Mars territory registration. Citizen number #${citizenNumber}. ${premNum.tier === 'elite' ? '500 km²' : premNum.tier === 'premium' ? '500 km²' : '100 km²'} parcel in ${region}.`,
            images: [`${process.env.SITE_URL}/og-image.png`],
          },
          unit_amount: premNum.price_cents,
        },
        quantity: 1,
      }];

      metadata.isPremium = 'true';
      metadata.citizenNumber = String(citizenNumber);
      metadata.parcelSize = premNum.tier === 'elite' ? '500 km²' : '100 km²';
      metadata.package = premNum.tier;
      metadata.pricePaid = String(premNum.price_cents);

    } else {
      // STANDARD PACKAGE (number 101+)
      const selectedPkg = STANDARD_PACKAGES[pkg] || STANDARD_PACKAGES.pioneer;

      lineItems = [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Mars Land — ${selectedPkg.label}`,
            description: `Official Mars territory registration. ${selectedPkg.size} parcel in ${region}. Unique citizen number assigned after payment.`,
            images: [`${process.env.SITE_URL}/og-image.png`],
          },
          unit_amount: selectedPkg.price_cents,
        },
        quantity: 1,
      }];

      // Add shirt if colonist or governor
      if ((pkg === 'colonist' || pkg === 'governor') && shirtSize) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `Mars Citizen T-Shirt (${shirtSize})` },
            unit_amount: 0, // included in package
          },
          quantity: 1,
        });
      }

      metadata.package = pkg;
      metadata.parcelSize = selectedPkg.size;
      metadata.pricePaid = String(selectedPkg.price_cents);
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_URL}/#claim`,
      customer_email: email,
      metadata,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 min
      payment_intent_data: {
        metadata,
        description: `MarsLand — Citizen Registration`
      }
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Payment setup failed. Please try again.' });
  }
}
