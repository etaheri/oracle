/** Current vocabulary. Historical rules remain in copy.ts, explicitly versioned. */
export const GAME_TERMS = {
  product: 'Outseen', opponent: 'The Oracle', players: 'players',
  rulesNav: 'How to play', rulesTitle: 'How to play',
  history: 'Your record', streak: 'Streak', streakTitle: 'Your streak',
  playerRating: 'Your forecast rating',
} as const;
export const CURRENT_GAME_COPY = {
  purpose: "Make your call. Beat the Oracle's line. Grow your fortune.",
  oracleIdentity: 'The Oracle makes predictions using AI.',
  opponentChallenge: 'Can you read the room better?',
  streakMeaning: 'Your streak is one call a day. It adds no fortune.',
  lapse: 'A new streak begins with your next call. Your fortune, results and record remain.',
  protectionUsed: 'Streak protection held your streak. No calls were added.',
} as const;
