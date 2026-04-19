// Vedic Astrology Planetary Dignity Calculator

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
               'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const SIGN_LORDS = {
    'Aries': 'Mars', 'Taurus': 'Venus', 'Gemini': 'Mercury', 'Cancer': 'Moon',
    'Leo': 'Sun', 'Virgo': 'Mercury', 'Libra': 'Venus', 'Scorpio': 'Mars',
    'Sagittarius': 'Jupiter', 'Capricorn': 'Saturn', 'Aquarius': 'Saturn', 'Pisces': 'Jupiter'
};

const EXALTATION = {
    'Sun': 'Aries', 'Moon': 'Taurus', 'Mars': 'Capricorn', 'Mercury': 'Virgo',
    'Jupiter': 'Cancer', 'Venus': 'Pisces', 'Saturn': 'Libra',
    'Rahu': 'Taurus', 'Ketu': 'Scorpio'
};

const DEBILITATION = {
    'Sun': 'Libra', 'Moon': 'Scorpio', 'Mars': 'Cancer', 'Mercury': 'Pisces',
    'Jupiter': 'Capricorn', 'Venus': 'Virgo', 'Saturn': 'Aries',
    'Rahu': 'Scorpio', 'Ketu': 'Taurus'
};

const MOOLATRIKONA = {
    'Sun': 'Leo', 'Moon': 'Taurus', 'Mars': 'Aries', 'Mercury': 'Virgo',
    'Jupiter': 'Sagittarius', 'Venus': 'Libra', 'Saturn': 'Aquarius'
};

const OWN_SIGNS = {
    'Sun': ['Leo'],
    'Moon': ['Cancer'],
    'Mars': ['Aries', 'Scorpio'],
    'Mercury': ['Gemini', 'Virgo'],
    'Jupiter': ['Sagittarius', 'Pisces'],
    'Venus': ['Taurus', 'Libra'],
    'Saturn': ['Capricorn', 'Aquarius'],
    'Rahu': ['Aquarius'],
    'Ketu': ['Scorpio']
};

const FRIENDSHIPS = {
    'Sun': { friends: ['Moon', 'Mars', 'Jupiter'], enemies: ['Venus', 'Saturn'], neutral: ['Mercury'] },
    'Moon': { friends: ['Sun', 'Mercury'], enemies: [], neutral: ['Mars', 'Jupiter', 'Venus', 'Saturn'] },
    'Mars': { friends: ['Sun', 'Moon', 'Jupiter'], enemies: ['Mercury'], neutral: ['Venus', 'Saturn'] },
    'Mercury': { friends: ['Sun', 'Venus'], enemies: ['Moon'], neutral: ['Mars', 'Jupiter', 'Saturn'] },
    'Jupiter': { friends: ['Sun', 'Moon', 'Mars'], enemies: ['Mercury', 'Venus'], neutral: ['Saturn'] },
    'Venus': { friends: ['Mercury', 'Saturn'], enemies: ['Sun', 'Moon'], neutral: ['Mars', 'Jupiter'] },
    'Saturn': { friends: ['Mercury', 'Venus'], enemies: ['Sun', 'Moon', 'Mars'], neutral: ['Jupiter'] },
    'Rahu': { friends: ['Venus', 'Saturn'], enemies: ['Sun', 'Moon', 'Mars'], neutral: ['Mercury', 'Jupiter'] },
    'Ketu': { friends: ['Mars', 'Venus', 'Saturn'], enemies: ['Sun', 'Moon'], neutral: ['Mercury', 'Jupiter'] }
};

function getPlanetDignity(planet, sign) {
    if (!planet || !sign) return { dignity: 'neutral', label: 'Neutral' };

    const p = planet.trim();
    const s = sign.trim();

    if (EXALTATION[p] === s) {
        return { dignity: 'exalted', label: 'Exalted' };
    }

    if (DEBILITATION[p] === s) {
        return { dignity: 'debilitated', label: 'Debilitated' };
    }

    if (MOOLATRIKONA[p] === s) {
        return { dignity: 'moolatrikona', label: 'Moolatrikona' };
    }

    if (OWN_SIGNS[p] && OWN_SIGNS[p].includes(s)) {
        return { dignity: 'own', label: 'Own Sign' };
    }

    const signLord = SIGN_LORDS[s];
    if (!signLord || !FRIENDSHIPS[p]) {
        return { dignity: 'neutral', label: 'Neutral' };
    }

    if (FRIENDSHIPS[p].friends.includes(signLord)) {
        return { dignity: 'friend', label: "Friend's Sign" };
    }

    if (FRIENDSHIPS[p].enemies.includes(signLord)) {
        return { dignity: 'enemy', label: "Enemy's Sign" };
    }

    return { dignity: 'neutral', label: 'Neutral' };
}

function getPlanetAbbr(planet) {
    const abbrs = {
        'Sun': 'Su', 'Moon': 'Mo', 'Mars': 'Ma', 'Mercury': 'Me',
        'Jupiter': 'Ju', 'Venus': 'Ve', 'Saturn': 'Sa', 'Rahu': 'Ra', 'Ketu': 'Ke',
        'Ascendant': 'As', 'Asc': 'As'
    };
    return abbrs[planet] || planet.substring(0, 2);
}

function getSignAbbr(sign) {
    const abbrs = {
        'Aries': 'Ari', 'Taurus': 'Tau', 'Gemini': 'Gem', 'Cancer': 'Can',
        'Leo': 'Leo', 'Virgo': 'Vir', 'Libra': 'Lib', 'Scorpio': 'Sco',
        'Sagittarius': 'Sag', 'Capricorn': 'Cap', 'Aquarius': 'Aqu', 'Pisces': 'Pis'
    };
    return abbrs[sign] || sign.substring(0, 3);
}

function getSignIndex(sign) {
    return SIGNS.indexOf(sign);
}
