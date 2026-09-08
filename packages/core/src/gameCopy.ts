/** Current vocabulary. Historical rules remain in copy.ts, explicitly versioned. */
export const GAME_TERMS = {
  product: 'Outseen', opponent: 'The Oracle', players: 'players',
  rulesNav: 'How to play', rulesTitle: 'The Rites',
  history: 'Your ledger', streak: 'Streak', streakTitle: 'Your vigil',
  playerRating: 'Your forecast rating', opponentRating: 'Oracle rating',
} as const;
export const CURRENT_GAME_COPY = {
  purpose: 'Make your call. Outsee the Oracle. Outscore the field.',
  oracleIdentity: 'The Oracle makes predictions using AI.',
  opponentChallenge: 'Can you outsee it?',
  streakMeaning: 'Your streak is a ritual you keep: one daily call is enough. It adds no points.',
  lapse: 'A new streak begins with your next call. Your predictions, results and rating remain.',
  shieldUsed: 'Your shield preserved your streak. No calls were added.',
} as const;
