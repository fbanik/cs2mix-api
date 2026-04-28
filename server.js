const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

app.use(cors());
app.use(express.json());

// Converte URL do perfil Steam em SteamID64
async function resolveSteamId(input) {
  input = input.trim();

  // Já é um SteamID64 numérico
  if (/^\d{17}$/.test(input)) return input;

  // Extrai o identificador da URL
  let vanity = null;
  const matchId = input.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  const matchVanity = input.match(/steamcommunity\.com\/id\/([^\/\?]+)/);

  if (matchId) return matchId[1];
  if (matchVanity) vanity = matchVanity[1];
  else vanity = input; // tentativa direta

  // Resolve vanity URL via API
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${vanity}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.response?.success === 1) return data.response.steamid;
  throw new Error('Perfil Steam não encontrado');
}

// Rota principal: busca stats do jogador
app.get('/stats', async (req, res) => {
  const { steamid } = req.query;

  if (!steamid) {
    return res.status(400).json({ error: 'Parâmetro steamid obrigatório' });
  }
  if (!STEAM_API_KEY) {
    return res.status(500).json({ error: 'STEAM_API_KEY não configurada no servidor' });
  }

  try {
    const resolvedId = await resolveSteamId(steamid);

    // Busca perfil e stats em paralelo
    const [profileRes, statsRes] = await Promise.all([
      fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${resolvedId}`),
      fetch(`https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2/?appid=730&key=${STEAM_API_KEY}&steamid=${resolvedId}`)
    ]);

    const profileData = await profileRes.json();
    const statsData = await statsRes.json();

    const profile = profileData.response?.players?.[0];
    if (!profile) throw new Error('Perfil não encontrado');

    // Verifica se o perfil é público
    if (profile.communityvisibilitystate !== 3) {
      return res.status(403).json({ error: 'Perfil privado. O jogador precisa tornar o perfil público na Steam.' });
    }

    // Extrai stats
    const rawStats = statsData.playerstats?.stats || [];
    const stat = (name) => rawStats.find(s => s.name === name)?.value || 0;

    const kills      = stat('total_kills');
    const deaths     = stat('total_deaths');
    const wins       = stat('total_wins');
    const roundsPlayed = stat('total_rounds_played');
    const hsKills    = stat('total_kills_headshot');
    const shotsHit   = stat('total_shots_hit');
    const shotsFired = stat('total_shots_fired');
    const mvps       = stat('total_mvps');
    const damage     = stat('total_damage_done');

    const kd         = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
    const hsPercent  = kills > 0 ? ((hsKills / kills) * 100).toFixed(1) : '0.0';
    const accuracy   = shotsFired > 0 ? ((shotsHit / shotsFired) * 100).toFixed(1) : '0.0';
    const winRate    = roundsPlayed > 0 ? ((wins / roundsPlayed) * 100).toFixed(1) : '0.0';

    res.json({
      steamid: resolvedId,
      name: profile.personaname,
      avatar: profile.avatarmedium,
      profileUrl: profile.profileurl,
      stats: {
        kills,
        deaths,
        kd: parseFloat(kd),
        hsPercent: parseFloat(hsPercent),
        accuracy: parseFloat(accuracy),
        winRate: parseFloat(winRate),
        wins,
        roundsPlayed,
        mvps
    
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'CS2 Mix API online ✅' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
