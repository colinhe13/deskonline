export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank =
  "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type GamePhase =
  "preflop" | "flop" | "turn" | "river" | "showdown" | "settled";

export type PlayerActionType = "fold" | "check" | "call" | "raise" | "allin";

export interface ActionOption {
  type: PlayerActionType;
  amount?: number;
  min?: number;
  max?: number;
}

export interface PlayerState {
  userId: string;
  username: string;
  seatIndex: number;
  chips: number;
  bet: number;
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  cards: Card[];
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  // Whether this player's cards are public to everyone after the hand settles.
  cardsRevealed: boolean;
  // True for AI-driven seats; lets clients render the AI badge during a hand.
  isAi?: boolean;
}

export interface SidePot {
  amount: number;
  eligible: string[];
}

export interface GameState {
  phase: GamePhase;
  communityCards: Card[];
  pot: number;
  sidePots: SidePot[];
  players: PlayerState[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  currentBet: number;
  minRaise: number;
  handNumber: number;
  // Human-readable log of public events (blinds, actions, phase changes).
  // Used as the GTO decision history; contains no private information.
  actionLog: string[];
}

export enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
  RoyalFlush = 9,
}

export interface HandResult {
  rank: HandRank;
  bestCards: Card[];
  kickers: number[];
}
