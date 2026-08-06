// Deterministic style notes for AI opponents, generated from persona style
// rather than an LLM summary: zero cost, zero latency, and the content is
// controllable. Notes describe observable style only — no internal parameter
// values (bluffHintRate, temperature) are exposed.
//
// Maintenance contract: personaNoteBySlug and PERSONA_SEEDS (personas.ts) are
// two description sources for the same six personas; when persona text
// changes, keep both in sync.

export const personaNoteBySlug: Record<string, string> = {
  "tight-aggressive":
    "紧凶风格：入池手牌少但执行果断，开池与防守范围紧，边缘牌面对大注果断弃牌；入池后攻击性强，c-bet 频率高、价值下注偏大；很少诈唬，但出手的诈唬配有阻断牌与完整故事线，极难识破；几乎从不慢打。其主动大注与加注应优先按真牌对待。",
  "loose-aggressive":
    "松凶风格：开池与 3-bet 范围宽，翻后连续施压，c-bet 频率高并敢于在转牌、河牌续注；约三成激进动作属于诈唬，接受大波动，善用位置与主动权赢下底池。面对其大额河牌下注需重新评估牌力，但其诈唬占比足以避免用边缘牌轻易弃牌。",
  "calling-station":
    "松被动跟注站：喜欢跟注看牌，很少主动加注或诈唬；面对中小尺度下注倾向用边缘牌与听牌跟注，只有真正的大注才能赶跑其中等牌力；偶尔慢打坚果。价值下注可以偏大，但其在河牌的加注几乎等同强牌信号。",
  maniac:
    "疯狂型：开池范围极宽，频繁 3-bet，敢于多条街纯诈唬与超池施压；诈唬占比极高，愿意为讲完故事线押上全部筹码；行为波动极大、难以读取。其大额下注的诈唬比例显著高于常人，中等偏强牌力可考虑抓诈唬。",
  "nit-rock":
    "极紧被动岩石：只玩顶级起手牌，中等牌宁愿跟注也不加注，几乎从不诈唬；不主动建造大底池，偏好过牌控池。其罕见的大注与加注基本是真牌，可信度极高，次等牌力不宜支付。",
  balanced:
    "均衡型：范围在价值与诈唬间保持平衡，开池、c-bet、3-bet 均含两类成分，尺度规范——小尺度线性、大尺度极化；诈唬频率适中，打法稳健无明显漏洞。对其读取应以实际行为统计为主，风格先验参考价值有限。",
};
