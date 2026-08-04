import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage } from "../types/protocol";

// Real-time only: messages are appended as they arrive and cleared when the
// user leaves the room. There is no snapshot restore by design.
const MAX_KEPT_MESSAGES = 500;

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const error = ref("");

  function appendMessage(message: ChatMessage) {
    messages.value.push(message);
    if (messages.value.length > MAX_KEPT_MESSAGES) {
      messages.value.splice(0, messages.value.length - MAX_KEPT_MESSAGES);
    }
  }

  function setError(message: string) {
    error.value = message;
  }

  function clearError() {
    error.value = "";
  }

  function clearMessages() {
    messages.value = [];
    error.value = "";
  }

  return {
    messages,
    error,
    appendMessage,
    setError,
    clearError,
    clearMessages,
  };
});
