<template>
  <div class="chat-panel">
    <div ref="listEl" class="chat-messages">
      <p v-if="chat.messages.length === 0" class="chat-empty">
        暂无消息，说点什么吧
      </p>
      <p
        v-for="message in chat.messages"
        :key="message.id"
        class="chat-message"
        :class="{ mine: message.userId === myUserId }"
      >
        <span class="chat-author">{{ message.username }}</span>
        <span class="chat-text">{{ message.text }}</span>
      </p>
    </div>
    <p v-if="chat.error" class="chat-error" role="alert">{{ chat.error }}</p>
    <form class="chat-input-row" @submit.prevent="submit">
      <input
        v-model="draft"
        class="chat-input"
        type="text"
        placeholder="输入消息…"
        autocomplete="off"
        enterkeyhint="send"
        aria-label="聊天输入框"
        @input="chat.clearError()"
      />
      <span class="chat-count" :class="{ over: isOverLimit }">
        {{ visibleCount }}/{{ MAX_CHAT_LENGTH }}
      </span>
      <button class="chat-send" type="submit" :disabled="!canSend">
        发送
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useChatStore } from "../../stores/chat";
import { MAX_CHAT_LENGTH } from "../../types/protocol";

const props = defineProps<{
  myUserId: string | null;
}>();

const emit = defineEmits<{
  send: [text: string];
}>();

const chat = useChatStore();
const draft = ref("");
const listEl = ref<HTMLElement | null>(null);

// Code-point count matches the server rule, so emoji count as one character.
const visibleCount = computed(() => [...draft.value].length);
const isOverLimit = computed(() => visibleCount.value > MAX_CHAT_LENGTH);
const canSend = computed(
  () => draft.value.trim().length > 0 && !isOverLimit.value,
);

function submit() {
  if (!canSend.value) return;
  emit("send", draft.value.trim());
  draft.value = "";
}

watch(
  () => chat.messages.length,
  async () => {
    await nextTick();
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(10, 28, 18, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.6rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.chat-empty {
  margin: auto;
  color: var(--text-faint);
  font-size: var(--fs-xs);
  text-align: center;
}
.chat-message {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.45;
  color: var(--text);
  word-break: break-word;
}
.chat-author {
  color: var(--gold-soft);
  font-weight: 600;
  margin-right: 0.4rem;
}
.chat-message.mine .chat-author {
  color: var(--success);
}
.chat-error {
  margin: 0;
  padding: 0.25rem 0.75rem;
  color: var(--danger);
  font-size: var(--fs-xs);
}
.chat-input-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem;
  border-top: 1px solid var(--glass-border);
}
.chat-input {
  flex: 1;
  min-width: 0;
  padding: 0.45rem 0.6rem;
  min-height: 40px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text);
  font-size: var(--fs-sm);
  outline: none;
}
.chat-input:focus {
  border-color: rgba(240, 199, 94, 0.45);
}
.chat-count {
  flex-shrink: 0;
  color: var(--text-faint);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
}
.chat-count.over {
  color: var(--danger);
  font-weight: 600;
}
.chat-send {
  flex-shrink: 0;
  padding: 0.4rem 0.9rem;
  min-height: 40px;
  background: linear-gradient(160deg, var(--gold), var(--gold-strong));
  color: #1c1304;
  font-weight: 600;
  font-size: var(--fs-sm);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
}
.chat-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
