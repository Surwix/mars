// api/verify.js
// GET /api/verify?id=001 - verifies a citizen certificate

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'Invalid citizen number' });
  }

  try {
    const { data, error } = await supabase
      .from('citizens')
      .select('citizen_number, display_name, region, parcel_size, cert_hash, verified, created_at, tier')
      .eq('citizen_number', parseInt(id))
      .single();

    if (error || !data) {
      return res.status(404).json({ valid: false, error: 'Certificate not found' });
    }

    return res.status(200).json({
      valid: true,
      citizenNumber: data.citizen_number,
      displayName: data.display_name,
      region: data.region,
      parcelSize: data.parcel_size,
      certHash: data.cert_hash,
      tier: data.tier,
      verified: data.verified,
      registeredAt: data.created_at
    });

  } catch (err) {
    return res.status(500).json({ error: 'Verification failed' });
  }
}
