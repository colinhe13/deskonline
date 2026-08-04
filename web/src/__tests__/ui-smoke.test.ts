import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import Card from "../components/table/Card.vue";
import PlayerSeat from "../components/table/PlayerSeat.vue";
import PokerTable from "../components/table/PokerTable.vue";
import CommunityCards from "../components/table/CommunityCards.vue";
import PotDisplay from "../components/table/PotDisplay.vue";
import ActionBar from "../components/table/ActionBar.vue";
import ChipFlight from "../components/table/ChipFlight.vue";
import RoomList from "../components/lobby/RoomList.vue";
import LeaderboardModal from "../components/lobby/LeaderboardModal.vue";
import ConfirmBuyIn from "../components/table/ConfirmBuyIn.vue";
import RoomSettingsModal from "../components/table/RoomSettingsModal.vue";
import TransferHostModal from "../components/table/TransferHostModal.vue";
import VoiceIndicator from "../components/voice/VoiceIndicator.vue";

async function render(component: unknown, props: Record<string, unknown> = {}) {
  const app = createSSRApp({ render: () => h(component as never, props) });
  return renderToString(app);
}

describe("UI smoke（SSR 渲染边界对抗）", () => {
  it("Card：有牌/无牌/背面/翻牌效果均不抛错", async () => {
    const html = await render(Card, {
      card: { rank: "A", suit: "spades" },
      visible: true,
    });
    expect(html).toContain("A");
    expect(html).toContain("♠");

    const back = await render(Card, { card: null, visible: false });
    expect(back).toContain("card-face-down");

    const flip = await render(Card, {
      card: { rank: "K", suit: "hearts" },
      visible: true,
      effect: "flip",
      delay: 0.2,
    });
    expect(flip).toContain("card-flip");
  });

  it("PlayerSeat：空座位与满座位（含赢家/弃牌）渲染", async () => {
    const base = {
      index: 0,
      userId: null,
      username: null,
      chips: 0,
      buyIn: 0,
      connected: true,
      confirmed: true,
      bet: 0,
      folded: false,
      allIn: false,
      isDealer: false,
      cards: [],
    };
    const empty = await render(PlayerSeat, {
      seat: base,
      isHost: false,
      isMe: false,
      isCurrent: false,
      isWinner: false,
    });
    expect(empty).toContain("空");

    const occupied = await render(PlayerSeat, {
      seat: {
        ...base,
        userId: "u1",
        username: "alice",
        chips: 120,
        bet: 10,
        folded: false,
        allIn: true,
        isDealer: true,
        cards: [
          { rank: "A", suit: "hearts" },
          { rank: "9", suit: "diamonds" },
        ],
      },
      isHost: true,
      isMe: true,
      isCurrent: true,
      isWinner: true,
    });
    expect(occupied).toContain("alice");
    expect(occupied).toContain("ALL IN");
    expect(occupied).toContain("房主");
    expect(occupied).toContain("winner");
  });

  it("PlayerSeat：AI 徽标与房主专属移除按钮", async () => {
    const longName = "AI_ThisIsAVeryLongBotNameThatMustNotHideTheBadge";
    const aiSeat = {
      index: 1,
      userId: "ai1",
      username: longName,
      chips: 150,
      buyIn: 150,
      connected: true,
      confirmed: true,
      bet: 0,
      folded: false,
      allIn: false,
      isDealer: false,
      isAi: true,
      cards: [],
    };
    const asHostViewer = await render(PlayerSeat, {
      seat: aiSeat,
      isHost: true,
      isMe: true,
      isCurrent: false,
      isWinner: false,
      canRemoveAi: true,
    });
    expect(asHostViewer).toContain("ai-badge");
    expect(asHostViewer).toContain("AI");
    expect(asHostViewer).toContain("移除");
    expect(asHostViewer).toContain("房主");
    expect(asHostViewer).toContain("我");

    // 对抗：长用户名必须包在独立 seat-username 容器中（省略号只作用于此），
    // 且用户名在前、徽标在后，保证徽标不被用户名溢出挤掉。
    const nameStart = asHostViewer.indexOf(longName);
    expect(nameStart).toBeGreaterThan(-1);
    expect(asHostViewer.indexOf('class="seat-username"')).toBeGreaterThan(-1);
    expect(nameStart).toBeGreaterThan(
      asHostViewer.indexOf('class="seat-username"'),
    );
    expect(asHostViewer.indexOf('class="host-badge"')).toBeGreaterThan(
      nameStart,
    );
    expect(asHostViewer.indexOf('class="ai-badge"')).toBeGreaterThan(nameStart);
    expect(asHostViewer.indexOf('class="me-badge"')).toBeGreaterThan(nameStart);
    expect(asHostViewer.indexOf(longName) + longName.length).toBeLessThan(
      asHostViewer.indexOf('class="ai-badge"'),
    );

    const asRegularViewer = await render(PlayerSeat, {
      seat: aiSeat,
      isHost: false,
      isMe: false,
      isCurrent: false,
      isWinner: false,
      canRemoveAi: false,
    });
    expect(asRegularViewer).toContain("ai-badge");
    expect(asRegularViewer).not.toContain("移除");
  });

  it("PokerTable：room/pokerState 为 null 与正常状态均不抛错", async () => {
    const empty = await render(PokerTable, {
      room: null,
      pokerState: null,
      myUserId: null,
      handResult: null,
    });
    expect(empty).toBeTruthy();

    const full = await render(PokerTable, {
      room: {
        id: 7,
        maxPlayers: 2,
        hostId: "u1",
        status: "playing",
        smallBlind: 1,
        bigBlind: 2,
        minBuyIn: 150,
        maxBuyIn: 750,
        confirmedCount: 2,
        seats: [
          {
            index: 0,
            userId: "u1",
            username: "alice",
            chips: 500,
            buyIn: 500,
            connected: true,
            confirmed: true,
          },
          {
            index: 1,
            userId: "u2",
            username: "bob",
            chips: 500,
            buyIn: 500,
            connected: true,
            confirmed: true,
          },
        ],
      },
      pokerState: {
        pot: 42,
        currentBet: 2,
        minRaise: 4,
        bigBlind: 2,
        currentPlayerIndex: 0,
        phase: "flop",
        communityCards: [{ rank: "A", suit: "clubs" }],
        players: [
          {
            userId: "u1",
            username: "alice",
            chips: 490,
            bet: 10,
            folded: false,
            allIn: false,
            isDealer: true,
            cards: [
              { rank: "A", suit: "hearts" },
              { rank: "9", suit: "diamonds" },
            ],
          },
          {
            userId: "u2",
            username: "bob",
            chips: 468,
            bet: 32,
            folded: false,
            allIn: false,
            isDealer: false,
            cards: [],
          },
        ],
      },
      myUserId: "u1",
      handResult: {
        reason: "showdown",
        winners: [{ userId: "u1", amount: 42 }],
        handNames: { u1: "同花" },
      },
    });
    expect(full).toContain("#7");
    // 赢家高亮作用于牌桌座位（牌型文本展示在 TableView 横幅中，不在 PokerTable 渲染范围）
    expect(full).toContain("player-seat occupied current is-me winner");
    expect(full).toContain("pot-amount");
    expect(full).toContain("42");
  });

  it("PokerTable：观战者在等待中可点选空座位", async () => {
    const html = await render(PokerTable, {
      room: {
        id: "main",
        maxPlayers: 9,
        hostId: "u1",
        status: "waiting",
        smallBlind: 1,
        bigBlind: 2,
        minBuyIn: 150,
        maxBuyIn: 750,
        confirmedCount: 1,
        seats: [
          {
            index: 0,
            userId: "u1",
            username: "alice",
            chips: 500,
            buyIn: 500,
            connected: true,
            confirmed: true,
          },
          {
            index: 1,
            userId: null,
            username: null,
            chips: 0,
            buyIn: 0,
            connected: false,
            confirmed: false,
          },
        ],
        spectators: [{ userId: "u9", username: "carol" }],
      },
      pokerState: null,
      myUserId: "u9",
      handResult: null,
    });
    expect(html).toContain("selectable");

    const seatedViewer = await render(PokerTable, {
      room: {
        id: "main",
        maxPlayers: 9,
        hostId: "u1",
        status: "waiting",
        smallBlind: 1,
        bigBlind: 2,
        minBuyIn: 150,
        maxBuyIn: 750,
        confirmedCount: 1,
        seats: [
          {
            index: 0,
            userId: "u1",
            username: "alice",
            chips: 500,
            buyIn: 500,
            connected: true,
            confirmed: true,
          },
          {
            index: 1,
            userId: null,
            username: null,
            chips: 0,
            buyIn: 0,
            connected: false,
            confirmed: false,
          },
        ],
        spectators: [],
      },
      pokerState: null,
      myUserId: "nobody",
      handResult: null,
    });
    expect(seatedViewer).not.toContain("selectable");
  });

  it("PokerTable：进行中观战者可预约空座，已预约座位不可重复选择", async () => {
    const room = {
      id: "main",
      maxPlayers: 3,
      hostId: "u1",
      status: "playing",
      smallBlind: 1,
      bigBlind: 2,
      minBuyIn: 150,
      maxBuyIn: 750,
      confirmedCount: 2,
      playerCount: 2,
      pendingSeatReservationCount: 0,
      seats: [
        {
          index: 0,
          userId: "u1",
          username: "alice",
          chips: 500,
          buyIn: 500,
          connected: true,
          confirmed: true,
        },
        {
          index: 1,
          userId: "u2",
          username: "bob",
          chips: 500,
          buyIn: 500,
          connected: true,
          confirmed: true,
        },
        {
          index: 2,
          userId: null,
          username: null,
          chips: 0,
          buyIn: 0,
          connected: false,
          confirmed: false,
        },
      ],
      spectators: [{ userId: "u9", username: "carol" }],
      pendingSeatReservations: [],
    };

    const selectable = await render(PokerTable, {
      room,
      pokerState: null,
      myUserId: "u9",
      handResult: null,
    });
    expect(selectable).toContain("selectable");

    const reserved = await render(PokerTable, {
      room: {
        ...room,
        pendingSeatReservationCount: 1,
        pendingSeatReservations: [
          { userId: "u8", username: "dave", seatIndex: 2, status: "pending" },
        ],
      },
      pokerState: null,
      myUserId: "u9",
      handResult: null,
    });
    expect(reserved).not.toContain("selectable");
    expect(reserved).toContain("dave");
    expect(reserved).toContain("待入座");
  });

  it("CommunityCards：空槽位补齐到 5 张，5 张时无空槽", async () => {
    const none = await render(CommunityCards, { cards: [] });
    expect(none.match(/card-slot/g)?.length).toBe(5);

    const full = await render(CommunityCards, {
      cards: [
        { rank: "A", suit: "spades" },
        { rank: "K", suit: "hearts" },
        { rank: "Q", suit: "diamonds" },
        { rank: "J", suit: "clubs" },
        { rank: "10", suit: "spades" },
      ],
    });
    expect(full.match(/card-slot/g)).toBeNull();
  });

  it("PotDisplay：count-up 初始显示即金额本身", async () => {
    const html = await render(PotDisplay, { amount: 1234 });
    expect(html).toContain("1234");
    expect(html).toContain("底池");
  });

  it("ActionBar：无动作不渲染，有动作渲染第一层按钮", async () => {
    const none = await render(ActionBar, {
      actions: [],
      pokerState: null,
      myUserId: null,
    });
    expect(none.replace("<!---->", "").trim()).toBe("");

    const html = await render(ActionBar, {
      actions: [
        { type: "fold" },
        { type: "call", amount: 2 },
        { type: "raise", min: 4, max: 100 },
        { type: "allin", amount: 500 },
      ],
      pokerState: {
        pot: 10,
        currentBet: 2,
        minRaise: 2,
        bigBlind: 2,
        currentPlayerIndex: 0,
        phase: "preflop",
        communityCards: [],
        players: [
          {
            userId: "u1",
            username: "alice",
            chips: 500,
            bet: 2,
            folded: false,
            allIn: false,
            isDealer: true,
            cards: [],
          },
        ],
      },
      myUserId: "u1",
    });
    expect(html).toContain("弃牌");
    expect(html).toContain("跟注 (2)");
    expect(html).toContain("加注");
    // 面板默认关闭
    expect(html).not.toContain("1/3");
  });

  it("ChipFlight：空列表与飞行中筹码渲染", async () => {
    const none = await render(ChipFlight, { flights: [] });
    expect(none).not.toContain("flight-chip");

    const html = await render(ChipFlight, {
      flights: [
        { id: 1, from: { x: 20, y: 30 }, to: { x: 50, y: 50 }, flying: true },
      ],
    });
    expect(html).toContain("flight-chip");
    expect(html).toContain("left:50%;top:50%");
  });

  it("RoomList：空列表与房间卡片（含交错索引样式）", async () => {
    const empty = await render(RoomList, { rooms: [] });
    expect(empty).toContain("暂无可用房间");

    const html = await render(RoomList, {
      rooms: [
        {
          id: 1,
          playerCount: 2,
          maxPlayers: 9,
          confirmedCount: 2,
          smallBlind: 1,
          bigBlind: 2,
          minBuyIn: 150,
          maxBuyIn: 750,
          status: "waiting",
          spectatorCount: 0,
        },
        {
          id: 2,
          playerCount: 5,
          maxPlayers: 9,
          confirmedCount: 0,
          smallBlind: 1,
          bigBlind: 2,
          minBuyIn: 150,
          maxBuyIn: 750,
          status: "playing",
          spectatorCount: 3,
        },
      ],
    });
    expect(html).toContain("#1");
    expect(html).toContain("等待中");
    expect(html).toContain("游戏中");
    expect(html).toContain("--i:1;");
    expect(html).toContain("观战 3");
  });

  it("LeaderboardModal：SSR 下渲染标题与加载态（onMounted 拉取不执行）", async () => {
    const html = await render(LeaderboardModal, {});
    expect(html).toContain("积分排行榜");
    expect(html).toContain("加载中");
    expect(html).toContain("关闭");
  });

  it("ConfirmBuyIn：边界金额校验渲染", async () => {
    const html = await render(ConfirmBuyIn, { minBuyIn: 150, maxBuyIn: 750 });
    expect(html).toContain("范围 150 - 750");
    expect(html).toContain("确认带入");

    const queued = await render(ConfirmBuyIn, {
      minBuyIn: 150,
      maxBuyIn: 750,
      title: "预约下一手带入",
      submitLabel: "确认预约",
    });
    expect(queued).toContain("预约下一手带入");
    expect(queued).toContain("确认预约");
  });

  it("RoomSettingsModal / TransferHostModal / VoiceIndicator 渲染", async () => {
    const settings = await render(RoomSettingsModal, {
      settings: {
        maxPlayers: 9,
        smallBlind: 1,
        bigBlind: 2,
        minBuyIn: 150,
        maxBuyIn: 750,
      },
    });
    expect(settings).toContain("房间设置");

    const transfer = await render(TransferHostModal, {
      seats: [
        {
          index: 0,
          userId: "u1",
          username: "alice",
          chips: 0,
          buyIn: 0,
          connected: true,
          confirmed: true,
        },
        {
          index: 1,
          userId: "u2",
          username: "bob",
          chips: 0,
          buyIn: 0,
          connected: true,
          confirmed: true,
        },
        {
          index: 2,
          userId: "ai1",
          username: "AI_XiaoZhi",
          chips: 0,
          buyIn: 0,
          connected: true,
          confirmed: true,
          isAi: true,
        },
      ],
      myUserId: "u1",
    });
    expect(transfer).toContain("bob");
    // AI 不能当房主，候选人列表必须排除
    expect(transfer).not.toContain("AI_XiaoZhi");

    const transferOnlyAi = await render(TransferHostModal, {
      seats: [
        {
          index: 0,
          userId: "u1",
          username: "alice",
          chips: 0,
          buyIn: 0,
          connected: true,
          confirmed: true,
        },
        {
          index: 1,
          userId: "ai1",
          username: "AI_XiaoZhi",
          chips: 0,
          buyIn: 0,
          connected: true,
          confirmed: true,
          isAi: true,
        },
      ],
      myUserId: "u1",
    });
    expect(transferOnlyAi).toContain("没有其他玩家可移交");

    const transferNone = await render(TransferHostModal, {
      seats: [],
      myUserId: "u1",
    });
    expect(transferNone).toContain("没有其他玩家可移交");

    const voice = await render(VoiceIndicator, {
      speaking: true,
      muted: false,
    });
    expect(voice).toContain("speaking-ring");
  });
});
