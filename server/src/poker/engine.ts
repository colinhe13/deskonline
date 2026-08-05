import {
  GameState,
  PlayerState,
  Card,
  HandResult as EvaluatedHand,
  StructuredAction,
} from "./types.js";
import { createDeck, shuffle, deal } from "./deck.js";
import { evaluateHand, compareHands, describeHand } from "./evaluator.js";
import {
  calculateSidePots,
  isBettingRoundComplete,
  returnUncalledBets,
} from "./betting.js";
import { getAvailableActions, isValidAction } from "./actions.js";

export interface HandResult {
  winners: { userId: string; amount: number }[];
  // Uncalled excess returned to bettors; not a win and shown separately.
  refunds: { userId: string; amount: number }[];
  showdownCards: Record<string, Card[]>;
  handNames: Record<string, string>;
  reason: "fold" | "showdown";
  displayMs?: number;
}

export class PokerEngine {
  private state: GameState;
  private deck: Card[] = [];
  private lastHandWinners: Set<string> = new Set();
  private handHistory: StructuredAction[] = [];
  private onBroadcast: (type: string, payload: unknown) => void;

  constructor(
    players: {
      userId: string;
      username: string;
      seatIndex: number;
      chips: number;
      isAi?: boolean;
    }[],
    smallBlind: number,
    bigBlind: number,
    dealerIndex: number,
    onBroadcast: (type: string, payload: unknown) => void,
  ) {
    this.onBroadcast = onBroadcast;
    this.state = {
      phase: "preflop",
      communityCards: [],
      pot: 0,
      sidePots: [],
      players: players.map((p) => ({
        ...p,
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        hasActed: false,
        cards: [],
        cardsRevealed: false,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: false,
      })),
      currentPlayerIndex: 0,
      dealerIndex,
      smallBlind,
      bigBlind,
      currentBet: 0,
      minRaise: bigBlind,
      handNumber: 1,
      actionLog: [],
    };
  }

  getState(): GameState {
    return this.state;
  }

  getStateForPlayer(userId: string): GameState {
    const stateCopy = JSON.parse(JSON.stringify(this.state)) as GameState;
    const isShowdown =
      stateCopy.phase === "showdown" || stateCopy.phase === "settled";
    for (const p of stateCopy.players) {
      if (p.userId !== userId && !(isShowdown && p.cardsRevealed)) {
        p.cards = [];
      }
    }
    return stateCopy;
  }

  // Spectators never see hole cards, except cards revealed at showdown.
  getStateForSpectator(): GameState {
    const stateCopy = JSON.parse(JSON.stringify(this.state)) as GameState;
    const isShowdown =
      stateCopy.phase === "showdown" || stateCopy.phase === "settled";
    for (const p of stateCopy.players) {
      if (!(isShowdown && p.cardsRevealed)) {
        p.cards = [];
      }
    }
    return stateCopy;
  }

  startHand() {
    const s = this.state;
    s.phase = "preflop";
    s.communityCards = [];
    s.pot = 0;
    s.sidePots = [];
    s.currentBet = 0;
    s.minRaise = s.bigBlind;
    s.actionLog = [];
    this.handHistory = [];
    this.lastHandWinners = new Set();

    this.deck = shuffle(createDeck());

    for (const p of s.players) {
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.hasActed = false;
      p.cards = [];
      p.cardsRevealed = false;
      p.isDealer = false;
      p.isSmallBlind = false;
      p.isBigBlind = false;
    }

    const activePlayers = s.players;
    const n = activePlayers.length;
    const dealerIdx = s.dealerIndex % n;
    activePlayers[dealerIdx].isDealer = true;

    let sbIdx: number, bbIdx: number;
    if (n === 2) {
      sbIdx = dealerIdx;
      bbIdx = (dealerIdx + 1) % n;
    } else {
      sbIdx = (dealerIdx + 1) % n;
      bbIdx = (dealerIdx + 2) % n;
    }

    activePlayers[sbIdx].isSmallBlind = true;
    activePlayers[bbIdx].isBigBlind = true;

    for (const p of activePlayers) {
      p.cards = deal(this.deck, 2);
    }

    this.postBlind(activePlayers[sbIdx], s.smallBlind);
    this.postBlind(activePlayers[bbIdx], s.bigBlind);
    s.pot = s.players.reduce((sum, p) => sum + p.totalBet, 0);
    s.currentBet = s.bigBlind;
    s.actionLog.push(
      `SB (${activePlayers[sbIdx].username}) posts ${activePlayers[sbIdx].bet}`,
      `BB (${activePlayers[bbIdx].username}) posts ${activePlayers[bbIdx].bet}`,
    );

    // Preflop: action starts left of BB (or dealer in heads-up)
    if (n === 2) {
      s.currentPlayerIndex = sbIdx;
    } else {
      s.currentPlayerIndex = (bbIdx + 1) % n;
    }

    // A short blind may leave the first seat unable to act (already all-in).
    let attempts = 0;
    while (
      (s.players[s.currentPlayerIndex].allIn ||
        s.players[s.currentPlayerIndex].folded) &&
      attempts < n
    ) {
      s.currentPlayerIndex = (s.currentPlayerIndex + 1) % n;
      attempts++;
    }
    if (
      s.players[s.currentPlayerIndex].allIn ||
      s.players[s.currentPlayerIndex].folded
    ) {
      // Nobody can act (e.g. both blinds all-in): run the board out to showdown.
      this.advancePhase();
      this.broadcastState();
      return;
    }

    this.broadcastState();
  }

  private postBlind(player: PlayerState, amount: number) {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.bet += actual;
    player.totalBet += actual;
    if (player.chips === 0) player.allIn = true;
    this.recordAction(player.userId, "blind", actual);
  }

  private recordAction(
    userId: string,
    action: StructuredAction["action"],
    amount: number,
  ) {
    const phase = this.state.phase;
    if (
      phase !== "preflop" &&
      phase !== "flop" &&
      phase !== "turn" &&
      phase !== "river"
    ) {
      return;
    }
    this.handHistory.push({ street: phase, userId, action, amount });
  }

  // Structured per-street action records of the current hand (public info
  // only). Consumed by opponent profiling after settlement; reset per hand.
  getHandHistory(): StructuredAction[] {
    return [...this.handHistory];
  }

  handleAction(userId: string, action: string, amount?: number): boolean {
    const s = this.state;
    const player = s.players[s.currentPlayerIndex];
    if (!player || player.userId !== userId) return false;
    if (!isValidAction(s, userId, action, amount)) return false;

    const prevBet = s.currentBet;
    const betBefore = player.bet;

    switch (action) {
      case "fold":
        player.folded = true;
        break;
      case "check":
        break;
      case "call": {
        const toCall = Math.min(s.currentBet - player.bet, player.chips);
        player.chips -= toCall;
        player.bet += toCall;
        player.totalBet += toCall;
        if (player.chips === 0) player.allIn = true;
        break;
      }
      case "raise": {
        const raiseAmount = amount || s.bigBlind;
        const totalToPut = raiseAmount;
        player.chips -= totalToPut;
        player.bet += totalToPut;
        player.totalBet += totalToPut;
        if (player.bet > s.currentBet) {
          s.minRaise = player.bet - s.currentBet;
          s.currentBet = player.bet;
        }
        if (player.chips === 0) player.allIn = true;
        break;
      }
      case "allin": {
        const allInAmount = player.chips;
        player.bet += allInAmount;
        player.totalBet += allInAmount;
        player.chips = 0;
        player.allIn = true;
        if (player.bet > s.currentBet) {
          s.minRaise = player.bet - s.currentBet;
          s.currentBet = player.bet;
        }
        break;
      }
    }

    const putIn = player.bet - betBefore;
    if (action === "fold") s.actionLog.push(`${player.username} fold`);
    else if (action === "check") s.actionLog.push(`${player.username} check`);
    else if (action === "call")
      s.actionLog.push(`${player.username} call ${putIn}`);
    else if (action === "raise")
      s.actionLog.push(`${player.username} raise ${putIn}`);
    else if (action === "allin")
      s.actionLog.push(`${player.username} allin ${putIn}`);
    // Short-stack shoves are offered as "allin" even when they only call the
    // current bet; profiling stats must see the effective action.
    const effective: StructuredAction["action"] =
      action === "allin" && player.bet <= prevBet
        ? "call"
        : (action as StructuredAction["action"]);
    this.recordAction(userId, effective, putIn);

    player.hasActed = true;
    // A genuine raise reopens the action for every other active player
    if (player.bet > prevBet) {
      for (const other of s.players) {
        if (other.userId !== userId && !other.folded && !other.allIn) {
          other.hasActed = false;
        }
      }
    }

    s.pot = s.players.reduce((sum, p) => sum + p.totalBet, 0);

    const activePlayers = s.players.filter((p) => !p.folded);
    if (activePlayers.length === 1) {
      this.settleHands();
      return true;
    }

    if (isBettingRoundComplete(s.players, s.currentBet)) {
      this.advancePhase();
    } else {
      this.moveToNextPlayer();
    }

    this.broadcastState();
    return true;
  }

  // Server-only fold for a player leaving during an active hand. Unlike a
  // client action, this may fold an out-of-turn player without refunding their
  // committed chips or changing the fixed hand roster.
  foldPlayer(userId: string): boolean {
    const s = this.state;
    if (s.phase === "showdown" || s.phase === "settled") return false;

    const player = s.players.find((p) => p.userId === userId);
    if (!player || player.folded || player.allIn) return false;

    player.folded = true;
    player.hasActed = true;
    s.actionLog.push(`${player.username} fold`);
    this.recordAction(player.userId, "fold", 0);
    s.pot = s.players.reduce((sum, p) => sum + p.totalBet, 0);

    const activePlayers = s.players.filter((p) => !p.folded);
    if (activePlayers.length === 1) {
      this.settleHands();
      return true;
    }

    if (isBettingRoundComplete(s.players, s.currentBet)) {
      this.advancePhase();
    } else if (s.players[s.currentPlayerIndex]?.userId === userId) {
      this.moveToNextPlayer();
    }

    this.broadcastState();
    return true;
  }

  private moveToNextPlayer() {
    const s = this.state;
    const n = s.players.length;
    let next = (s.currentPlayerIndex + 1) % n;
    let attempts = 0;
    while (
      (s.players[next].folded ||
        s.players[next].allIn ||
        s.players[next].hasActed) &&
      attempts < n
    ) {
      next = (next + 1) % n;
      attempts++;
    }
    s.currentPlayerIndex = next;
  }

  private advancePhase() {
    const s = this.state;

    for (const p of s.players) {
      p.bet = 0;
      p.hasActed = false;
    }
    s.currentBet = 0;
    s.minRaise = s.bigBlind;

    const activePlayers = s.players.filter((p) => !p.folded);
    const canAct = activePlayers.filter((p) => !p.allIn);

    switch (s.phase) {
      case "preflop":
        s.phase = "flop";
        s.communityCards.push(...deal(this.deck, 3));
        break;
      case "flop":
        s.phase = "turn";
        s.communityCards.push(...deal(this.deck, 1));
        break;
      case "turn":
        s.phase = "river";
        s.communityCards.push(...deal(this.deck, 1));
        break;
      case "river":
        s.phase = "showdown";
        this.settleHands();
        return;
    }

    s.actionLog.push(`--- ${s.phase} ---`);

    if (canAct.length <= 1) {
      // Run out remaining cards automatically
      while (s.communityCards.length < 5) {
        if (s.communityCards.length === 3) {
          s.phase = "turn";
          s.communityCards.push(...deal(this.deck, 1));
        } else if (s.communityCards.length === 4) {
          s.phase = "river";
          s.communityCards.push(...deal(this.deck, 1));
        } else {
          break;
        }
      }
      s.phase = "showdown";
      this.settleHands();
      return;
    }

    // Post-flop: action starts from first active player after dealer
    const n = s.players.length;
    let start = (s.dealerIndex + 1) % n;
    let attempts = 0;
    while (
      (s.players[start].folded || s.players[start].allIn) &&
      attempts < n
    ) {
      start = (start + 1) % n;
      attempts++;
    }
    s.currentPlayerIndex = start;
  }

  private settleHands() {
    const s = this.state;
    s.phase = "settled";

    const activePlayers = s.players.filter((p) => !p.folded);

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.chips += s.pot;
      // Human fold winners may opt in via revealCards; AI winners always reveal
      // so the table can see what they were holding.
      const result: HandResult = {
        winners: [{ userId: winner.userId, amount: s.pot }],
        refunds: [],
        showdownCards: {},
        handNames: {},
        reason: "fold",
      };
      this.lastHandWinners = new Set([winner.userId]);
      this.onBroadcast("poker:hand_result", result);
      // AI winners always reveal so the table can see what they were holding.
      if (winner.isAi) winner.cardsRevealed = true;
      // The callers return right after settling, so this is the only chance
      // clients get the settled snapshot (fold badges, updated chips).
      this.broadcastState();
      return;
    }

    const refunds = returnUncalledBets(s.players);
    s.pot = s.players.reduce((sum, p) => sum + p.totalBet, 0);

    s.sidePots = calculateSidePots(s.players);
    const showdownCards: Record<string, Card[]> = {};
    const winnings: Map<string, number> = new Map();
    const evaluated: Map<string, EvaluatedHand> = new Map();

    for (const pot of s.sidePots) {
      const eligiblePlayers = activePlayers.filter((p) =>
        pot.eligible.includes(p.userId),
      );
      if (eligiblePlayers.length === 0) {
        // Everyone eligible folded; refund contributors so chips never vanish.
        for (const p of s.players) {
          const contributed = pot.contributions[p.userId] ?? 0;
          if (contributed > 0) {
            p.chips += contributed;
            refunds.push({ userId: p.userId, amount: contributed });
          }
        }
        continue;
      }

      let bestResult = null;
      let potWinners: PlayerState[] = [];

      for (const p of eligiblePlayers) {
        const allCards = [...p.cards, ...s.communityCards];
        const result = evaluateHand(allCards);
        showdownCards[p.userId] = p.cards;
        // Reaching showdown makes the hand public to every player at the table.
        p.cardsRevealed = true;
        evaluated.set(p.userId, result);

        if (!bestResult || compareHands(result, bestResult) > 0) {
          bestResult = result;
          potWinners = [p];
        } else if (compareHands(result, bestResult) === 0) {
          potWinners.push(p);
        }
      }

      const share = Math.floor(pot.amount / potWinners.length);
      const remainder = pot.amount - share * potWinners.length;
      potWinners.forEach((w, i) => {
        const won = share + (i === 0 ? remainder : 0);
        w.chips += won;
        winnings.set(w.userId, (winnings.get(w.userId) || 0) + won);
      });
    }

    const handNames: Record<string, string> = {};
    for (const [userId, ev] of evaluated) {
      handNames[userId] = describeHand(ev);
    }

    this.lastHandWinners = new Set(winnings.keys());
    const result: HandResult = {
      winners: [...winnings.entries()].map(([userId, amount]) => ({
        userId,
        amount,
      })),
      refunds,
      showdownCards,
      handNames,
      reason: "showdown",
    };
    this.onBroadcast("poker:hand_result", result);
  }

  nextHand(): boolean {
    const s = this.state;
    const playersWithChips = s.players.filter((p) => p.chips > 0);
    if (playersWithChips.length < 2) return false;

    s.players = playersWithChips;
    s.dealerIndex = (s.dealerIndex + 1) % s.players.length;
    s.handNumber++;
    this.startHand();
    return true;
  }

  getAvailableActionsForPlayer(userId: string) {
    return getAvailableActions(this.state, userId);
  }

  // Lets the winner of a fold win reveal their hole cards to the table.
  // Rejected unless the hand is settled and the player actually won it.
  revealCards(userId: string): boolean {
    const s = this.state;
    if (s.phase !== "settled") return false;
    if (!this.lastHandWinners.has(userId)) return false;
    const player = s.players.find((p) => p.userId === userId);
    if (!player || player.cardsRevealed) return false;
    player.cardsRevealed = true;
    this.broadcastState();
    return true;
  }

  // Public hand name for a player whose cards are already revealed; null
  // otherwise. Feeds opponent profiling without exposing unshown cards.
  getRevealedHandName(userId: string): string | null {
    const player = this.state.players.find((p) => p.userId === userId);
    if (!player || !player.cardsRevealed || player.cards.length === 0) {
      return null;
    }
    const allCards = [...player.cards, ...this.state.communityCards];
    // A preflop fold win reveals cards before the board is dealt out, so the
    // hand cannot be evaluated; skip rather than fabricate a name.
    if (allCards.length < 5) return null;
    return describeHand(evaluateHand(allCards));
  }

  private broadcastState() {
    for (const p of this.state.players) {
      const view = this.getStateForPlayer(p.userId);
      this.onBroadcast("poker:update", {
        targetUserId: p.userId,
        state: view,
        availableActions: this.getAvailableActionsForPlayer(p.userId),
      });
    }
  }

  destroy() {
    // No persistent resources to release; kept for interface stability.
  }
}
