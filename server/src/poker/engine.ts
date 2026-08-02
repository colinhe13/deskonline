import { GameState, PlayerState, Card } from "./types.js";
import { createDeck, shuffle, deal } from "./deck.js";
import { evaluateHand, compareHands } from "./evaluator.js";
import { calculateSidePots, isBettingRoundComplete } from "./betting.js";
import { getAvailableActions, isValidAction } from "./actions.js";

export interface HandResult {
  winners: { userId: string; amount: number }[];
  showdownCards: Record<string, Card[]>;
}

export class PokerEngine {
  private state: GameState;
  private deck: Card[] = [];
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private onBroadcast: (type: string, payload: unknown) => void;
  private onTimeout: (userId: string, action: string) => void;

  constructor(
    players: { userId: string; username: string; seatIndex: number; chips: number }[],
    smallBlind: number,
    bigBlind: number,
    dealerIndex: number,
    onBroadcast: (type: string, payload: unknown) => void,
    onTimeout: (userId: string, action: string) => void,
  ) {
    this.onBroadcast = onBroadcast;
    this.onTimeout = onTimeout;
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
        cards: [],
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
    };
  }

  getState(): GameState {
    return this.state;
  }

  getStateForPlayer(userId: string): GameState {
    const stateCopy = JSON.parse(JSON.stringify(this.state)) as GameState;
    const isShowdown = stateCopy.phase === "showdown" || stateCopy.phase === "settled";
    for (const p of stateCopy.players) {
      if (p.userId !== userId && !isShowdown) {
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

    this.deck = shuffle(createDeck());

    for (const p of s.players) {
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.cards = [];
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
    s.currentBet = s.bigBlind;

    // Preflop: action starts left of BB (or dealer in heads-up)
    if (n === 2) {
      s.currentPlayerIndex = sbIdx;
    } else {
      s.currentPlayerIndex = (bbIdx + 1) % n;
    }

    this.broadcastState();
    this.startActionTimer();
  }

  private postBlind(player: PlayerState, amount: number) {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.bet += actual;
    player.totalBet += actual;
    if (player.chips === 0) player.allIn = true;
  }

  handleAction(userId: string, action: string, amount?: number): boolean {
    const s = this.state;
    const player = s.players[s.currentPlayerIndex];
    if (!player || player.userId !== userId) return false;
    if (!isValidAction(s, userId, action, amount)) return false;

    this.clearActionTimer();

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
      this.startActionTimer();
    }

    this.broadcastState();
    return true;
  }

  private moveToNextPlayer() {
    const s = this.state;
    const n = s.players.length;
    let next = (s.currentPlayerIndex + 1) % n;
    let attempts = 0;
    while ((s.players[next].folded || s.players[next].allIn) && attempts < n) {
      next = (next + 1) % n;
      attempts++;
    }
    s.currentPlayerIndex = next;
  }

  private advancePhase() {
    const s = this.state;

    for (const p of s.players) {
      p.bet = 0;
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
    while ((s.players[start].folded || s.players[start].allIn) && attempts < n) {
      start = (start + 1) % n;
      attempts++;
    }
    s.currentPlayerIndex = start;
    this.startActionTimer();
  }

  private settleHands() {
    const s = this.state;
    s.phase = "settled";
    this.clearActionTimer();

    const activePlayers = s.players.filter((p) => !p.folded);

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.chips += s.pot;
      const result: HandResult = {
        winners: [{ userId: winner.userId, amount: s.pot }],
        showdownCards: {},
      };
      this.onBroadcast("poker:hand_result", result);
      return;
    }

    s.sidePots = calculateSidePots(s.players);
    const showdownCards: Record<string, Card[]> = {};
    const winnings: Map<string, number> = new Map();

    for (const pot of s.sidePots) {
      const eligiblePlayers = activePlayers.filter((p) => pot.eligible.includes(p.userId));
      if (eligiblePlayers.length === 0) continue;

      let bestResult = null;
      let potWinners: PlayerState[] = [];

      for (const p of eligiblePlayers) {
        const allCards = [...p.cards, ...s.communityCards];
        const result = evaluateHand(allCards);
        showdownCards[p.userId] = p.cards;

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

    const result: HandResult = {
      winners: [...winnings.entries()].map(([userId, amount]) => ({ userId, amount })),
      showdownCards,
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

  markDisconnected(userId: string) {
    const player = this.state.players.find((p) => p.userId === userId);
    if (!player) return;
    // If it's their turn, auto-act after 5s
    const current = this.state.players[this.state.currentPlayerIndex];
    if (current?.userId === userId) {
      this.clearActionTimer();
      this.actionTimer = setTimeout(() => {
        this.autoAction(userId);
      }, 5000);
    }
  }

  markReconnected(userId: string) {
    // Cancel any pending auto-action for this player
    const current = this.state.players[this.state.currentPlayerIndex];
    if (current?.userId === userId) {
      this.clearActionTimer();
      this.startActionTimer();
    }
  }

  private autoAction(userId: string) {
    const s = this.state;
    const player = s.players.find((p) => p.userId === userId);
    if (!player) return;

    const toCall = s.currentBet - player.bet;
    const action = toCall === 0 ? "check" : "fold";
    this.handleAction(userId, action);
    this.onTimeout(userId, action);
  }

  private startActionTimer() {
    this.clearActionTimer();
    const current = this.state.players[this.state.currentPlayerIndex];
    if (!current || current.folded || current.allIn) return;

    this.actionTimer = setTimeout(() => {
      this.autoAction(current.userId);
    }, 30_000);
  }

  private clearActionTimer() {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
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
    this.clearActionTimer();
  }
}
