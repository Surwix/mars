// api/numbers.js
// GET /api/numbers - returns premium available numbers + next standard number
// Deploy on Vercel as serverless function

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get available premium numbers
    const { data: premiumNumbers, error: premError } = await supabase
      .from('premium_numbers')
      .select('number, tier, price_cents, stripe_price_id')
      .eq('available', true)
      .order('number', { ascending: true });

    if (premError) throw premError;

    // Get next standard number (101+)
    const { data: nextData, error: nextError } = await supabase
      .rpc('get_next_standard_number');

    if (nextError) throw nextError;

    // Get total citizen count
    const { count, error: countError } = await supabase
      .from('citizens')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    return res.status(200).json({
      premium: premiumNumbers || [],
      nextStandard: nextData || 101,
      totalCitizens: count || 0,
      spotsLeft: 10000 - (count || 0)
    });

  } catch (err) {
    console.error('Numbers API error:', err);
    return res.status(500).json({ error: 'Failed to fetch numbers' });
  }
}
