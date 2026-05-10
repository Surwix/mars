// api/webhook.js
// POST /api/webhook - Stripe webhook handler
// Assigns citizen number, generates cert hash, sends email

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Disable body parsing - Stripe needs raw body
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function generateCertHash(citizenNumber, firstName, lastName, email, timestamp) {
  const salt = process.env.CERT_SALT || 'marsland_secret_salt';
  const data = `${citizenNumber}:${firstName}:${lastName}:${email}:${timestamp}:${salt}`;
  return createHash('sha256').update(data).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta = session.metadata;

    try {
      // Check if already processed (idempotency)
      const { data: existing } = await supabase
        .from('citizens')
        .select('id')
        .eq('stripe_session_id', session.id)
        .single();

      if (existing) {
        console.log('Already processed:', session.id);
        return res.status(200).json({ received: true });
      }

      let citizenNumber;

      if (meta.isPremium === 'true') {
        // Premium number - already reserved
        citizenNumber = parseInt(meta.citizenNumber);

        // Mark as purchased
        await supabase
          .from('premium_numbers')
          .update({ available: false, purchased_at: new Date().toISOString() })
          .eq('number', citizenNumber);

        // Remove reservation
        await supabase
          .from('number_reservations')
          .delete()
          .eq('citizen_number', citizenNumber);

      } else {
        // Standard number - get next available
        const { data: nextNum } = await supabase.rpc('get_next_standard_number');
        citizenNumber = nextNum;
      }

      // Generate cert hash
      const timestamp = new Date().toISOString();
      const certHash = generateCertHash(
        citizenNumber,
        meta.firstName,
        meta.lastName,
        meta.email,
        timestamp
      );

      // Insert citizen
      const { error: insertError } = await supabase
        .from('citizens')
        .insert({
          citizen_number: citizenNumber,
          first_name: meta.firstName,
          last_name: meta.lastName,
          display_name: meta.displayName,
          email: meta.email,
          region: meta.region,
          parcel_size: meta.parcelSize,
          package: meta.package,
          tier: meta.isPremium === 'true' ? meta.package : 'standard',
          price_paid: parseInt(meta.pricePaid),
          shirt_size: meta.shirtSize || null,
          cert_hash: certHash,
          stripe_session_id: session.id,
          verified: true
        });

      if (insertError) throw insertError;

      // Send confirmation email
      await sendConfirmationEmail({
        email: meta.email,
        firstName: meta.firstName,
        citizenNumber,
        certHash,
        region: meta.region,
        parcelSize: meta.parcelSize,
        displayName: meta.displayName
      });

      console.log(`✅ Citizen #${citizenNumber} registered: ${meta.firstName} ${meta.lastName}`);

    } catch (err) {
      console.error('Webhook processing error:', err);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }

  return res.status(200).json({ received: true });
}

async function sendConfirmationEmail({ email, firstName, citizenNumber, certHash, region, parcelSize, displayName }) {
  const numFormatted = String(citizenNumber).padStart(3, '0');
  const verifyUrl = `${process.env.SITE_URL}/verify.html?id=${citizenNumber}`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MarsLand <citizens@marslandspace.com>',
        to: email,
        subject: `Welcome to Mars, Citizen #${numFormatted} 🚀`,
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080401;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080401;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#1c0e07;border:1px solid #3a1a0a;">
      
      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#d94f1e,#f07832);padding:32px;text-align:center;">
        <div style="font-family:monospace;font-size:28px;font-weight:900;color:#fff;letter-spacing:0.1em;">MARSLAND</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:0.2em;margin-top:4px;">OFFICIAL TERRITORY CERTIFICATE</div>
      </td></tr>

      <!-- Citizen Number -->
      <tr><td style="padding:32px;text-align:center;border-bottom:1px solid #3a1a0a;">
        <div style="font-size:13px;color:#8a6555;letter-spacing:0.2em;margin-bottom:8px;">CITIZEN NUMBER</div>
        <div style="font-family:monospace;font-size:64px;font-weight:900;color:#ff7f40;line-height:1;">#${numFormatted}</div>
        <div style="font-size:14px;color:#f2e0d0;margin-top:12px;">Welcome to Mars, <strong>${firstName}</strong></div>
      </td></tr>

      <!-- Details -->
      <tr><td style="padding:24px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #3a1a0a;">
              <span style="font-size:10px;color:#4a2e1e;text-transform:uppercase;letter-spacing:0.15em;">Territory</span><br>
              <span style="font-size:14px;color:#f2e0d0;">${region}</span>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #3a1a0a;text-align:right;">
              <span style="font-size:10px;color:#4a2e1e;text-transform:uppercase;letter-spacing:0.15em;">Parcel Size</span><br>
              <span style="font-size:14px;color:#f2e0d0;">${parcelSize}</span>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:10px 0;">
              <span style="font-size:10px;color:#4a2e1e;text-transform:uppercase;letter-spacing:0.15em;">SHA-256 Authenticity Hash</span><br>
              <span style="font-size:9px;color:#8a6555;font-family:monospace;word-break:break-all;">${certHash}</span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Verify Button -->
      <tr><td style="padding:0 32px 24px;text-align:center;">
        <a href="${verifyUrl}" style="display:inline-block;background:#d94f1e;color:#fff;text-decoration:none;font-family:monospace;font-size:12px;font-weight:700;letter-spacing:0.15em;padding:14px 32px;">
          VERIFY MY CERTIFICATE →
        </a>
      </td></tr>

      <!-- Disclaimer -->
      <tr><td style="padding:16px 32px 32px;border-top:1px solid #3a1a0a;">
        <p style="font-size:9px;color:#4a2e1e;line-height:1.7;margin:0;">
          This is a novelty gift certificate. Land registration on Mars does not confer legal ownership under any current jurisdiction or the Outer Space Treaty (1967). MarsLand is not affiliated with NASA or SpaceX.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
        `
      })
    });
  } catch (emailErr) {
    console.error('Email send failed:', emailErr);
    // Don't throw - citizen is registered, email is non-critical
  }
}
