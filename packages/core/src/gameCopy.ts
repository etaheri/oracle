/** Current vocabulary. Historical rules remain in copy.ts, explicitly versioned. */
export const GAME_TERMS = {
  product: 'Outsee', opponent: 'The Oracle', players: 'players',
  rulesNav: 'How to play', rulesTitle: 'The Rites',
  history: 'Your ledger', streak: 'Streak', streakTitle: 'Your vigil',
  playerRating: 'Your forecast rating', opponentRating: 'Oracle rating',
} as const;
export const CURRENT_GAME_COPY = {
  purpose: 'Make your call. Outsee the Oracle. Outscore the field.',
  streakMeaning: 'Your streak marks your return, not your accuracy.',
  lapse: 'A new streak begins with your next call. Your predictions, results and rating remain.',
  shieldUsed: 'Your shield preserved your streak. No calls were added.',
} as const;
