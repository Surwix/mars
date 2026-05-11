const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: premiumNumbers, error: premError } = await supabase
      .from('premium_numbers')
      .select('number, tier, price_cents, stripe_price_id, available')
      .order('number', { ascending: true });

    if (premError) throw premError;

    const { count, error: countError } = await supabase
      .from('citizens')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;

    const total = count || 0;

    return res.status(200).json({
      premium: premiumNumbers || [],
      nextStandard: Math.max(101, total + 101),
      totalCitizens: total,
      spotsLeft: 10000 - total
    });

  } catch (err) {
    console.error('Numbers API error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch numbers', detail: err.message });
  }
};
