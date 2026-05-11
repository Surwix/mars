const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).end();

  const page = parseInt(req.query.page) || 1;
  const pageSize = 20;
  const region = req.query.region || 'all';
  const from = (page - 1) * pageSize;

  try {
    let query = supabase
      .from('citizens')
      .select('citizen_number, display_name, region, parcel_size, tier, created_at', { count: 'exact' })
      .order('citizen_number', { ascending: true })
      .range(from, from + pageSize - 1);

    if (region !== 'all') query = query.eq('region', region);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.status(200).json({
      citizens: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize)
    });

  } catch (err) {
    console.error('Citizens API error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch citizens' });
  }
};
